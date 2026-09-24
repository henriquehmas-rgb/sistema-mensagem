/** Aprendizagem offline de aberturas sociais: nunca cria fatos ou ações operacionais. */
const REFERENCES = ['oi', 'ola', 'opa', 'e ai', 'eai beleza', 'tudo bem', 'tudo bom', 'como vai', 'bom dia', 'boa tarde', 'boa noite'];
const BUSINESS_OR_SENSITIVE = /\b(?:internet|conexao|sem|sinal|los|roteador|modem|fatura|boleto|pix|cpf|cnpj|cadastro|contrato|plano|comprar|contratar|preco|valor|cobertura|endereco|cep|tecnico|chamado|visita|prazo|senha|token|ajuda|problema)\b/u;

export type LanguageSample = {
  conversationId: string;
  route: 'technical_support' | 'billing' | 'sales';
  openingMessages: string[];
};

export type LearnedSocialVariant = {
  normalizedText: string;
  evidenceCount: number;
  routeCount: number;
};

export function normalizeSocialText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let col = 1; col <= right.length; col++) {
      const above = previous[col]!;
      previous[col] = Math.min(
        above + 1, previous[col - 1]! + 1,
        diagonal + (left[row - 1] === right[col - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length);
}

function candidate(value: string): string | null {
  if (value.length > 60 || /\d|@|\/|\\|\[|\]|:|#|\$/u.test(value)) return null;
  const normalized = normalizeSocialText(value);
  if (normalized.length < 3 || normalized.length > 40 || BUSINESS_OR_SENSITIVE.test(normalized)) return null;
  if (normalized.split(' ').length > 5) return null;
  const score = Math.max(...REFERENCES.map((reference) => similarity(normalized, reference)));
  return score >= 0.82 ? normalized : null;
}

/** Três conversas independentes e dois setores: revisão humana só para exceções. */
export function learnSocialVariants(samples: LanguageSample[]): LearnedSocialVariant[] {
  const evidence = new Map<string, Map<string, LanguageSample['route']>>();
  for (const sample of samples) {
    const phrases = sample.openingMessages.slice(0, 2);
    const variants = [...phrases, ...(phrases.length === 2 ? [phrases.join(' ')] : [])];
    for (const phrase of variants) {
      const normalized = candidate(phrase);
      if (!normalized) continue;
      const conversations = evidence.get(normalized) ?? new Map();
      conversations.set(sample.conversationId, sample.route);
      evidence.set(normalized, conversations);
    }
  }
  return [...evidence.entries()].flatMap(([normalizedText, conversations]) => {
    const routeCount = new Set(conversations.values()).size;
    return conversations.size >= 3 && routeCount >= 2
      ? [{ normalizedText, evidenceCount: conversations.size, routeCount }]
      : [];
  }).sort((a, b) => a.normalizedText.localeCompare(b.normalizedText));
}
