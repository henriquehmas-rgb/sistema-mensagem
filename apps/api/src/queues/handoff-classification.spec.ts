import { describe, expect, it } from 'vitest';
import { classifyHandoff } from './handoff-classification';

describe('classifyHandoff', () => {
  it('keeps provider and IXC failures out of knowledge learning', () => {
    expect(classifyHandoff('fonte_operacional_indisponivel').disposition).toBe('TECHNICAL_INCIDENT');
    expect(classifyHandoff('falha_no_provedor_llm').disposition).toBe('TECHNICAL_INCIDENT');
    expect(classifyHandoff('ixc_indisponivel').disposition).toBe('TECHNICAL_INCIDENT');
    expect(classifyHandoff('olho_de_deus_indisponivel').disposition).toBe('TECHNICAL_INCIDENT');
    expect(classifyHandoff('timeout_da_integracao').disposition).toBe('TECHNICAL_INCIDENT');
    expect(classifyHandoff('credencial_da_integracao_invalida').disposition).toBe('TECHNICAL_INCIDENT');
  });

  it('creates a knowledge candidate only for missing approved knowledge', () => {
    expect(classifyHandoff('sem_contexto_na_base_de_conhecimento').disposition).toBe('KNOWLEDGE_GAP');
  });

  it('sends low confidence and operational recurrence to review, not learning', () => {
    expect(classifyHandoff('baixa_confianca_para_resposta_automatica').disposition).toBe('OPERATIONAL_REVIEW');
    expect(classifyHandoff('recorrencia_apos_atendimento_tecnico').disposition).toBe('OPERATIONAL_REVIEW');
    expect(classifyHandoff('commercial_approval_required').disposition).toBe('OPERATIONAL_REVIEW');
    expect(classifyHandoff('pedido_de_atendimento_humano').disposition).toBe('OPERATIONAL_REVIEW');
  });
});
