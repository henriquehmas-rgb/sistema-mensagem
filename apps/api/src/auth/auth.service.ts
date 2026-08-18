import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type {
  AuthUser,
  JwtAccessPayload,
  JwtRefreshPayload,
} from './interfaces/auth-user.interface';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type SafeUser = Omit<User, 'passwordHash'>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.refreshSecret = config.get('JWT_REFRESH_SECRET', { infer: true });
  }

  /**
   * CONTRACTS §6 — POST /auth/login {email, password, orgSlug?}.
   * Email é único POR org: se o mesmo email existir em mais de uma org, orgSlug é obrigatório.
   * Usa prismaSystem: login acontece antes de existir contexto de tenant.
   */
  async login(dto: LoginDto): Promise<AuthTokens> {
    const candidates = await this.prisma.prismaSystem.user.findMany({
      where: {
        email: dto.email.toLowerCase(),
        isActive: true,
        ...(dto.orgSlug ? { org: { slug: dto.orgSlug } } : {}),
      },
      take: 2,
    });

    if (candidates.length > 1) {
      throw new BadRequestException('Email presente em mais de uma organização — informe orgSlug');
    }
    const user = candidates[0];
    if (!user) {
      // verificação dummy p/ igualar tempo de resposta (não vazar existência do usuário)
      await argon2.verify(
        '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        dto.password,
      ).catch(() => false);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordOk = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    await this.prisma.prismaSystem.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    return this.issueTokens(user);
  }

  /**
   * Refresh com rotação: token antigo é revogado, novo par é emitido.
   * Reuso de token já revogado = possível roubo → revoga TODOS os tokens do usuário.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const tokenHash = this.hashToken(refreshToken);

    const stored = await this.prisma.prismaSystem.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.userId !== payload.sub) {
      throw new UnauthorizedException('Refresh token desconhecido');
    }
    if (stored.revokedAt) {
      this.logger.warn(`Reuso de refresh token revogado detectado (user=${stored.userId})`);
      await this.prisma.prismaSystem.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token revogado');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = await this.prisma.prismaSystem.user.findUnique({
      where: { id: stored.userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuário inativo');
    }

    // Rotação ATÔMICA: revoga o token usado somente se AINDA não estava revogado.
    // Dois refresh concorrentes com o mesmo token leem `stored` antes da revogação;
    // o guard `revokedAt: null` no updateMany garante que só um vence — o perdedor
    // cai no caminho de reuso (count === 0), sem janela TOCTOU entre leitura e escrita.
    const rotated = await this.prisma.prismaSystem.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) {
      this.logger.warn(
        `Reuso concorrente de refresh token detectado (user=${stored.userId}) — revogando todos`,
      );
      await this.prisma.prismaSystem.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token revogado');
    }

    return this.issueTokens(user);
  }

  /** Revoga o refresh token informado ou, sem token, todos os do usuário. */
  async logout(userId: string, refreshToken?: string): Promise<{ success: true }> {
    if (refreshToken) {
      await this.prisma.prismaSystem.refreshToken.updateMany({
        where: { userId, tokenHash: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.prismaSystem.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  /** GET /auth/me — usa o client tenant (contexto já populado pelo TenancyInterceptor). */
  async me(authUser: AuthUser): Promise<SafeUser> {
    const user = await this.prisma.tenant.user.findUnique({
      where: { id: authUser.userId },
    });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }
    return this.toSafeUser(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
    };
    const refreshPayload: JwtRefreshPayload = { ...accessPayload, jti: randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ ...accessPayload }, { expiresIn: ACCESS_TOKEN_TTL }),
      this.jwtService.signAsync(
        { ...refreshPayload },
        { secret: this.refreshSecret, expiresIn: REFRESH_TOKEN_TTL },
      ),
    ]);

    await this.prisma.prismaSystem.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken, user: this.toSafeUser(user) };
  }

  private async verifyRefreshToken(token: string): Promise<JwtRefreshPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtRefreshPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toSafeUser(user: User): SafeUser {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }
}
