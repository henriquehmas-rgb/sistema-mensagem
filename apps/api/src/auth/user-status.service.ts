import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** TTL curto: fecha a janela de access token válido pós-desativação em ≤30s. */
const CACHE_TTL_MS = 30_000;

interface CachedStatus {
  isActive: boolean;
  expiresAt: number;
}

/**
 * Consulta `User.isActive` com cache em memória de TTL curto.
 * Usado pelo JwtStrategy (REST) e pelo middleware do RealtimeGateway (socket):
 * um usuário desativado (offboarding) perde acesso em até 30s, em vez de
 * manter o access token utilizável pelos 15min restantes do JWT.
 * Cache por instância — em multi-instância a janela continua ≤ TTL.
 */
@Injectable()
export class UserStatusService {
  private readonly cache = new Map<string, CachedStatus>();

  constructor(private readonly prisma: PrismaService) {}

  async isActive(userId: string): Promise<boolean> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.isActive;
    }

    // Roda antes do TenancyInterceptor popular o contexto → prismaSystem por id (PK).
    const user = await this.prisma.prismaSystem.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });
    const isActive = user?.isActive ?? false;
    this.cache.set(userId, { isActive, expiresAt: Date.now() + CACHE_TTL_MS });
    return isActive;
  }

  /** Invalidação imediata na própria instância (chamado ao desativar usuário). */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
