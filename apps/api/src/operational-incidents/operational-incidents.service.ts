import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  OperationalIncidentSeverity,
  OperationalIncidentStatus,
  type OperationalIncident,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { TeamsOperationsNotifier } from './teams-operations-notifier.service';

export type OperationalIncidentSource =
  | 'AI_PROVIDER'
  | 'IXC'
  | 'OLHO_DE_DEUS'
  | 'CHANNEL_DELIVERY'
  | 'QUEUE'
  | 'WEBHOOK'
  | 'API';

export interface RecordOperationalIncidentInput {
  orgId: string;
  source: OperationalIncidentSource;
  /** Código canônico, sem texto de cliente, URL, credencial ou stacktrace. */
  code: string;
  severity: OperationalIncidentSeverity;
}

export interface OperationalIncidentRegistration {
  incident: OperationalIncident;
  /** Indica se a ocorrência acabou de entrar no painel ou já era conhecida. */
  disposition: 'OPENED' | 'REOPENED_OR_REPEATED';
}

const NOTIFICATION_COOLDOWN_MS: Record<OperationalIncidentSeverity, number> = {
  P1: 10 * 60 * 1_000,
  P2: 30 * 60 * 1_000,
  // P3 é registrado no painel; não interrompe a equipe no Teams.
  P3: Number.POSITIVE_INFINITY,
};

@Injectable()
export class OperationalIncidentsService {
  private readonly logger = new Logger(OperationalIncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly teams: TeamsOperationsNotifier,
  ) {}

  /**
   * Best-effort por design: uma falha no monitoramento nunca pode parar o
   * atendimento. O registro usa apenas códigos fechados e agrupamento por
   * fonte/código, para não transportar PII ao banco ou ao Teams.
   */
  async record(input: RecordOperationalIncidentInput): Promise<OperationalIncidentRegistration | null> {
    try {
      const now = new Date();
      const fingerprint = `${input.source}:${input.code}`;
      const existing = await this.prisma.prismaSystem.operationalIncident.findUnique({
        where: { orgId_fingerprint: { orgId: input.orgId, fingerprint } },
      });
      const incident = existing
        ? await this.prisma.prismaSystem.operationalIncident.update({
          where: { id: existing.id },
          data: {
            severity: input.severity,
            status: OperationalIncidentStatus.OPEN,
            occurrenceCount: { increment: 1 },
            lastSeenAt: now,
            acknowledgedAt: null,
            resolvedAt: null,
          },
        })
        : await this.prisma.prismaSystem.operationalIncident.create({
          data: {
            orgId: input.orgId,
            fingerprint,
            source: input.source,
            code: input.code,
            severity: input.severity,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });

      await this.audit.logSystem(input.orgId, {
        action: existing ? 'operational_incident.reopened_or_repeated' : 'operational_incident.opened',
        entity: 'OperationalIncident',
        entityId: incident.id,
        meta: { source: input.source, code: input.code, severity: input.severity },
      });

      if (!this.shouldNotify(incident, now)) {
        return { incident, disposition: existing ? 'REOPENED_OR_REPEATED' : 'OPENED' };
      }
      if (await this.teams.notify(incident)) {
        await this.prisma.prismaSystem.operationalIncident.update({
          where: { id: incident.id }, data: { lastNotificationAt: now },
        });
        await this.audit.logSystem(input.orgId, {
          action: 'operational_incident.teams_notified', entity: 'OperationalIncident', entityId: incident.id,
          meta: { source: input.source, code: input.code, severity: input.severity },
        });
      }
      return { incident, disposition: existing ? 'REOPENED_OR_REPEATED' : 'OPENED' };
    } catch (error) {
      this.logger.warn(`Falha ao registrar incidente operacional: ${(error as Error).message}`);
      return null;
    }
  }

  async list(): Promise<OperationalIncident[]> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    return this.prisma.tenant.operationalIncident.findMany({
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
    });
  }

  async acknowledge(id: string): Promise<OperationalIncident> {
    return this.transition(id, OperationalIncidentStatus.ACKNOWLEDGED);
  }

  async resolve(id: string): Promise<OperationalIncident> {
    return this.transition(id, OperationalIncidentStatus.RESOLVED);
  }

  private shouldNotify(incident: OperationalIncident, now: Date): boolean {
    const cooldown = NOTIFICATION_COOLDOWN_MS[incident.severity];
    if (!Number.isFinite(cooldown)) return false;
    return !incident.lastNotificationAt || now.getTime() - incident.lastNotificationAt.getTime() >= cooldown;
  }

  private async transition(id: string, status: OperationalIncidentStatus): Promise<OperationalIncident> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const data = status === OperationalIncidentStatus.ACKNOWLEDGED
      ? { status, acknowledgedAt: new Date() }
      : { status, resolvedAt: new Date() };
    const updated = await this.prisma.tenant.operationalIncident.updateMany({
      where: { id, orgId }, data,
    });
    if (updated.count === 0) throw new NotFoundException('Incidente operacional não encontrado');
    await this.audit.log({
      action: status === OperationalIncidentStatus.ACKNOWLEDGED
        ? 'operational_incident.acknowledged'
        : 'operational_incident.resolved',
      entity: 'OperationalIncident', entityId: id,
    });
    return this.prisma.tenant.operationalIncident.findUniqueOrThrow({ where: { id } });
  }
}
