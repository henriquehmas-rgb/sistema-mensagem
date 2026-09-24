export type IxcReadAction = 'contracts' | 'invoices' | 'service_orders' | 'connections' | 'fiber_access' | 'tickets';

export interface IxcQueryPlan {
  actions: IxcReadAction[];
  /** A identidade protege leituras do cadastro e da conexão no IXC. */
  requiresIdentity: boolean;
  identityGate: 'NOT_REQUIRED' | 'DEFERRED_TECHNICAL' | 'REQUIRED_FOR_ACCOUNT_LOOKUP';
  reason: string | null;
  continuedFromPrevious: boolean;
  /**
   * Rota explícita detectada na mensagem atual antes de a IA responder.
   * Ela permite que a memória operacional já nasça no setor correto no
   * primeiro turno, sem antecipar consulta ou escrita externa.
   */
  operationalRouteHint: 'technical_support' | 'billing' | 'sales' | null;
}

/** Mensagens consecutivas do cliente pertencem ao mesmo pedido até a próxima resposta. */
export function latestConsecutiveUserText(messages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  const turn: string[] = [];
  for (let index = messages.length - 1; index >= 0 && messages[index]!.role === 'user'; index--) {
    turn.unshift(messages[index]!.content);
  }
  return turn.join('\n');
}

/** Recupera somente o pedido imediatamente anterior, sem misturar setores de turnos antigos. */
export function previousCustomerRequestText(messages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  let index = messages.length - 1;
  while (index >= 0 && messages[index]!.role === 'user') index--;
  const currentTurnBeforeLast = messages.slice(index + 1, -1)
    .filter((message) => !isIdentityOnlyText(message.content))
    .map((message) => message.content);
  if (currentTurnBeforeLast.length > 0) return currentTurnBeforeLast.join('\n');
  // Uma correção de CPF pode vir entre o relato original e o marcador seguro.
  // Procura o último turno substantivo, sem reusar o CPF nem a correção como pedido.
  while (index >= 0) {
    while (index >= 0 && messages[index]!.role === 'assistant') index--;
    const priorTurn: string[] = [];
    while (index >= 0 && messages[index]!.role === 'user') {
      const content = messages[index]!.content;
      if (!isIdentityOnlyText(content)) priorTurn.unshift(content);
      index--;
    }
    if (priorTurn.length > 0) return priorTurn.join('\n');
  }
  return '';
}

function isIdentityOnlyText(text: string): boolean {
  const clean = text.trim();
  return IDENTITY_MARKER.test(clean)
    || /^\s*(?:\d[\d.\s/-]*|(?:cpf\s*)?\d{3}[\d.\s/-]*)\s*$/i.test(clean)
    || /^(?:(?:ah|opa)[,!]?\s*)?(?:errei|digitei errado|corrigindo)\b.{0,50}\b(?:cpf|n[uú]mero|d[ií]gito)\b.{0,25}$/i.test(clean);
}

const RULES: Array<{ action: IxcReadAction; pattern: RegExp }> = [
  // WhatsApp também recebe mensagens interrompidas como "Estou sem intern".
  // O token termina em "intern", sem capturar palavras como "internação".
  { action: 'connections', pattern: /\bsem\s+intern(?:et)?\b/i },
  // "Minha internet parou" � um relato de indisponibilidade, mesmo sem a
  // palavra "caiu". Ele deve abrir a valida��o do cadastro antes de qualquer
  // pergunta diagn�stica ou infer�ncia sobre a regi�o.
  { action: 'connections', pattern: /\b(internet\s+parou|internet\s+fora|internet\s+n[aã]o\s+(?:est[aá]\s+)?funcion\w*|internet\s+sem\s+funcionar|rede\s+n[aã]o\s+funcion\w*|sem\s+rede|rede\s+caiu|velocidade\s+(?:est[aá]\s+)?abaixo\s+do\s+plano)\b/i },
  { action: 'invoices', pattern: /\b(fatura|boleto|venc|conta atras|pagamento|segunda via|mensalidade)\b/i },
  { action: 'service_orders', pattern: /\b(t[eé]cnico|visita|agend|chamado|ordens?|ordem de servi[cç]o|protocolo)\b/i },
  { action: 'tickets', pattern: /\b(ticket|atendimento aberto|protocolo|solicita[cç][aã]o)\b/i },
  { action: 'connections', pattern: /\b(sem internet|internet caiu|offline|conex[aã]o|sinal|lent[ao]|instabilidade)\b/i },
  { action: 'contracts', pattern: /\b(contrato|plano|bloquead|cancelad|ativ[ao]|assinatura)\b/i },
];
const CONTINUATION = /^(?:e\s+)?(?:(?:isso|esse|essa|esses|essas|disso|disto|desse|dessa|desses|dessas|deste|desta|destes|destas|ainda|continua|continuou|agora|como fica|mesmo problema|faz\s+(?:muito\s+)?tempo|desde\s+(?:ontem|hoje|cedo|a\s+noite))|(?:qual|quais)\s+(?:deles|delas|dessas|desses|destas|destes))\b/i;
// A validação protegida continua exigindo exatamente dois grupos numéricos
// (ver consumeIdentityChallenge). Aqui reconhecemos apenas que a pessoa está
// respondendo ao desafio já aberto, inclusive com linguagem natural como
// “CPF final 123, mês 9”. Isso preserva o contexto sem transformar texto livre
// em consulta ao IXC nem flexibilizar a confirmação de identidade em si.
const IDENTITY_FACTORS = /(?:^|\b(?:cpf|final|últimos?|ultimos?|m[eê]s|nascimento)\b[^\d]{0,24})\b\d{3}\b[^\d]{1,32}\b(?:0?[1-9]|1[0-2])\b/i;
const IDENTITY_MARKER = /(?:^|\n)\s*\[(?:Identidade|Valida[cç][aã]o|Resposta de valida[cç][aã]o)/i;
const COMPLETE_IDENTITY_MARKER = /(?:^|\n)\s*\[(?:Identidade|Valida[cç][aã]o|Resposta de valida[cç][aã]o)[^\]\n]*\]/i;
// Verbos de consulta somados a um dado da própria conta distinguem um pedido
// protegido de uma orientação geral. No suporte, porém, uma falha de conexão
// também precisa identificar o cadastro antes da leitura factual IXC/ODG.
const ACCOUNT_LOOKUP = /\b(?:consult(?:ar|a|e)|verific(?:ar|a|e)|olh(?:ar|a|e)|inform(?:ar|a|e)|dizer|diga|existe|tem|há)\b.{0,90}\b(?:minh[ao]|meu|minha|conex[aã]o|conta|fatura|boleto|contrato|chamado|ticket|ordem|os\b|protocolo|previs[aã]o|agend)/i;
// Alterações contratuais não são uma consulta pública: ainda que a conversa
// esteja em Vendas, qualquer intenção de mudar o plano ou o serviço exige
// identidade antes de consultar dados individuais ou propor execução.
const ACCOUNT_MUTATION = /\b(?:mudar|alterar|trocar|upgrade|downgrade|cancelar|encerrar|ativar|desativar)\b.{0,90}\b(?:meu|minha|plano|contrato|assinatura|servi[cç]o)\b/i;
// Explicações de regra não consultam a conta. A menção a "fatura" pode ser
// genérica ("como funciona o parcelamento da fatura?") e só exige identidade
// quando a pessoa trata de uma cobrança própria.
const GENERAL_BILLING_POLICY = /\b(?:como\s+funciona(?:m)?|quais?\s+(?:s[aã]o\s+)?as?\s+regras|qual\s+(?:é|e)\s+a\s+regra|posso\s+parcelar|h[aá]\s+possibilidade\s+de\s+parcelar)\b.{0,90}\b(?:parcel|juros|multa|acordo|renegoci|fatura|boleto)\b/i;
const ACCOUNT_OWNERSHIP = /\b(?:minh[ao]s?|meu[s]?)\b.{0,40}\b(?:fatura|boleto|conta|pagamento|contrato|acordo|parcel)/i;
// O planejador é executado antes de a IA devolver a nova rota. Em uma
// conversa que vinha de Financeiro, uma nova pergunta explícita sobre planos
// não pode herdar a leitura de faturas nem o desafio de identidade. A
// inferência aqui é propositalmente estreita: só troca a intenção recebida
// quando a mensagem atual é inequivocamente comercial e não contém assunto
// financeiro concorrente. Casos mistos seguem para a triagem/revisão normal.
const EXPLICIT_SALES_INTENT = /\b(?:planos?|contratar|assinar|(?:comprar|colocar|adquirir|instalar)\s+(?:uma\s+)?internet|ades[aã]o|pre[cç]o|valor\s+do\s+plano|upgrade|mais\s+mega|cobertura|proposta|or[cç]amento|promo[cç][aã]o|oferta|internet\s+(?:comercial|residencial|para\s+(?:(?:minha|a)\s+)?(?:casa|resid[eê]ncia|empresa|escrit[oó]rio)))\b/i;
const EXPLICIT_BILLING_INTENT = /\b(?:fatura|boleto|pagamento|mensalidade|cobran[cç]a|vencimento|pix|d[eé]bito|nota\s+fiscal|renegoci|parcel|acordo|juros|multa|reembolso|estorno|chargeback)\b/i;
const TECHNICAL_PLAN_CONTEXT = /\b(?:velocidade|internet)\b.{0,60}\b(?:abaixo|baixa|lenta|ruim)\b.{0,60}\bplano\b|\bplano\b.{0,60}\b(?:velocidade|internet)\b.{0,60}\b(?:abaixo|baixa|lenta|ruim)\b/i;

/** Plano fechado: somente recursos de leitura conhecidos podem ser selecionados. */
export function planIxcReads(text: string, intent: string | null, priorText?: string): IxcQueryPlan {
  const fullCpfContinuation = /(?:^|\bcpf\b[^\d]{0,24})\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?:\b|$)/i.test(text);
  const identityContinuation = fullCpfContinuation || IDENTITY_FACTORS.test(text) || IDENTITY_MARKER.test(text.trim());
  // Um pedido novo depois do marcador pertence ao turno atual, não ao assunto
  // que motivou a validação. Isolar o trecho também evita misturar leituras de
  // setores quando o debounce agrupou o pedido antigo e o novo no mesmo bloco.
  const identityMarker = COMPLETE_IDENTITY_MARKER.exec(text);
  const afterIdentityMarker = identityMarker
    ? text.slice(identityMarker.index + identityMarker[0].length).trim()
    : '';
  // Respostas breves n�o devem apagar o relato t�cnico que as precede. Sem
  // isso, "sim"/"n�o sei" deixam a IA improvisar perguntas sobre vizinhos em
  // vez de manter o fluxo protegido de identifica��o e consulta factual.
  const textualContinuation = CONTINUATION.test(text.trim())
    || /^(?:sim|s|n(?:a|\u00e3)o|n(?:a|\u00e3)o\s+sei|nunca|talvez|acho\s+que\s+sim)\b/i.test(text.trim());
  const hasExplicitSector = (value: string): boolean => EXPLICIT_SALES_INTENT.test(value)
    || EXPLICIT_BILLING_INTENT.test(value)
    || RULES.some((rule) => rule.pattern.test(value));
  const newRequestAfterIdentity = afterIdentityMarker && hasExplicitSector(afterIdentityMarker)
    ? afterIdentityMarker
    : null;
  const currentText = newRequestAfterIdentity ?? text;
  const currentHasExplicitSector = hasExplicitSector(currentText);
  const planningText = newRequestAfterIdentity
    ? newRequestAfterIdentity
    : (identityContinuation || (textualContinuation && !currentHasExplicitSector)) && priorText
      ? priorText
      : text;
  const hasExplicitSalesIntent = EXPLICIT_SALES_INTENT.test(planningText)
    && !EXPLICIT_BILLING_INTENT.test(planningText)
    && !TECHNICAL_PLAN_CONTEXT.test(planningText);
  const actions = new Set<IxcReadAction>();
  for (const rule of RULES) {
    if (rule.pattern.test(planningText)) actions.add(rule.action);
  }
  const generalBillingPolicy = GENERAL_BILLING_POLICY.test(planningText)
    && !ACCOUNT_OWNERSHIP.test(planningText);
  if (generalBillingPolicy) actions.clear();
  // O planejador roda antes de a IA persistir a rota do primeiro turno. Sem
  // esta inferência, "minha internet caiu" começava por testes de luz em vez
  // de localizar o cliente e consultar as fontes operacionais corretas.
  const hasExplicitTechnicalIntent = actions.has('connections')
    && !hasExplicitSalesIntent
    && !EXPLICIT_BILLING_INTENT.test(planningText);
  const hasExplicitBillingIntent = actions.has('invoices') && !hasExplicitSalesIntent;
  const planningIntent = hasExplicitSalesIntent
    ? 'sales'
    : hasExplicitBillingIntent
      ? 'billing'
      : hasExplicitTechnicalIntent
        ? 'technical_support'
        : intent;
  const hasExplicitAction = actions.size > 0;
  // Se o desafio expirou entre a solicitação e a resposta, os fatores chegam
  // sem o marcador interno. Preserve o setor anterior e reinicie a validação.
  const continuedFromPrevious = !newRequestAfterIdentity && (identityContinuation || textualContinuation);
  // Interesse comercial público pode não demandar nenhuma leitura IXC. Ainda
  // assim a intenção atual precisa chegar à IA para não herdar Financeiro na
  // troca de assunto. Não acrescentamos ação: catálogo público continua no
  // RAG aprovado e sem identidade.
  const effectiveIntent = hasExplicitAction || continuedFromPrevious || hasExplicitSalesIntent
    ? planningIntent
    : null;
  if (effectiveIntent === 'billing' || actions.has('invoices')) {
    actions.add('invoices');
    actions.add('contracts');
  } else if (effectiveIntent === 'technical_support' || actions.has('connections')) {
    actions.add('connections');
    actions.add('service_orders');
    actions.add('tickets');
    actions.add('contracts');
    // O contrato do IXC é a ponte documental para a ONU/CTO/OLT do assinante.
    // Esta leitura não afirma rompimento: apenas fornece contexto factual para
    // a correlação com as fontes de evento (IXC/Olho de Deus).
    actions.add('fiber_access');
  }
  const requiresAccountLookup = (identityContinuation && !newRequestAfterIdentity)
    || effectiveIntent === 'billing'
    || actions.has('invoices')
    // A checagem regional precisa ser associada ao cliente/cadastro correto.
    // Sem esse vínculo, "não há evento" seria uma conclusão insegura.
    || (effectiveIntent === 'technical_support' && actions.has('connections'))
    || ACCOUNT_MUTATION.test(planningText)
    // A simples menção a "ordem", "previsão" ou "contrato" não transforma
    // uma conversa técnica em consulta de conta. A pessoa precisa pedir a
    // leitura de um registro próprio; caso contrário, o diagnóstico seguro
    // continua sem CPF/data de nascimento.
    || ACCOUNT_LOOKUP.test(planningText);
  const isDeferredTechnicalDiagnosis = !requiresAccountLookup
    && effectiveIntent === 'technical_support';
  const identityGate = requiresAccountLookup
    ? 'REQUIRED_FOR_ACCOUNT_LOOKUP'
    : isDeferredTechnicalDiagnosis
      ? 'DEFERRED_TECHNICAL'
      : 'NOT_REQUIRED';
  const operationalRouteHint = effectiveIntent === 'technical_support'
    || effectiveIntent === 'billing'
    || effectiveIntent === 'sales'
    ? effectiveIntent
    : null;
  return {
    actions: [...actions],
    requiresIdentity: identityGate === 'REQUIRED_FOR_ACCOUNT_LOOKUP',
    identityGate,
    reason: actions.size > 0 ? `intent:${effectiveIntent ?? 'explicit_message'}` : null,
    continuedFromPrevious,
    operationalRouteHint,
  };
}
