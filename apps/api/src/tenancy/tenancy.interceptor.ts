import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { TenancyService } from './tenancy.service';

/**
 * Popula o TenantContext {orgId, userId, role} a partir do usuário autenticado (JWT).
 * Roda depois dos guards (Passport já colocou req.user). A subscription do handler é
 * envolvida em als.run() para o contexto sobreviver ao pipeline assíncrono inteiro.
 */
@Injectable()
export class TenancyInterceptor implements NestInterceptor {
  constructor(private readonly tenancy: TenancyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user?.orgId) {
      return next.handle();
    }

    return new Observable<unknown>((subscriber) => {
      const subscription = this.tenancy.run(
        { orgId: user.orgId, userId: user.userId, role: user.role },
        () =>
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (error: unknown) => subscriber.error(error),
            complete: () => subscriber.complete(),
          }),
      );
      return () => subscription.unsubscribe();
    });
  }
}
