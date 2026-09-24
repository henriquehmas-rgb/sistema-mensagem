import { describe, expect, it } from 'vitest';
import { guardReplySequence, type ReplySequenceInput } from './reply-sequence-guard';

const base: ReplySequenceInput = {
  route: 'sales', nextStep: 'ASK_PRIMARY_USAGE', reply: '',
  identityVerified: false, identityRequiredNow: false,
};

describe('guardReplySequence', () => {
  it('substitui o diagnóstico inventado após "Estou sem intern" pela identificação antes da checagem regional', () => {
    const decision = guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'REQUEST_ACCOUNT_IDENTITY',
      currentSymptom: 'OUTAGE', identityRequiredNow: true,
      supportLosLight: 'UNKNOWN', equipmentRestarted: false, affectedMultipleDevices: false,
      latestUserText: 'Estou sem intern',
      reply: 'Como a internet parou em todos os aparelhos e a luz vermelha continua após o reinício, verifique se o cabo fino de fibra está bem encaixado. Ele está conectado e inteiro?',
    });
    expect(decision.kind).toBe('REPLACE');
    if (decision.kind !== 'REPLACE') return;
    expect(decision.reason).toBe('support_unconfirmed_symptom');
    expect(decision.reply).toContain('CPF completo do titular');
    expect(decision.reply).not.toMatch(/luz vermelha|reinício|todos os aparelhos/i);
  });

  it('preserva fatos de sintomas realmente confirmados pelo cliente', () => {
    expect(guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'CONTINUE_SAFE_DIAGNOSIS',
      currentSymptom: 'OUTAGE', identityVerified: true, currentServiceConfirmed: true,
      regionalCheckComplete: true, supportLosLight: 'RED', equipmentRestarted: true,
      affectedMultipleDevices: true, customerReportedRedLight: true,
      reply: 'Como a internet parou em todos os aparelhos e a luz vermelha continua após o reinício, o cabo está bem encaixado?',
    }).kind).toBe('PASS');
  });

  it('não transforma uma pergunta simples sobre a luz em afirmação de luz vermelha', () => {
    expect(guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'ASK_LIGHT_STATE',
      currentSymptom: 'OUTAGE', identityVerified: true, currentServiceConfirmed: true,
      regionalCheckComplete: true, supportLosLight: 'UNKNOWN', equipmentRestarted: false,
      reply: 'Você percebe alguma luz vermelha no equipamento?',
    }).kind).toBe('PASS');
  });

  it('não inicia testes do equipamento antes de identificar a conexão', () => {
    const decision = guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'REQUEST_ACCOUNT_IDENTITY',
      currentSymptom: 'OUTAGE', identityRequiredNow: true,
      reply: 'Verifique se o cabo de fibra está encaixado. Ele está inteiro?',
    });
    expect(decision.kind).toBe('REPLACE');
    if (decision.kind !== 'REPLACE') return;
    expect(decision.reason).toBe('support_identity_before_local');
    expect(decision.reply).toContain('CPF completo do titular');
  });

  it('não afirma região normal quando a consulta regional não terminou', () => {
    expect(guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'CONTINUE_SAFE_DIAGNOSIS',
      currentSymptom: 'OUTAGE', identityVerified: true,
      currentServiceConfirmed: true, regionalCheckComplete: false,
      supportLosLight: 'UNKNOWN', equipmentRestarted: false,
      reply: 'A luz vermelha continua após o reinício.',
    })).toEqual({
      kind: 'HANDOFF', reason: 'verificacao_regional_indisponivel',
      violation: 'support_regional_before_local',
    });
  });
  it('impede pedir localização antes de entender o uso, mantendo a saudação inicial', () => {
    const decision = guardReplySequence({
      ...base,
      reply: 'Bom dia! Tudo bem?\n\nCompartilhe sua localização pelo clipe ou envie o CEP e o número.',
      firstResponse: true,
      opening: 'Bom dia! Tudo bem?',
    });
    expect(decision.kind).toBe('REPLACE');
    if (decision.kind !== 'REPLACE') return;
    expect(decision.reason).toBe('sales_usage_before_address');
    expect(decision.reply).toMatch(/^Bom dia! Tudo bem\?\n\nPara eu te orientar melhor/);
    expect(decision.reply).not.toMatch(/localização|CEP/i);
  });

  it('não bloqueia pergunta de uso nem localização quando esta já é a próxima etapa', () => {
    expect(guardReplySequence({ ...base, reply: 'O que você mais usa na internet?' }).kind).toBe('PASS');
    expect(guardReplySequence({ ...base, nextStep: 'ASK_ADDRESS', reply: 'Pode compartilhar sua localização?' }).kind).toBe('PASS');
    expect(guardReplySequence({ ...base, reply: 'Qual é o seu CEP?' }).kind).toBe('REPLACE');
    expect(guardReplySequence({ ...base, identityRequiredNow: true,
      reply: 'Qual é o endereço vinculado ao seu contrato?' }).kind).toBe('PASS');
  });

  it('impede diagnóstico local de queda antes da conclusão regional', () => {
    expect(guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'ASK_LIGHT_STATE',
      currentSymptom: 'OUTAGE', identityVerified: true,
      currentServiceConfirmed: true, regionalCheckComplete: false,
      reply: 'A luz LOS está vermelha?',
    })).toEqual({
      kind: 'HANDOFF', reason: 'verificacao_regional_indisponivel',
      violation: 'support_regional_before_local',
    });
  });

  it('permite o diagnóstico após checagem regional e não presume serviço ativo', () => {
    const support = {
      ...base, route: 'technical_support', nextStep: 'ASK_LIGHT_STATE',
      currentSymptom: 'OUTAGE', identityVerified: true,
      reply: 'A luz LOS está vermelha?',
    };
    expect(guardReplySequence({ ...support, currentServiceConfirmed: true, regionalCheckComplete: true }).kind).toBe('PASS');
    const noService = guardReplySequence({ ...support, currentServiceConfirmed: false, regionalCheckComplete: false });
    expect(noService.kind).toBe('REPLACE');
    if (noService.kind === 'REPLACE') expect(noService.reply).toContain('mesmo CPF e endereço desse cadastro?');
    expect(guardReplySequence({ ...support, currentServiceConfirmed: true,
      regionalCheckComplete: false, reply: 'Os vizinhos também estão sem internet?' }).kind).toBe('HANDOFF');
    expect(guardReplySequence({ ...support, currentServiceConfirmed: true,
      regionalCheckComplete: false, reply: 'Não há queda na região.' }).kind).toBe('HANDOFF');
    expect(guardReplySequence({ ...support, currentServiceConfirmed: true,
      regionalCheckComplete: false, regionalEventConfirmed: true })).toEqual({
      kind: 'HANDOFF', reason: 'ocorrencia_regional_confirmada_pendente_registro',
      violation: 'support_regional_before_local',
    });
  });

  it('prioriza ocorrência regional registrada sobre diagnóstico residencial', () => {
    const decision = guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'ASK_LIGHT_STATE',
      currentSymptom: 'OUTAGE', identityVerified: true,
      currentServiceConfirmed: true, regionalCheckComplete: true,
      regionalIncidentRegistered: true, reply: 'A luz LOS está vermelha?',
    });
    expect(decision.kind).toBe('REPLACE');
    if (decision.kind !== 'REPLACE') return;
    expect(decision.reason).toBe('support_regional_event_first');
    expect(decision.reply).toContain('instabilidade regional confirmada');
    expect(decision.reply).not.toContain('LOS');
    expect(guardReplySequence({
      ...base, route: 'technical_support', nextStep: 'ASK_LIGHT_STATE',
      currentSymptom: 'OUTAGE', identityVerified: true,
      currentServiceConfirmed: true, regionalCheckComplete: true,
      regionalIncidentRegistered: true, latestUserText: 'A internet voltou a funcionar',
      reply: 'Ótimo, a conexão voltou. Se falhar novamente, me avise.',
    }).kind).toBe('PASS');
  });

  it('não divulga situação individual da cobrança antes de validar o titular', () => {
    const billing = {
      ...base, route: 'billing', nextStep: 'REQUEST_ACCOUNT_IDENTITY',
      identityRequiredNow: true, reply: 'Sua fatura está paga.',
    };
    const decision = guardReplySequence(billing);
    expect(decision.kind).toBe('REPLACE');
    if (decision.kind !== 'REPLACE') return;
    expect(decision.reason).toBe('billing_identity_before_account_fact');
    expect(decision.reply).toContain('CPF completo do titular');
    expect(guardReplySequence({ ...billing, identityVerified: true }).kind).toBe('PASS');
    expect(guardReplySequence({ ...billing, reply: 'Sua fatura é de R$ 80,00.' }).kind).toBe('REPLACE');
    expect(guardReplySequence({ ...billing, identityRequiredNow: false, reply: 'Posso explicar como funciona uma fatura.' }).kind).toBe('PASS');
  });
});
