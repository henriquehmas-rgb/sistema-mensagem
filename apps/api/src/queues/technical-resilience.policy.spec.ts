import { describe, expect, it } from 'vitest';
import { classifyHandoff } from './handoff-classification';
import { resilientHandoffReason, technicalIncidentReason } from './technical-resilience.policy';

describe('technical resilience handoff policy', () => {
  it('keeps an IXC outage out of the knowledge queue even with a generic AI reason', () => {
    const reason = resilientHandoffReason('contexto_insuficiente', {
      ixcEvidenceStatus: 'unavailable',
    });

    expect(reason).toBe('ixc_indisponivel');
    expect(classifyHandoff(reason).disposition).toBe('TECHNICAL_INCIDENT');
  });

  it('keeps an Olho de Deus outage out of the knowledge queue', () => {
    const reason = resilientHandoffReason('sem_contexto_na_base_de_conhecimento', {
      ixcEvidenceStatus: 'success',
      networkReason: 'olho_de_deus_indisponivel',
    });

    expect(reason).toBe('olho_de_deus_indisponivel');
    expect(classifyHandoff(reason).disposition).toBe('TECHNICAL_INCIDENT');
  });

  it('preserves a real knowledge gap when operational sources are available', () => {
    const reason = resilientHandoffReason('sem_contexto_na_base_de_conhecimento', {
      ixcEvidenceStatus: 'empty',
      networkReason: 'evidencia_insuficiente_ou_conflitante',
    });

    expect(technicalIncidentReason({ ixcEvidenceStatus: 'empty' })).toBeNull();
    expect(reason).toBe('sem_contexto_na_base_de_conhecimento');
    expect(classifyHandoff(reason).disposition).toBe('KNOWLEDGE_GAP');
  });
});
