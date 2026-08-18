import type { Role } from '@prisma/client';

/** Usuário autenticado anexado ao request (via JwtStrategy.validate). */
export interface AuthUser {
  userId: string;
  orgId: string;
  role: Role;
}

/** Payload do access token — CONTRACTS §9: { sub, orgId, role }. */
export interface JwtAccessPayload {
  sub: string;
  orgId: string;
  role: Role;
}

/** Payload do refresh token (assinado com JWT_REFRESH_SECRET, rotacionado). */
export interface JwtRefreshPayload extends JwtAccessPayload {
  jti: string;
}
