import { describe, expect, it } from 'vitest';
import { deriveOperationalCaseState, deriveSupportCaseState } from './support-case-state.policy';

describe('deriveSupportCaseState', () => {
  it('mantém a queda como sintoma mesmo com "intern" truncado', () => {
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: true,
      messages: [{ role: 'user', content: 'Estou sem intern' }],
    });
    expect(state.currentSymptom).toBe('OUTAGE');
    expect(state.nextStep).toBe('REQUEST_ACCOUNT_IDENTITY');
    expect(state.losLight).toBe('UNKNOWN');
    expect(state.equipmentRestarted).toBe(false);
    expect(state.affectedMultipleDevices).toBe(false);
  });
  it('classifica internet parou de funcionar como indisponibilidade', () => {
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: true, identityRequiredNow: false,
      messages: [{ role: 'user', content: 'Minha Internet parou de funcionar' }],
    });
    expect(state.currentSymptom).toBe('OUTAGE');
  });
  it('entende o sim após a pergunta sobre LOS e não a pergunta de outro setor', () => {
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: true, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'Estou sem internet.' },
        { role: 'assistant', content: 'A luz LOS ainda está vermelha?' },
        { role: 'user', content: 'sim' },
      ],
    });
    expect(state.losLight).toBe('RED');
    expect(state.currentSymptom).toBe('OUTAGE');
  });

  it('entende o sim após uma pergunta de reinício sem repetir esse passo', () => {
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: true, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'Estou sem internet e a LOS está vermelha.' },
        { role: 'assistant', content: 'Você já reiniciou o equipamento?' },
        { role: 'user', content: 'sim' },
      ],
    });
    expect(state.equipmentRestarted).toBe(true);
    expect(state.losLight).toBe('RED');
  });
  it('preserva a transição de LOS vermelha para apagada sem retornar ao alarme', () => {
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'Estou sem internet e a luz LOS está vermelha. Já reiniciei o equipamento.' },
        { role: 'assistant', content: 'Quando a luz ficou vermelha?' },
        { role: 'user', content: 'A luz LOS apagou agora, mas a internet ficou lenta nos dois celulares.' },
      ],
    });
    expect(state.losLight).toBe('OFF');
    expect(state.currentSymptom).toBe('SLOWNESS');
    expect(state.affectedMultipleDevices).toBe(true);
    expect(state.equipmentRestarted).toBe(true);
    expect(state.internetLight).toBe('UNKNOWN');
    expect(state.nextStep).toBe('ASK_INTERNET_LIGHT');
  });

  it('só abre a etapa de identidade quando a consulta individual é necessária', () => {
    const base = {
      route: 'technical_support', identityVerified: false,
      messages: [{ role: 'user' as const, content: 'Minha internet está lenta nos dois celulares.' }],
    };
    expect(deriveSupportCaseState({ ...base, identityRequiredNow: false }).nextStep).not.toBe('REQUEST_ACCOUNT_IDENTITY');
    expect(deriveSupportCaseState({ ...base, identityRequiredNow: true }).nextStep).toBe('REQUEST_ACCOUNT_IDENTITY');
  });

  it('orienta a estabilização quando a LOS apagou e a luz de internet está piscando', () => {
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'A luz LOS apagou, mas continua lento nos dois celulares.' },
        { role: 'user', content: 'A luz de internet está piscando.' },
      ],
    });
    expect(state.nextStep).toBe('PROVIDE_STABILIZATION_GUIDANCE');
  });

  it('reconhece a variação "continua lento" como lentidão', () => {
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: false,
      messages: [{ role: 'user', content: 'A LOS apagou, mas continua lento nos dois celulares.' }],
    });
    expect(state.currentSymptom).toBe('SLOWNESS');
    expect(state.nextStep).toBe('ASK_INTERNET_LIGHT');
  });

  it('mantém os fatos do diagnóstico quando o início sai da janela de mensagens', () => {
    const previous = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'A LOS apagou, mas ficou lento nos dois celulares. Já reiniciei o roteador.' },
      ],
    });
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: false,
      previousState: previous,
      messages: [{ role: 'user', content: 'A lentidão continua.' }],
    });
    expect(state.losLight).toBe('OFF');
    expect(state.affectedMultipleDevices).toBe(true);
    expect(state.equipmentRestarted).toBe(true);
    expect(state.nextStep).toBe('ASK_INTERNET_LIGHT');
  });

  it('renova a segurança a cada turno, sem reaproveitar a validação anterior', () => {
    const previous = deriveSupportCaseState({
      route: 'technical_support', identityVerified: true, identityRequiredNow: false,
      messages: [{ role: 'user', content: 'A internet está lenta nos dois celulares.' }],
    });
    const state = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: true,
      previousState: previous,
      messages: [{ role: 'user', content: 'Pode consultar minha fatura?' }],
    });
    expect(state.identity).toEqual({ verified: false, requiredNow: true });
    expect(state.nextStep).toBe('REQUEST_ACCOUNT_IDENTITY');
  });

  it('não vaza contexto técnico quando a conversa muda de setor', () => {
    const previous = deriveSupportCaseState({
      route: 'technical_support', identityVerified: false, identityRequiredNow: false,
      messages: [{ role: 'user', content: 'A LOS apagou e está lento nos dois celulares.' }],
    });
    const state = deriveSupportCaseState({
      route: 'billing', identityVerified: false, identityRequiredNow: false,
      previousState: previous,
      messages: [{ role: 'user', content: 'Quero saber como funciona a segunda via.' }],
    });
    expect(state.route).toBe('other');
    expect(state.losLight).toBe('UNKNOWN');
    expect(state.currentSymptom).toBe('UNKNOWN');
  });

  it('mantém a qualificação de Vendas fora da janela textual, sem reabrir o perfil', () => {
    const first = deriveOperationalCaseState({
      route: 'sales', identityVerified: false, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'Quero uma proposta residencial.' },
        { role: 'assistant', content: 'No dia a dia, o que costuma pesar mais: streaming, jogos ou trabalho remoto?' },
        { role: 'user', content: 'Streaming e trabalho remoto.' },
      ],
    });
    const state = deriveOperationalCaseState({
      route: 'sales', identityVerified: false, identityRequiredNow: false, previousState: first,
      messages: [{ role: 'user', content: 'Quero continuar com a proposta.' }],
    });
    expect(state).toMatchObject({ route: 'sales', customerProfile: 'RESIDENTIAL', primaryUsage: 'STREAMING', nextStep: 'ASK_ADDRESS' });
  });

  it('pergunta o uso antes do local quando o pedido só diz que é residencial', () => {
    const state = deriveOperationalCaseState({
      route: 'sales', identityVerified: false, identityRequiredNow: false,
      messages: [{ role: 'user', content: 'Quero uma proposta de internet para casa.' }],
    });
    expect(state).toMatchObject({
      route: 'sales', customerProfile: 'RESIDENTIAL', primaryUsage: 'UNKNOWN', nextStep: 'ASK_PRIMARY_USAGE',
    });
  });

  it('segue para o local quando o cliente já informou o uso no primeiro pedido', () => {
    const state = deriveOperationalCaseState({
      route: 'sales', identityVerified: false, identityRequiredNow: false,
      messages: [{ role: 'user', content: 'Quero internet para jogos e trabalho remoto em casa.' }],
    });
    expect(state).toMatchObject({ route: 'sales', primaryUsage: 'GAMES', nextStep: 'ASK_ADDRESS' });
  });

  it('aceita um uso fora das opções sem repetir a mesma pergunta', () => {
    const state = deriveOperationalCaseState({
      route: 'sales', identityVerified: false, identityRequiredNow: false,
      messages: [
        { role: 'user', content: 'Quero um plano de internet.' },
        { role: 'assistant', content: 'Para eu te orientar melhor, o que você mais usa na internet no dia a dia: trabalho remoto, streaming, jogos ou outra coisa?' },
        { role: 'user', content: 'Principalmente para estudar e assistir aulas.' },
      ],
    });
    expect(state).toMatchObject({ route: 'sales', primaryUsage: 'OTHER', nextStep: 'ASK_ADDRESS' });
  });

  it('aceita CEP e número e abre a etapa factual uma vez, sem pedir cidade ou bairro', () => {
    const readyForCoverage = deriveOperationalCaseState({
      route: 'sales', identityVerified: false, identityRequiredNow: false,
      previousState: {
        schemaVersion: 1, route: 'sales', customerProfile: 'RESIDENTIAL', primaryUsage: 'STREAMING',
        cityNeighborhoodProvided: false, addressProvided: false, coverageEvidenceRequested: false,
        coverageCheckStatus: 'NOT_CHECKED',
        nextStep: 'ASK_ADDRESS',
      },
      messages: [
        { role: 'assistant', content: 'Para verificar a disponibilidade, me informe somente o CEP e o número do endereço.' },
        { role: 'user', content: '12345-678, 120.' },
      ],
    });
    expect(readyForCoverage).toMatchObject({
      route: 'sales', addressProvided: true,
      coverageEvidenceRequested: false, nextStep: 'REQUEST_COVERAGE_EVIDENCE',
    });

    const afterBoundary = deriveOperationalCaseState({
      route: 'sales', identityVerified: false, identityRequiredNow: false,
      previousState: readyForCoverage,
      messages: [{
        role: 'assistant',
        content: 'Obrigado. Com o endereço informado, a disponibilidade ainda precisa ser confirmada na base oficial antes de eu indicar os planos compatíveis. Não quero te prometer cobertura sem essa verificação.',
      }],
    });
    expect(afterBoundary).toMatchObject({ coverageEvidenceRequested: true, nextStep: 'CONTINUE_SAFE_QUALIFICATION' });
  });

  it('separa a demanda financeira da qualificação e sinaliza identidade apenas para consulta individual', () => {
    const state = deriveOperationalCaseState({
      route: 'billing', identityVerified: false, identityRequiredNow: true,
      messages: [{ role: 'user', content: 'Preciso da segunda via da minha fatura.' }],
    });
    expect(state).toMatchObject({ route: 'billing', requestKind: 'INVOICE_COPY', nextStep: 'REQUEST_ACCOUNT_IDENTITY' });
  });

  it('nao volta a pedir endereco depois de uma consulta oficial concluida por localizacao', () => {
    for (const coverageCheckStatus of ['CONFIRMED', 'NOT_AVAILABLE', 'INCONCLUSIVE', 'REVIEW_REQUIRED'] as const) {
      const state = deriveOperationalCaseState({
        route: 'sales', identityVerified: false, identityRequiredNow: false,
        previousState: {
          schemaVersion: 1, route: 'sales', customerProfile: 'UNKNOWN', primaryUsage: 'UNKNOWN',
          cityNeighborhoodProvided: false, addressProvided: false, coverageEvidenceRequested: false,
          coverageCheckStatus, nextStep: 'ASK_ADDRESS',
        },
        messages: [{ role: 'user', content: 'Quero um plano de internet' }],
      });
      expect(state).toMatchObject({ coverageCheckStatus, nextStep: 'CONTINUE_SAFE_QUALIFICATION' });
    }
  });
});
