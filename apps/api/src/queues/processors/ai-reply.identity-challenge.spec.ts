import { describe, expect, it } from 'vitest';
import { billingAccountHolderRebindIntent, billingNeedsAccountHolderRebind, isCurrentAiReplyTrigger, resolveReplyRouteKey, responseRequestsIdentityChallenge, supportAccountHolderRebindIntent, supportNeedsAccountHolderRebind } from './ai-reply.processor';

describe('billingNeedsAccountHolderRebind', () => {
  it.each(['Essa fatura é de outro CPF', 'A conta é do meu pai', 'Não sou o titular'])('reconhece outro titular: %s', (content) => {
    expect(billingNeedsAccountHolderRebind([{ role: 'user', content }])).toBe(true);
  });
  it('não troca o titular por uma dúvida comum sobre boleto', () => {
    expect(billingNeedsAccountHolderRebind([{ role: 'user', content: 'Preciso da segunda via do boleto' }])).toBe(false);
  });
});

describe('supportNeedsAccountHolderRebind', () => {
  it('reconhece CPF diferente somente apos a pergunta sobre o cadastro atual', () => {
    expect(supportNeedsAccountHolderRebind([
      { role: 'assistant', content: 'Essa internet está no mesmo CPF e endereço desse cadastro?' },
      { role: 'user', content: 'Endereço sim, mas o CPF é diferente' },
    ])).toBe(true);
    expect(supportNeedsAccountHolderRebind([
      { role: 'assistant', content: 'Como posso te ajudar?' },
      { role: 'user', content: 'Meu CPF é diferente' },
    ])).toBe(false);
  });

  const question = 'Essa internet está no mesmo CPF e endereço desse cadastro?';
  it.each([
    'Endereço sim, CPF difere',
    'Endereço sim, mas o CPF é diferente',
    'Endereço sim, CPF não',
    'O CPF não é o mesmo, mas o endereço sim',
    'A internet está no CPF de outra pessoa',
  ])('reconhece a divergência de titular: %s', (reply) => {
    expect(supportAccountHolderRebindIntent([
      { role: 'assistant', content: question },
      { role: 'user', content: reply },
    ])).toBe('confirmed');
  });

  it.each([
    'O CPF não difere',
    'Endereço difere, mas o CPF é igual',
    'O CPF é o mesmo',
  ])('não troca titular se o CPF continua igual: %s', (reply) => {
    expect(supportAccountHolderRebindIntent([
      { role: 'assistant', content: question },
      { role: 'user', content: reply },
    ])).toBe('none');
  });

  it('pede esclarecimento se a divergência é incerta e entende a confirmação seguinte', () => {
    expect(supportAccountHolderRebindIntent([
      { role: 'assistant', content: question },
      { role: 'user', content: 'Acho que o CPF difere' },
    ])).toBe('uncertain');
    expect(supportAccountHolderRebindIntent([
      { role: 'assistant', content: 'Só para confirmar: o CPF do titular dessa internet é diferente do cadastro que encontrei?' },
      { role: 'user', content: 'Sim' },
    ])).toBe('confirmed');
    expect(supportAccountHolderRebindIntent([
      { role: 'assistant', content: 'Como posso te ajudar?' },
      { role: 'user', content: 'Endereço sim, CPF difere' },
    ])).toBe('none');
  });
});

describe('billingAccountHolderRebindIntent', () => {
  it.each(['O CPF difere', 'Essa fatura é de outro CPF', 'A conta é do meu pai'])('reconhece outro titular: %s', (reply) => {
    expect(billingAccountHolderRebindIntent([{ role: 'user', content: reply }])).toBe('confirmed');
  });
  it('distingue dúvida, igualdade e confirmação contextual', () => {
    expect(billingAccountHolderRebindIntent([{ role: 'user', content: 'Talvez o CPF difira' }])).toBe('uncertain');
    expect(billingAccountHolderRebindIntent([{ role: 'user', content: 'Acho que o CPF difere' }])).toBe('uncertain');
    expect(billingAccountHolderRebindIntent([{ role: 'user', content: 'O CPF não difere' }])).toBe('none');
    expect(billingAccountHolderRebindIntent([
      { role: 'assistant', content: 'Só para confirmar: o CPF do titular dessa conta é diferente do cadastro que encontrei?' },
      { role: 'user', content: 'Sim' },
    ])).toBe('confirmed');
  });
});

describe('responseRequestsIdentityChallenge', () => {
  it('abre o desafio quando a resposta pede os fatores aprovados', () => {
    expect(responseRequestsIdentityChallenge(
      'Pode me enviar o CPF completo do titular?',
    )).toBe(true);
    expect(responseRequestsIdentityChallenge(
      'Me informe o número do CPF para localizar o cadastro.',
    )).toBe(true);
  });

  it('não abre desafio para orientação que menciona CPF sem solicitá-lo', () => {
    expect(responseRequestsIdentityChallenge(
      'Não vou te pedir CPF agora; vamos continuar pela orientação técnica.',
    )).toBe(false);
  });
});

describe('isCurrentAiReplyTrigger', () => {
  it('mantém apenas o job da mensagem inbound mais recente', () => {
    expect(isCurrentAiReplyTrigger('msg_2', 'msg_2')).toBe(true);
    expect(isCurrentAiReplyTrigger('msg_1', 'msg_2')).toBe(false);
    expect(isCurrentAiReplyTrigger('msg_1', null)).toBe(false);
  });
});

describe('resolveReplyRouteKey', () => {
  it.each(['technical_support', 'billing', 'sales'])('não perde o setor %s em resposta genérica', (route) => {
    expect(resolveReplyRouteKey('unrouted', route)).toBe(route);
    expect(resolveReplyRouteKey(null, route)).toBe(route);
  });

  it('permite uma nova rota explícita quando o cliente muda de assunto', () => {
    expect(resolveReplyRouteKey('billing', 'sales')).toBe('billing');
  });
});
