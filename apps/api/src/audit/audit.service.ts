import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string;
  meta?: Record<string, unknown>;
}

/**
 * AuditLog (CONTRACTS §3): quem (userId do contexto), o quê (action), em qual
 * entidade. Best-effort: falha de auditoria é logada mas nunca derruba a mutação.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  /** Em contexto de request autenticado — orgId/userId vêm do TenantContext. */
  async log(entry: AuditEntry): Promise<void> {
    const context = this.tenancy.getContext();
    if (!context) {
      this.logger.warn(`Audit fora de contexto de tenant ignorado: ${entry.action}`);
      return;
    }
    await this.write({
      orgId: context.orgId,
      userId: context.userId ?? null,
      ...entry,
    });
  }

  /** Em processors/jobs (sem request) — orgId explícito, userId opcional. */
  async logSystem(orgId: string, entry: AuditEntry & { userId?: string | null }): Promise<void> {
    await this.write({ orgId, userId: entry.userId ?? null, ...entry });
  }

  private async write(entry: {
    orgId: string;
    userId: string | null;
    action: string;
    entity: string;
    entityId: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.prismaSystem.auditLog.create({
        data: {
          orgId: entry.orgId,
          userId: entry.userId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          meta: (entry.meta ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao gravar audit log (${entry.action} ${entry.entity}/${entry.entityId}): ${(error as Error).message}`,
      );
    }
  }
}
