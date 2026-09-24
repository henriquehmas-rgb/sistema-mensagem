import { describe, expect, it } from 'vitest';
import { assessIntegrationActivationReadiness } from './integration-activation-readiness.policy';

const baseline = {
  channels: [
    { channel: 'WHATSAPP' as const, configured: true, hasCredentials: true, hasExternalId: true, lastTestSucceeded: true, approvedTemplates: 2 },
    { channel: 'INSTAGRAM' as const, configured: true, hasCredentials: true, hasExternalId: true, lastTestSucceeded: true, approvedTemplates: 0 },
  ],
  sentryConfigured: true,
  teamsAlertsConfigured: false,
  confirmedTopologyMappings: 1,
  shadowTopologyMappings: 0,
};

describe('assessIntegrationActivationReadiness', () => {
  it('libera revisão quando os pré-requisitos técnicos e a política do piloto estão preenchidos', () => {
    const result = assessIntegrationActivationReadiness(baseline);
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.channels.every((channel) => channel.status === 'READY_FOR_REVIEW')).toBe(true);
    expect(result.externalDeliveryEnabled).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('exige template aprovado apenas para WhatsApp', () => {
    const result = assessIntegrationActivationReadiness({
      ...baseline,
      channels: [{ ...baseline.channels[0], approvedTemplates: 0 }],
    });
    expect(result.channels[0]?.blockers).toContain('nenhum template WhatsApp aprovado');
  });

  it('não confunde canal cadastrado com canal homologado', () => {
    const result = assessIntegrationActivationReadiness({
      ...baseline,
      channels: [{ ...baseline.channels[1], lastTestSucceeded: null }],
    });
    expect(result.channels[0]?.blockers).toContain('teste técnico ainda não aprovado');
  });

  it('aceita Teams interno como destino alternativo ao Sentry', () => {
    const result = assessIntegrationActivationReadiness({
      ...baseline,
      sentryConfigured: false,
      teamsAlertsConfigured: true,
    });
    expect(result.alertsConfigured).toBe(true);
    expect(result.blockers.join(' ')).not.toContain('destino de alertas');
  });
});
