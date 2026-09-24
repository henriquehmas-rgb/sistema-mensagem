import { describe, expect, it } from 'vitest';
import { OlhoDeDeusCorrelationService } from './olho-de-deus-correlation.service';
import type { NetworkObservation } from './olho-de-deus.types';

const NOW = new Date('2026-08-31T20:00:00.000Z');

function observation(overrides: Partial<NetworkObservation> = {}): NetworkObservation {
  return {
    customerReference: 'cust_safe',
    olt: 'X15', pon: '0/3/8', cto: '607-A', route: 'A',
    onuState: 'ONLINE', opticalSignalDbm: -25,
    affectedOnus: 0, totalOnus: 80, ixcAlert: false, eventState: 'NONE',
    oltSourceState: 'AVAILABLE', ixcSourceState: 'AVAILABLE',
    observedAt: '2026-08-31T19:59:30.000Z',
    ...overrides,
  };
}

describe('OlhoDeDeusCorrelationService', () => {
  const service = new OlhoDeDeusCorrelationService();

  it('confirma falha coletiva apenas com evidência técnica suficiente', () => {
    const result = service.correlate(observation({
      onuState: 'OFFLINE', affectedOnus: 30, totalOnus: 80,
      ixcAlert: true, eventState: 'CONFIRMED',
    }), NOW);
    expect(result).toMatchObject({
      diagnosis: 'COLLECTIVE_OUTAGE_CONFIRMED', confidence: 0.97,
      safeForAutomaticReply: true,
    });
  });

  it('trata uma ONU offline como falha individual', () => {
    expect(service.correlate(observation({
      onuState: 'OFFLINE', affectedOnus: 1,
    }), NOW).diagnosis).toBe('INDIVIDUAL_FAILURE');
  });

  it('sinaliza possível falso positivo do IXC quando OLT confirma online', () => {
    expect(service.correlate(observation({ ixcAlert: true }), NOW)).toMatchObject({
      diagnosis: 'IXC_FALSE_POSITIVE_SUSPECTED', safeForAutomaticReply: false,
    });
  });

  it('não automatiza uma suspeita coletiva ainda não confirmada', () => {
    expect(service.correlate(observation({
      onuState: 'OFFLINE', affectedOnus: 20, totalOnus: 80,
    }), NOW)).toMatchObject({
      diagnosis: 'COLLECTIVE_OUTAGE_SUSPECTED', safeForAutomaticReply: false,
    });
  });

  it('falha de forma segura quando OLT está indisponível ou dado venceu', () => {
    expect(service.correlate(observation({ oltSourceState: 'UNAVAILABLE' }), NOW)).toMatchObject({
      diagnosis: 'INCONCLUSIVE', confidence: 0, safeForAutomaticReply: false,
    });
    expect(service.correlate(observation({
      observedAt: '2026-08-31T19:50:00.000Z',
    }), NOW).diagnosis).toBe('INCONCLUSIVE');
  });

  it('não associa telemetria ao cliente com IXC interno vencido ou indisponível', () => {
    for (const ixcSourceState of ['STALE', 'UNAVAILABLE'] as const) {
      expect(service.correlate(observation({ ixcSourceState }), NOW)).toMatchObject({
        diagnosis: 'INCONCLUSIVE',
        safeForAutomaticReply: false,
        reason: 'associacao_ixc_indisponivel_ou_vencida',
      });
    }
  });

  it('representa recuperação sem inferir garantia futura', () => {
    expect(service.correlate(observation({ eventState: 'RECOVERED' }), NOW)).toMatchObject({
      diagnosis: 'RECOVERED', reason: 'evento_tecnico_recuperado',
    });
  });
});
