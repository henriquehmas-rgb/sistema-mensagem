import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env.validation';
import type { AuthUser, JwtAccessPayload } from '../interfaces/auth-user.interface';
import { UserStatusService } from '../user-status.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly userStatus: UserStatusService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtAccessPayload & { scope?: string }): Promise<AuthUser> {
    // Tokens de escopo restrito (ex.: visitorToken do webchat) NÃO valem como
    // access token de agente — mesmo sendo assinados com o mesmo segredo.
    if (payload.scope !== undefined || !payload.role || !payload.orgId) {
      throw new UnauthorizedException('Token sem escopo de acesso à API');
    }
    // Fecha a janela de offboarding: usuário desativado perde o acesso em ≤30s
    // (cache curto no UserStatusService), sem esperar o JWT de 15min expirar.
    if (!(await this.userStatus.isActive(payload.sub))) {
      throw new UnauthorizedException('Usuário desativado');
    }
    return { userId: payload.sub, orgId: payload.orgId, role: payload.role };
  }
}
