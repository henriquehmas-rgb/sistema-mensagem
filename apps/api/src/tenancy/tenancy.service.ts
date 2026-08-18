import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@prisma/client';

export interface TenantContext {
  orgId: string;
  userId?: string;
  role?: Role;
}

/**
 * Contexto de tenant por request via AsyncLocalStorage.
 * Populado pelo TenancyInterceptor (JWT) — consumido pela client extension do Prisma.
 */
@Injectable()
export class TenancyService {
  private readonly als = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, fn: () => T): T {
    return this.als.run(context, fn);
  }

  getContext(): TenantContext | undefined {
    return this.als.getStore();
  }

  getOrgId(): string | undefined {
    return this.als.getStore()?.orgId;
  }

  getOrgIdOrThrow(): string {
    const orgId = this.getOrgId();
    if (!orgId) {
      throw new Error('Contexto de tenant ausente — rota autenticada esperada.');
    }
    return orgId;
  }
}
