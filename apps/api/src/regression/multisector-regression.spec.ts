import { describe, expect, it } from 'vitest';
import { latestConsecutiveUserText, planIxcReads, previousCustomerRequestText } from '../integrations/ixc/ixc-query-planner';
import { evaluateShadowAction } from '../operational-actions/operational-action-shadow';
import { classifyHandoff } from '../queues/handoff-classification';
import { handoffMessage } from '../queues/handoff-message';
import { whatsappReplyParts } from '../queues/whatsapp-humanization';
import { deriveSupportCaseState } from '../support-case-state/support-case-state.policy';

/**
 * Portão único de regressão das regras que não podem voltar a falhar entre
 * setores. Não chama IA, IXC nem cria conversas: é seguro rodar a cada release.
 */
describe('regressão multissetorial', () => {
  it('preserva a evolução de LOS para lentidão antes de pedir identidade', () => {
    const diagnosis = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'Estou sem internet e a luz LOS está vermelha. Já reiniciei o equipamento.' },
        { role: 'assistant', content: 'Você percebeu quando a luz ficou vermelha?' },
        { role: 'user', content: 'A LOS apagou, mas a internet ficou lenta nos dois celulares.' },
      ],
    });

    expect(diagnosis).toMatchObject({
      losLight: 'OFF', currentSymptom: 'SLOWNESS', affectedMultipleDevices: true,
      nextStep: 'ASK_INTERNET_LIGHT',
    });
    expect(planIxcReads('A luz de internet está piscando.', 'technical_support').identityGate)
      .not.toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('distingue regra financeira pública de consulta da própria cobrança', () => {
    expect(planIxcReads('Como funciona o parcelamento da fatura?', 'billing')).toMatchObject({
      actions: [], requiresIdentity: false, identityGate: 'NOT_REQUIRED',
    });
    expect(planIxcReads('Preciso da segunda via da minha fatura.', 'billing')).toMatchObject({
      actions: ['invoices', 'contracts'], requiresIdentity: true,
      identityGate: 'REQUIRED_FOR_ACCOUNT_LOOKUP',
    });
  });

  it('mantém o pedido original quando a pessoa responde à identidade com texto natural', () => {
    const plan = planIxcReads(
      'Meu CPF é 123.456.789-01',
      'billing',
      'Preciso da segunda via da minha fatura.',
    );
    expect(plan).toMatchObject({
      continuedFromPrevious: true,
      requiresIdentity: true,
      identityGate: 'REQUIRED_FOR_ACCOUNT_LOOKUP',
    });
  });

  it('consulta o pedido original após CPF corrigido e validação no mesmo turno', () => {
    const messages = [
      { role: 'user' as const, content: 'Estou sem internet' },
      { role: 'assistant' as const, content: 'Envie o CPF do titular.' },
      { role: 'user' as const, content: '[Identidade não confirmada]' },
      { role: 'assistant' as const, content: 'Pode conferir?' },
      { role: 'user' as const, content: 'Ah, errei o último número, desculpa' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
    ];
    const plan = planIxcReads(
      latestConsecutiveUserText(messages), 'technical_support', previousCustomerRequestText(messages),
    );
    expect(plan.actions).toContain('connections');
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('mantém respostas curtas em suporte, vendas e financeiro sem esconder fatos', () => {
    for (const reason of [
      'verificacao_regional_nao_executada',
      'commercial_approval_required',
      'confirmacao_titular_financeiro_indisponivel',
    ]) {
      const reply = handoffMessage(reason, 'conv-piloto');
      expect(reply.length).toBeLessThanOrEqual(160);
      expect(whatsappReplyParts(reply)).toEqual([reply]);
    }
  });

  it('não deixa uma nova intenção de Vendas herdar a consulta financeira', () => {
    const plan = planIxcReads('Quais planos estão disponíveis?', 'billing');
    expect(plan).toMatchObject({ actions: [], requiresIdentity: false, identityGate: 'NOT_REQUIRED' });
  });

  it('classifica falha técnica como incidente, sem contaminar aprendizagem', () => {
    expect(classifyHandoff('validacao_temporariamente_indisponivel')).toMatchObject({
      disposition: 'TECHNICAL_INCIDENT',
    });
    expect(classifyHandoff('falha_no_provedor_llm')).toMatchObject({
      disposition: 'TECHNICAL_INCIDENT',
    });
    expect(classifyHandoff('sem_contexto_na_base_de_conhecimento')).toMatchObject({
      disposition: 'KNOWLEDGE_GAP',
    });
  });

  it('impede proposta individual quando a evidência de rede é coletiva ou inconclusiva', () => {
    const base = {
      allowedActions: ['request_ticket'], forbiddenActions: [], minimumConfidence: 0.9,
      triageConfidence: 0.95, handoff: false, clarification: false,
      evidence: {
        source: 'IXC' as const, customerRef: 'customer_test', status: 'success' as const,
        observedAt: '2026-09-14T00:00:00Z',
        facts: [{ resource: 'contracts' as const, entityRef: 'contract_test', fields: { status: 'A' } }],
      },
    };

    expect(evaluateShadowAction({ ...base, networkDiagnosis: 'COLLECTIVE_OUTAGE_CONFIRMED' }))
      .toMatchObject({ eligible: false, reason: 'collective_outage_blocks_individual_action' });
    expect(evaluateShadowAction({ ...base, networkDiagnosis: 'INCONCLUSIVE' }))
      .toMatchObject({ eligible: false, reason: 'network_context_not_actionable' });
  });
});
