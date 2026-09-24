import type {
  BillingCaseState,
  BillingRequestKind,
  CaseStateMessage,
  CurrentSymptom,
  LightState,
  OperationalCaseState,
  SalesCaseState,
  SalesCustomerProfile,
  SalesPrimaryUsage,
  SupportCaseState,
} from './support-case-state.types';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function symptomFor(value: string): CurrentSymptom | null {
  // Clientes alternam naturalmente entre "internet lenta", "continua lento"
  // e "ficou lento". Todas descrevem o mesmo sintoma e precisam atualizar o
  // estado antes que o diagnóstico avance para a próxima pergunta.
  if (hasAny(value, ['lenta', 'lento', 'lentidao', 'travando'])) return 'SLOWNESS';
  if (hasAny(value, ['oscil', 'instavel'])) return 'INSTABILITY';
  if (/\bsem\s+intern(?:et)?\b/.test(value)) return 'OUTAGE';
  if (hasAny(value, [
    'sem internet', 'internet caiu', 'internet parou', 'internet nao funciona',
    'internet nao pega', 'sem conexao', 'sem rede', 'offline',
  ])) return 'OUTAGE';
  return null;
}

function losFor(value: string): LightState | null {
  if (!value.includes('los')) return null;
  // "apagou" sempre prevalece sobre referências antigas a "vermelha" no mesmo turno.
  if (hasAny(value, ['los apagou', 'los apagada', 'los esta apagada', 'los continua apagada'])) return 'OFF';
  if (hasAny(value, ['vermelh', 'pisc', 'acesa'])) return 'RED';
  return null;
}

function internetFor(value: string): LightState | null {
  // "A luz LOS apagou, mas a internet ficou lenta" menciona internet e luz,
  // porém "apagou" se refere à LOS, não ao LED de internet. Só tratamos o
  // indicador quando ele é citado explicitamente como luz/LED de internet.
  if (!/(?:luz|led)\s+(?:de\s+)?internet/.test(value)) return null;
  if (hasAny(value, ['pisc', 'pisca'])) return 'BLINKING';
  if (hasAny(value, ['apagada', 'apagou'])) return 'OFF';
  if (hasAny(value, ['acesa', 'normal'])) return 'ON';
  return null;
}

export function deriveSupportCaseState(input: {
  messages: CaseStateMessage[];
  route: string | null;
  identityVerified: boolean;
  identityRequiredNow: boolean;
  /** Estado estruturado anterior do mesmo atendimento, sem dados pessoais. */
  previousState?: SupportCaseState | null;
}): SupportCaseState {
  // Apenas o fluxo técnico pode herdar o diagnóstico anterior. Isso impede
  // que uma conversa que mude para Financeiro ou Vendas carregue fatos de
  // suporte para outro setor.
  const previous = input.route === 'technical_support'
    && input.previousState?.route === 'technical_support'
    ? input.previousState
    : null;
  let currentSymptom: CurrentSymptom = previous?.currentSymptom ?? 'UNKNOWN';
  let losLight: LightState = previous?.losLight ?? 'UNKNOWN';
  let internetLight: LightState = previous?.internetLight ?? 'UNKNOWN';
  let affectedMultipleDevices = previous?.affectedMultipleDevices ?? false;
  let equipmentRestarted = previous?.equipmentRestarted ?? false;
  let wiredTestUnavailable = previous?.wiredTestUnavailable ?? false;
  let stabilizationGuidanceDelivered = previous?.stabilizationGuidanceDelivered ?? false;
  let lastAssistantQuestion = '';

  for (const message of input.messages) {
    if (message.role === 'assistant') {
      lastAssistantQuestion = normalize(message.content);
      continue;
    }
    const text = normalize(message.content);
    const symptom = symptomFor(text);
    const los = losFor(text);
    const internet = internetFor(text);
    if (symptom) currentSymptom = symptom;
    if (los) losLight = los;
    if (
      /^(?:sim|isso|essa mesma|continua)(?:[.! ]*)$/.test(text.trim())
      && /\blos\b.*(?:vermelh|acesa|pisc)/.test(lastAssistantQuestion)
      && lastAssistantQuestion.includes('?')
    ) losLight = 'RED';
    if (internet) internetLight = internet;
    affectedMultipleDevices ||= hasAny(text, ['dois celulares', 'dois aparelhos', 'mais de um aparelho', 'todos os aparelhos']);
    equipmentRestarted ||= hasAny(text, ['reinic', 'desliguei', 'liguei o equipamento', 'liguei o roteador']);
    equipmentRestarted ||= /^(?:sim|ja fiz|fiz isso)(?:[.! ]*)$/.test(text.trim())
      && /(?:reinici|desligou da tomada|desligou o equipamento)/.test(lastAssistantQuestion)
      && lastAssistantQuestion.includes('?');
    wiredTestUnavailable ||= hasAny(text, ['nao tenho computador', 'nao tenho notebook', 'sem computador', 'sem teste por cabo']);
    lastAssistantQuestion = '';
  }
  stabilizationGuidanceDelivered ||= input.messages.some((message) => (
    message.role === 'assistant'
    && hasAny(normalize(message.content), [
      'mantenha o equipamento ligado',
      'evite reinicia-lo de novo',
      'evite reiniciar o equipamento de novo',
    ])
  ));

  let nextStep: SupportCaseState['nextStep'] = 'CONTINUE_SAFE_DIAGNOSIS';
  if (input.identityRequiredNow && !input.identityVerified) {
    nextStep = 'REQUEST_ACCOUNT_IDENTITY';
  } else if (input.route === 'technical_support' && losLight === 'RED') {
    nextStep = 'ASK_LOS_DURATION';
  } else if (
    input.route === 'technical_support'
    && losLight === 'OFF'
    && currentSymptom === 'SLOWNESS'
    && affectedMultipleDevices
    && internetLight === 'UNKNOWN'
  ) {
    nextStep = 'ASK_INTERNET_LIGHT';
  } else if (
    input.route === 'technical_support'
    && losLight === 'OFF'
    && currentSymptom === 'SLOWNESS'
    && affectedMultipleDevices
    && internetLight === 'BLINKING'
    && !stabilizationGuidanceDelivered
  ) {
    nextStep = 'PROVIDE_STABILIZATION_GUIDANCE';
  } else if (input.route === 'technical_support' && currentSymptom === 'SLOWNESS' && affectedMultipleDevices && internetLight === 'UNKNOWN') {
    nextStep = 'ASK_LIGHT_STATE';
  }

  return {
    schemaVersion: 1,
    route: input.route === 'technical_support' ? 'technical_support' : 'other',
    currentSymptom,
    affectedMultipleDevices,
    equipmentRestarted,
    wiredTestUnavailable,
    losLight,
    internetLight,
    stabilizationGuidanceDelivered,
    identity: { verified: input.identityVerified, requiredNow: input.identityRequiredNow },
    nextStep,
  };
}

function salesProfileFor(value: string): SalesCustomerProfile | null {
  if (hasAny(value, ['empresa', 'empresarial', 'comercio', 'comercial'])) return 'BUSINESS';
  if (hasAny(value, ['residencial', 'casa', 'apartamento'])) return 'RESIDENTIAL';
  return null;
}

function salesUsageFor(value: string): SalesPrimaryUsage | null {
  if (hasAny(value, ['streaming', 'netflix', 'filmes', 'series'])) return 'STREAMING';
  if (hasAny(value, ['jogos', 'jogo', 'games', 'game', 'gamer'])) return 'GAMES';
  if (hasAny(value, ['trabalho remoto', 'home office', 'trabalho online'])) return 'REMOTE_WORK';
  if (hasAny(value, ['outro uso', 'outra necessidade'])) return 'OTHER';
  return null;
}

function isUnavailableLocationAnswer(value: string): boolean {
  return hasAny(value, [
    'nao sei', 'nao tenho', 'sem informacao', 'nao informado', 'qualquer lugar',
  ]);
}

/**
 * A memória do caso guarda apenas se a região parece utilizável. O texto
 * recebido é avaliado no turno e descartado; não persistimos cidade/bairro.
 */
function hasEnoughRegion(value: string): boolean {
  if (isUnavailableLocationAnswer(value)) return false;
  const terms = value.match(/[a-z]{2,}/g) ?? [];
  return terms.length >= 2 && (/[,–-]/.test(value) || /cidade.*bairro|bairro.*cidade/.test(value));
}

/**
 * Um número solto (por exemplo, apartamento 101) não basta para disparar a
 * etapa factual. Pedimos ao menos um logradouro reconhecível e um número.
 * Assim como a região, o endereço não é armazenado no estado.
 */
function hasEnoughAddress(value: string): boolean {
  if (isUnavailableLocationAnswer(value)) return false;
  const hasPostalCode = /\b\d{5}[-\s]?\d{3}\b/.test(value);
  const hasNumber = /\b(?:n[ºo°.]?\s*)?\d{1,6}[a-z]?\b/.test(value);
  return hasPostalCode && hasNumber;
}

function coverageEvidenceWasExplained(value: string): boolean {
  return value.includes('disponibilidade ainda precisa ser confirmada na base oficial');
}

export function deriveSalesCaseState(input: {
  messages: CaseStateMessage[];
  previousState?: SalesCaseState | null;
}): SalesCaseState {
  const previous = input.previousState?.route === 'sales' ? input.previousState : null;
  let customerProfile = previous?.customerProfile ?? 'UNKNOWN';
  let primaryUsage = previous?.primaryUsage ?? 'UNKNOWN';
  let cityNeighborhoodProvided = previous?.cityNeighborhoodProvided ?? false;
  let addressProvided = previous?.addressProvided ?? false;
  let coverageEvidenceRequested = previous?.coverageEvidenceRequested ?? false;
  const coverageCheckStatus = previous?.coverageCheckStatus ?? 'NOT_CHECKED';
  let awaitingRegion = false;
  let awaitingAddress = false;
  let awaitingUsage = false;

  for (const message of input.messages) {
    const text = normalize(message.content);
    if (message.role === 'assistant') {
      coverageEvidenceRequested ||= coverageEvidenceWasExplained(text);
      awaitingRegion = /cidade\s+e\s+bairro|bairro\s+e\s+cidade/.test(text);
      awaitingAddress = /endereco|endereço/.test(text) && !awaitingRegion;
      awaitingUsage = text.includes('o que voce mais usa');
      continue;
    }
    customerProfile = salesProfileFor(text) ?? customerProfile;
    primaryUsage = salesUsageFor(text) ?? primaryUsage;
    if (awaitingUsage && primaryUsage === 'UNKNOWN' && text.length > 2) primaryUsage = 'OTHER';
    if (awaitingRegion && hasEnoughRegion(text)) cityNeighborhoodProvided = true;
    if (awaitingAddress && hasEnoughAddress(text)) addressProvided = true;
    awaitingRegion = false;
    awaitingAddress = false;
    awaitingUsage = false;
  }

  let nextStep: SalesCaseState['nextStep'] = 'CONTINUE_SAFE_QUALIFICATION';
  // Uma pergunta sobre o uso principal precede o pedido de localização.
  // Se o cliente já informou o uso, seguimos direto para a consulta factual;
  // não exigimos uma segunda rodada de qualificação comercial.
  if (coverageCheckStatus === 'NOT_CHECKED') {
    if (!addressProvided && primaryUsage === 'UNKNOWN') nextStep = 'ASK_PRIMARY_USAGE';
    else if (!addressProvided) nextStep = 'ASK_ADDRESS';
    else if (!coverageEvidenceRequested) nextStep = 'REQUEST_COVERAGE_EVIDENCE';
  }
  return {
    schemaVersion: 1,
    route: 'sales',
    customerProfile,
    primaryUsage,
    cityNeighborhoodProvided,
    addressProvided,
    coverageEvidenceRequested,
    coverageCheckStatus,
    nextStep,
  };
}

function billingRequestFor(value: string): BillingRequestKind | null {
  if (hasAny(value, ['segunda via', '2 via', 'fatura', 'boleto'])) return 'INVOICE_COPY';
  if (hasAny(value, ['pagamento', 'paguei', 'baixou', 'compens'])) return 'PAYMENT_STATUS';
  if (hasAny(value, ['cancelamento', 'cancelar'])) return 'CANCELLATION_EFFECTS';
  if (hasAny(value, ['como funciona', 'informacao geral', 'informação geral'])) return 'GENERAL_POLICY';
  return null;
}

export function deriveBillingCaseState(input: {
  messages: CaseStateMessage[];
  identityVerified: boolean;
  identityRequiredNow: boolean;
  previousState?: BillingCaseState | null;
}): BillingCaseState {
  const previous = input.previousState?.route === 'billing' ? input.previousState : null;
  let requestKind = previous?.requestKind ?? 'UNKNOWN';
  for (const message of input.messages) {
    if (message.role === 'user') requestKind = billingRequestFor(normalize(message.content)) ?? requestKind;
  }
  const nextStep: BillingCaseState['nextStep'] = input.identityRequiredNow && !input.identityVerified
    ? 'REQUEST_ACCOUNT_IDENTITY'
    : requestKind === 'GENERAL_POLICY'
      ? 'PROVIDE_APPROVED_GENERAL_GUIDANCE'
      : 'CONTINUE_SAFE_FINANCIAL_GUIDANCE';
  return { schemaVersion: 1, route: 'billing', requestKind, identity: { verified: input.identityVerified, requiredNow: input.identityRequiredNow }, nextStep };
}

/** A mesma tabela de estado atende todos os setores, sem carregar fatos entre eles. */
export function deriveOperationalCaseState(input: {
  messages: CaseStateMessage[];
  route: string | null;
  identityVerified: boolean;
  identityRequiredNow: boolean;
  previousState?: OperationalCaseState | null;
}): OperationalCaseState {
  if (input.route === 'technical_support') {
    return deriveSupportCaseState({ ...input, previousState: input.previousState?.route === 'technical_support' ? input.previousState : null });
  }
  if (input.route === 'sales') {
    return deriveSalesCaseState({ messages: input.messages, previousState: input.previousState?.route === 'sales' ? input.previousState : null });
  }
  if (input.route === 'billing') {
    return deriveBillingCaseState({ ...input, previousState: input.previousState?.route === 'billing' ? input.previousState : null });
  }
  return { schemaVersion: 1, route: 'other', nextStep: 'CONTINUE_SAFE_CONVERSATION' };
}
