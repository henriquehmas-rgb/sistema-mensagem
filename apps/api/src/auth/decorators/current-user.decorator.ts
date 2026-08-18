import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Injeta o usuário autenticado no handler.
 * Uso: `@CurrentUser() user: AuthUser` ou `@CurrentUser('orgId') orgId: string`.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | AuthUser[keyof AuthUser] => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Usuário não autenticado');
    }
    return data ? user[data] : user;
  },
);
