import { BadRequestException } from '@nestjs/common';
import { NetworkTopologyMappingKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { NetworkTopologyMappingService } from './network-topology-mapping.service';

describe('NetworkTopologyMappingService calibration', () => {
  it('requires three independent events across two days before human confirmation', async () => {
    const evidence: Array<{ mappingId: string; eventFingerprint: string; observedAt: Date }> = [];
    const now = new Date('2026-09-09T12:00:00.000Z');
    const mapping = {
      id: 'mapping-1',
      orgId: 'org-1',
      referenceKind: NetworkTopologyMappingKind.IXC_FTTH_BOX,
      referenceFingerprint: 'reference',
      encryptedReference: 'encrypted-reference',
      topologyFingerprint: 'topology',
      encryptedTopology: 'encrypted-topology',
      status: 'SHADOW' as const,
      evidenceReference: null,
      confirmedAt: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const prisma = {
      tenant: {
        networkTopologyMapping: {
          upsert: vi.fn(async () => mapping),
          findUnique: vi.fn(async () => mapping),
          update: vi.fn(async ({ data }) => ({ ...mapping, ...data })),
        },
        networkTopologyCalibrationEvidence: {
          findUnique: vi.fn(async ({ where }) =>
            evidence.find((item) => item.mappingId === where.mappingId_eventFingerprint.mappingId &&
              item.eventFingerprint === where.mappingId_eventFingerprint.eventFingerprint) ?? null,
          ),
          create: vi.fn(async ({ data }) => {
            evidence.push(data);
            return data;
          }),
          findMany: vi.fn(async () => evidence.map(({ observedAt }) => ({ observedAt }))),
        },
      },
    };
    const service = new NetworkTopologyMappingService(
      prisma as never,
      { getOrgIdOrThrow: () => 'org-1' } as never,
      {
        fingerprint: (value: string) => `hmac:${value}`,
        encrypt: (value: string) => `encrypted:${value}`,
        decrypt: () => JSON.stringify({ olt: 'OLT-A', board: null, pon: null }),
      } as never,
      { log: vi.fn() } as never,
    );
    const base = {
      referenceKind: NetworkTopologyMappingKind.IXC_FTTH_BOX,
      reference: 'CAIXA-TESTE',
      olt: 'OLT-A',
      externalEventId: 'event-1',
      evidenceReference: 'evidence-1',
      observedAt: '2026-09-01T10:00:00.000Z',
    };

    const first = await service.recordCalibration(base);
    const duplicate = await service.recordCalibration(base);
    expect(first.status).toBe('SHADOW');
    expect(first.calibration).toMatchObject({ independentEvents: 1, distinctDays: 1, eligibleForHumanConfirmation: false });
    expect(duplicate.calibration.independentEvents).toBe(1);
    await expect(service.confirm(mapping.id, { evidenceReference: 'confirmação humana' })).rejects.toBeInstanceOf(BadRequestException);

    await service.recordCalibration({ ...base, externalEventId: 'event-2', evidenceReference: 'evidence-2', observedAt: '2026-09-02T10:00:00.000Z' });
    const eligible = await service.recordCalibration({ ...base, externalEventId: 'event-3', evidenceReference: 'evidence-3', observedAt: '2026-09-02T12:00:00.000Z' });
    expect(eligible.calibration).toMatchObject({ independentEvents: 3, distinctDays: 2, eligibleForHumanConfirmation: true });
    expect(eligible.status).toBe('SHADOW');

    const confirmed = await service.confirm(mapping.id, { evidenceReference: 'confirmação humana' });
    expect(confirmed.status).toBe('CONFIRMED');
  });

  it('rejects individual or geographic references in the calibration endpoint', async () => {
    const service = new NetworkTopologyMappingService({ tenant: {} } as never, {} as never, {} as never, {} as never);
    await expect(service.recordCalibration({
      referenceKind: NetworkTopologyMappingKind.IXC_CUSTOMER,
      reference: 'não deve ser usado',
      olt: 'OLT-A',
      externalEventId: 'event-1',
      evidenceReference: 'evidence-1',
      observedAt: '2026-09-01T10:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
