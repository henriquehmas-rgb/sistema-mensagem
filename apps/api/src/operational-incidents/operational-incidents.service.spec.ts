import { OperationalIncidentSeverity, OperationalIncidentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { OperationalIncidentsService } from './operational-incidents.service';

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'incident-1', orgId: 'org-1', fingerprint: 'IXC:ixc_indisponivel',
    source: 'IXC', code: 'ixc_indisponivel', severity: OperationalIncidentSeverity.P2,
    status: OperationalIncidentStatus.OPEN, occurrenceCount: 1,
    firstSeenAt: new Date('2026-09-18T10:00:00.000Z'),
    lastSeenAt: new Date('2026-09-18T10:00:00.000Z'),
    lastNotificationAt: null, acknowledgedAt: null, resolvedAt: null,
    createdAt: new Date('2026-09-18T10:00:00.000Z'), updatedAt: new Date('2026-09-18T10:00:00.000Z'),
    ...overrides,
  };
}

function harness(existing: ReturnType<typeof incident> | null = null) {
  const operationalIncident = {
    findUnique: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockResolvedValue(incident()),
    update: vi.fn().mockResolvedValue(incident({
      ...existing,
      occurrenceCount: 2,
    })),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  const audit = { logSystem: vi.fn(), log: vi.fn() };
  const teams = { notify: vi.fn().mockResolvedValue(false) };
  return {
    operationalIncident, audit, teams,
    service: new OperationalIncidentsService(
      { prismaSystem: { operationalIncident }, tenant: { operationalIncident } } as never,
      { getOrgIdOrThrow: () => 'org-1' } as never,
      audit as never,
      teams as never,
    ),
  };
}

describe('OperationalIncidentsService', () => {
  it('persiste e agrupa incidente sem tentar notificar quando Teams está desativado', async () => {
    const h = harness();
    await h.service.record({ orgId: 'org-1', source: 'IXC', code: 'ixc_indisponivel', severity: 'P2' });

    expect(h.operationalIncident.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orgId: 'org-1', fingerprint: 'IXC:ixc_indisponivel', source: 'IXC', code: 'ixc_indisponivel',
      }),
    }));
    expect(h.teams.notify).toHaveBeenCalledTimes(1);
    expect(h.audit.logSystem).toHaveBeenCalledWith('org-1', expect.objectContaining({
      action: 'operational_incident.opened',
    }));
  });

  it('respeita cooldown e não repete aviso P2 recém-enviado', async () => {
    const h = harness(incident({ lastNotificationAt: new Date() }));
    await h.service.record({ orgId: 'org-1', source: 'IXC', code: 'ixc_indisponivel', severity: 'P2' });

    expect(h.operationalIncident.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OperationalIncidentStatus.OPEN, occurrenceCount: { increment: 1 } }),
    }));
    expect(h.teams.notify).not.toHaveBeenCalled();
  });
});
