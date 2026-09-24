import { describe, expect, it } from 'vitest';
import { latestConsecutiveUserText, planIxcReads, previousCustomerRequestText } from './ixc-query-planner';

describe('planIxcReads', () => {
  it('considera mensagens consecutivas antes da primeira resposta', () => {
    const text = latestConsecutiveUserText([
      { role: 'user', content: 'Oi' },
      { role: 'user', content: 'Estou sem internet' },
      { role: 'user', content: 'Faz muito tempo' },
    ]);
    const plan = planIxcReads(text, null);
    expect(plan.operationalRouteHint).toBe('technical_support');
    expect(plan.actions).toContain('connections');
    expect(plan.requiresIdentity).toBe(true);
  });

  it.each([
    {
      messages: ['Oi', 'Quero contratar internet', 'Para minha casa'],
      route: 'sales', requiredAction: null, requiresIdentity: false,
    },
    {
      messages: ['Oi', 'Preciso da segunda via da minha fatura', 'Vence hoje'],
      route: 'billing', requiredAction: 'invoices', requiresIdentity: true,
    },
  ])('preserva o setor $route em mensagens consecutivas', ({ messages, route, requiredAction, requiresIdentity }) => {
    const text = latestConsecutiveUserText(messages.map((content) => ({ role: 'user' as const, content })));
    const plan = planIxcReads(text, null);
    expect(plan.operationalRouteHint).toBe(route);
    if (requiredAction) expect(plan.actions).toContain(requiredAction);
    expect(plan.requiresIdentity).toBe(requiresIdentity);
  });

  it.each([
    { previous: 'Minha fatura venceu', current: 'Estou sem internet', oldRoute: 'billing', route: 'technical_support' },
    { previous: 'Estou sem internet', current: 'Preciso da segunda via da fatura', oldRoute: 'technical_support', route: 'billing' },
    { previous: 'Minha fatura venceu', current: 'Quero contratar internet', oldRoute: 'billing', route: 'sales' },
  ])('não mistura $route com um setor antigo após validar identidade', ({ previous, current, oldRoute, route }) => {
    const messages = [
      { role: 'user' as const, content: previous },
      { role: 'assistant' as const, content: 'Como posso ajudar?' },
      { role: 'user' as const, content: current },
      { role: 'assistant' as const, content: 'Pode confirmar o cadastro?' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
    ];
    const priorText = previousCustomerRequestText(messages);
    expect(priorText).toBe(current);
    expect(planIxcReads(latestConsecutiveUserText(messages), oldRoute, priorText).operationalRouteHint).toBe(route);
  });

  it('recupera o pedido quando o marcador chega no mesmo bloco de mensagens', () => {
    const messages = [
      { role: 'user' as const, content: 'Preciso da segunda via da fatura' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
    ];
    expect(previousCustomerRequestText(messages)).toBe('Preciso da segunda via da fatura');
  });

  it.each([
    { request: 'Estou sem internet', route: 'technical_support', action: 'connections' },
    { request: 'Preciso da segunda via da fatura', route: 'billing', action: 'invoices' },
  ])('retoma $route depois de CPF incorreto, correção e validação no mesmo turno', ({ request, route, action }) => {
    const messages = [
      { role: 'user' as const, content: request },
      { role: 'assistant' as const, content: 'Envie o CPF do titular.' },
      { role: 'user' as const, content: '[Identidade não confirmada]' },
      { role: 'assistant' as const, content: 'Confira e envie novamente.' },
      { role: 'user' as const, content: 'Ah, errei o último número, desculpa' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
    ];
    const prior = previousCustomerRequestText(messages);
    expect(prior).toBe(request);
    const plan = planIxcReads(latestConsecutiveUserText(messages), route, prior);
    expect(plan.actions).toContain(action);
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.continuedFromPrevious).toBe(true);
  });

  it('não deixa uma correção de CPF mudar o setor solicitado mais recentemente', () => {
    const messages = [
      { role: 'user' as const, content: 'Minha fatura venceu' },
      { role: 'assistant' as const, content: 'Como posso ajudar?' },
      { role: 'user' as const, content: 'Agora estou sem internet' },
      { role: 'assistant' as const, content: 'Envie o CPF do titular.' },
      { role: 'user' as const, content: 'Errei o último número, desculpa' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
    ];
    const prior = previousCustomerRequestText(messages);
    expect(prior).toBe('Agora estou sem internet');
    const plan = planIxcReads(latestConsecutiveUserText(messages), 'billing', prior);
    expect(plan.actions).toContain('connections');
    expect(plan.actions).not.toContain('invoices');
    expect(plan.operationalRouteHint).toBe('technical_support');
  });

  it.each([
    { from: 'technical_support', previous: 'Estou sem internet', to: 'sales', current: 'Agora quero contratar internet', action: null, identity: false },
    { from: 'technical_support', previous: 'Estou sem internet', to: 'billing', current: 'Agora preciso da segunda via da fatura', action: 'invoices', identity: true },
    { from: 'sales', previous: 'Quero contratar internet', to: 'technical_support', current: 'Agora estou sem internet', action: 'connections', identity: true },
    { from: 'sales', previous: 'Quero contratar internet', to: 'billing', current: 'Agora preciso da segunda via da fatura', action: 'invoices', identity: true },
    { from: 'billing', previous: 'Preciso da segunda via da fatura', to: 'technical_support', current: 'Agora estou sem internet', action: 'connections', identity: true },
    { from: 'billing', previous: 'Preciso da segunda via da fatura', to: 'sales', current: 'Agora quero contratar internet', action: null, identity: false },
  ])('prioriza $to após validar identidade em $from no mesmo bloco', ({ from, previous, to, current, action, identity }) => {
    const messages = [
      { role: 'user' as const, content: previous },
      { role: 'assistant' as const, content: 'Pode confirmar o cadastro?' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
      { role: 'user' as const, content: current },
    ];
    const plan = planIxcReads(
      latestConsecutiveUserText(messages), from, previousCustomerRequestText(messages),
    );
    expect(plan.operationalRouteHint).toBe(to);
    expect(plan.requiresIdentity).toBe(identity);
    expect(plan.continuedFromPrevious).toBe(false);
    if (action) expect(plan.actions).toContain(action);
    if (to !== 'technical_support') expect(plan.actions).not.toContain('connections');
    if (to !== 'billing') expect(plan.actions).not.toContain('invoices');
  });

  it('não mistura pedidos quando marcador e troca de setor vêm no mesmo bloco sem resposta intermediária', () => {
    const messages = [
      { role: 'user' as const, content: 'Estou sem internet' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
      { role: 'user' as const, content: 'Agora quero contratar internet' },
    ];
    const plan = planIxcReads(
      latestConsecutiveUserText(messages), 'technical_support', previousCustomerRequestText(messages),
    );
    expect(plan.operationalRouteHint).toBe('sales');
    expect(plan.actions).not.toContain('connections');
    expect(plan.requiresIdentity).toBe(false);
  });

  it('troca para o pedido financeiro após correção de CPF e validação, sem herdar suporte', () => {
    const messages = [
      { role: 'user' as const, content: 'Estou sem internet' },
      { role: 'assistant' as const, content: 'Envie o CPF do titular.' },
      { role: 'user' as const, content: 'Errei o último número, desculpa' },
      { role: 'user' as const, content: '[Identidade validada com segurança]' },
      { role: 'user' as const, content: 'Agora preciso da segunda via da fatura' },
    ];
    const plan = planIxcReads(
      latestConsecutiveUserText(messages), 'technical_support', previousCustomerRequestText(messages),
    );
    expect(plan.operationalRouteHint).toBe('billing');
    expect(plan.actions).toEqual(['invoices', 'contracts']);
  });

  it('retoma o pedido anterior quando após a validação há apenas uma resposta breve', () => {
    const plan = planIxcReads(
      '[Identidade validada com segurança]\nSim', 'technical_support', 'Estou sem internet',
    );
    expect(plan.operationalRouteHint).toBe('technical_support');
    expect(plan.actions).toContain('connections');
    expect(plan.continuedFromPrevious).toBe(true);
  });

  it('mantém a consulta técnica após uma resposta curta de duração', () => {
    const plan = planIxcReads('Faz muito tempo', 'technical_support', 'Estou sem internet');
    expect(plan.operationalRouteHint).toBe('technical_support');
    expect(plan.actions).toContain('connections');
    expect(plan.requiresIdentity).toBe(true);
  });

  it.each([
    { text: 'Continua sem internet', oldRoute: 'billing', oldRequest: 'Minha fatura venceu', route: 'technical_support' },
    { text: 'Desde hoje quero comprar internet', oldRoute: 'technical_support', oldRequest: 'Minha internet caiu', route: 'sales' },
  ])('prioriza um novo pedido explícito mesmo quando começa como continuação', ({ text, oldRoute, oldRequest, route }) => {
    expect(planIxcReads(text, oldRoute, oldRequest).operationalRouteHint).toBe(route);
  });

  it.each([
    { text: 'Quero internet para minha casa', route: 'sales', identity: false },
    { text: 'Quero assinar internet', route: 'sales', identity: false },
    { text: 'Oi. Preciso comprar internet', route: 'sales', identity: false },
    { text: 'A internet não está funcionando', route: 'technical_support', identity: true },
    { text: 'Minha velocidade está abaixo do plano', route: 'technical_support', identity: true },
    { text: 'Preciso pagar a mensalidade', route: 'billing', identity: true },
  ])('planeja $route em linguagem natural: $text', ({ text, route, identity }) => {
    const plan = planIxcReads(text, null);
    expect(plan.operationalRouteHint).toBe(route);
    expect(plan.requiresIdentity).toBe(identity);
  });

  it('não incorpora mensagens anteriores à resposta do atendente', () => {
    expect(latestConsecutiveUserText([
      { role: 'user', content: 'Minha fatura' },
      { role: 'assistant', content: 'Qual é a dúvida?' },
      { role: 'user', content: 'Estou sem internet' },
    ])).toBe('Estou sem internet');
  });
  it('planeja financeiro sem permitir ações de escrita', () => {
    const plan = planIxcReads('Minha fatura está atrasada?', 'billing');
    expect(plan.actions).toEqual(expect.arrayContaining(['invoices', 'contracts']));
    expect(JSON.stringify(plan)).not.toMatch(/create|update|delete|write/i);
  });

  it('não consulta o IXC para uma política financeira geral', () => {
    const plan = planIxcReads('Quais são as regras gerais de juros e parcelamento?', 'billing');
    expect(plan.actions).toEqual([]);
    expect(plan.requiresIdentity).toBe(false);
    expect(plan.identityGate).toBe('NOT_REQUIRED');
  });

  it('não pede identidade para explicar parcelamento de forma geral', () => {
    const plan = planIxcReads('Como funciona o parcelamento da fatura?', 'billing');
    expect(plan.actions).toEqual([]);
    expect(plan.requiresIdentity).toBe(false);
    expect(plan.identityGate).toBe('NOT_REQUIRED');
  });

  it('protege parcelamento da própria fatura', () => {
    const plan = planIxcReads('Posso parcelar minha fatura?', 'billing');
    expect(plan.actions).toEqual(expect.arrayContaining(['invoices', 'contracts']));
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('recupera a segunda via depois dos fatores de identidade', () => {
    const plan = planIxcReads(
      '12345678901',
      'billing',
      'Preciso da segunda via da minha fatura.',
    );
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.actions).toEqual(expect.arrayContaining(['invoices', 'contracts']));
  });

  it('preserva o contexto quando os fatores chegam em linguagem natural', () => {
    const plan = planIxcReads(
      'Meu CPF é 123.456.789-01.',
      'billing',
      'Preciso da segunda via da minha fatura.',
    );
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.actions).toEqual(expect.arrayContaining(['invoices', 'contracts']));
  });

  it('aceita mês sem zero à esquerda como continuidade, sem consultar antes de validar', () => {
    const plan = planIxcReads(
      'CPF 123.456.789-01',
      'technical_support',
      'Você consegue verificar se existe chamado aberto para minha conexão?',
    );
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('exige identidade para verificar pagamento ainda não compensado', () => {
    const plan = planIxcReads('Paguei a fatura, mas o pagamento ainda não compensou.', 'billing');
    expect(plan.actions).toEqual(expect.arrayContaining(['invoices', 'contracts']));
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('exige identidade antes de alterar o plano da própria conta', () => {
    const plan = planIxcReads('Quero mudar para outro plano de internet.', 'sales');
    expect(plan.actions).toContain('contracts');
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('mantém interesse comercial geral sem pedir identidade', () => {
    const plan = planIxcReads('Quais planos estão disponíveis?', 'sales');
    expect(plan.requiresIdentity).toBe(false);
    expect(plan.identityGate).toBe('NOT_REQUIRED');
  });

  it('antecipa Vendas no primeiro turno residencial sem consultar cadastro', () => {
    const plan = planIxcReads('Quero uma proposta de internet para casa.', null);
    expect(plan).toMatchObject({
      actions: [],
      requiresIdentity: false,
      identityGate: 'NOT_REQUIRED',
      operationalRouteHint: 'sales',
    });
  });

  it('não deixa uma nova pergunta comercial herdar a consulta financeira anterior', () => {
    const plan = planIxcReads('Também quero conhecer os planos de internet disponíveis.', 'billing');
    expect(plan.actions).toEqual([]);
    expect(plan.requiresIdentity).toBe(false);
    expect(plan.identityGate).toBe('NOT_REQUIRED');
    expect(plan.reason).toBeNull();
  });

  it('combina conexão, chamado e contrato no suporte técnico', () => {
    expect(planIxcReads('Minha internet caiu', 'technical_support').actions).toEqual(
      expect.arrayContaining(['connections', 'service_orders', 'contracts', 'fiber_access']),
    );
  });

  it('identifica o cadastro já no primeiro relato de queda, antes da consulta IXC/ODG', () => {
    const plan = planIxcReads('Minha internet caiu', null);
    expect(plan.operationalRouteHint).toBe('technical_support');
    expect(plan.actions).toEqual(expect.arrayContaining(['connections', 'service_orders', 'tickets', 'contracts', 'fiber_access']));
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('não consulta o IXC quando a conversa não pede dados operacionais', () => {
    expect(planIxcReads('Qual é o horário de atendimento?', 'general_support')).toEqual({
      actions: [], requiresIdentity: false, identityGate: 'NOT_REQUIRED', reason: null, continuedFromPrevious: false,
      operationalRouteHint: null,
    });
  });

  it('não deixa uma intenção financeira antiga contaminar um assunto novo', () => {
    expect(planIxcReads('Qual é o horário de atendimento?', 'billing').actions).toEqual([]);
  });

  it('mantém a intenção anterior somente em continuação explícita', () => {
    const plan = planIxcReads('E isso continua?', 'technical_support');
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.actions).toEqual(expect.arrayContaining(['connections', 'service_orders', 'contracts']));
  });

  it('reconhece pergunta pronominal sobre registros da resposta anterior', () => {
    const plan = planIxcReads(
      'E qual dessas duas foi aberta por último?',
      'general_support',
      'Existe chamado ou ordem de serviço aberta para essa conexão?',
    );
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.actions).toEqual(expect.arrayContaining(['service_orders', 'tickets']));
  });

  it('reconhece continuação iniciada por "dessas"', () => {
    const plan = planIxcReads(
      'Dessas duas ordens, qual foi aberta por último?',
      'general_support',
      'Existe chamado ou ordem de serviço aberta para essa conexão?',
    );
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.actions).toContain('service_orders');
  });

  it('preserva suporte quando fatores chegam após expiração do desafio de identidade', () => {
    const plan = planIxcReads('12345678901', 'general_support', 'Minha internet caiu e a luz LOS está vermelha');
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.actions).toEqual(expect.arrayContaining([
      'connections', 'service_orders', 'tickets', 'contracts', 'fiber_access',
    ]));
  });

  it('recupera a solicitação original depois que a identidade é validada', () => {
    const plan = planIxcReads(
      '[Identidade validada com segurança]',
      'general_support',
      'Minha internet caiu e a luz LOS está vermelha',
    );
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.actions).toEqual(expect.arrayContaining([
      'connections', 'service_orders', 'tickets', 'contracts', 'fiber_access',
    ]));
  });

  it('confirma o cadastro antes de concluir a situação regional da conexão', () => {
    const plan = planIxcReads('Estou sem internet e a luz LOS está vermelha', 'technical_support');
    expect(plan.actions).toContain('connections');
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('não pede identidade ao informar apenas o estado da luz de internet', () => {
    const plan = planIxcReads('A luz de internet está piscando.', 'technical_support');
    expect(plan.requiresIdentity).toBe(false);
    expect(plan.identityGate).not.toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('pede identidade quando a pessoa solicita dados da própria OS', () => {
    const plan = planIxcReads('Você consegue verificar se existe chamado ou OS aberta para minha conexão?', 'technical_support');
    expect(plan.actions).toEqual(expect.arrayContaining(['connections', 'service_orders', 'tickets']));
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.identityGate).toBe('REQUIRED_FOR_ACCOUNT_LOOKUP');
  });

  it('trata internet parou como indisponibilidade desde o primeiro turno', () => {
    const plan = planIxcReads('Minha internet parou', null);
    expect(plan.operationalRouteHint).toBe('technical_support');
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.actions).toEqual(expect.arrayContaining([
      'connections', 'service_orders', 'tickets', 'contracts', 'fiber_access',
    ]));
  });

  it('não perde a checagem de indisponibilidade quando a mensagem termina em "sem intern"', () => {
    const plan = planIxcReads('Estou sem intern', null);
    expect(plan.operationalRouteHint).toBe('technical_support');
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.actions).toContain('connections');
    expect(planIxcReads('Estou sem internação', null).actions).not.toContain('connections');
  });

  it('mantem o contexto tecnico apos resposta breve antes da consulta factual', () => {
    const plan = planIxcReads('Nao sei', 'technical_support', 'Minha internet parou');
    expect(plan.continuedFromPrevious).toBe(true);
    expect(plan.requiresIdentity).toBe(true);
    expect(plan.actions).toContain('connections');
  });
});
