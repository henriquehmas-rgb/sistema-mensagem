import { createHash } from 'node:crypto';

const SECURITY = [
  'Por segurança, não vou consultar sua conta agora. Posso seguir com orientações gerais.',
  'Preciso proteger seus dados. Por enquanto, posso orientar sem acessar sua conta.',
];
const UNAVAILABLE = [
  'Não consegui confirmar essa informação agora. Seu relato continua registrado.',
  'A consulta ficou instável. Posso seguir com o que já está confirmado.',
];
const COMPLEX = [
  'Ainda não tenho uma resposta segura. Deixei seu pedido registrado para revisão.',
  'Preciso conferir esse ponto antes de responder. Seu pedido ficou registrado.',
];
const REQUESTED = [
  'Seu pedido de atendimento humano ficou registrado nesta conversa.',
  'Registrei seu pedido de atendimento humano e preservei o histórico.',
];
const COMMERCIAL = [
  'Preciso confirmar essa condição antes de te passar um valor. Deixei seu pedido para revisão.',
  'Ainda não consegui confirmar essa condição. Deixei seu pedido registrado para revisão.',
];

export function handoffMessage(reason: string | undefined, conversationId: string): string {
  const normalized = (reason ?? '').toLowerCase();
  if (normalized === 'verificacao_regional_nao_executada' || normalized === 'verificacao_regional_indisponivel') {
    return 'Ainda não consegui verificar a queda na sua região. Encaminhei ao suporte para conferir.';
  }
  if (normalized === 'servico_atual_nao_confirmado') {
    return 'Confirmei seus dados, mas não uma conexão ativa nesse endereço. O suporte vai conferir antes de responder sobre a região.';
  }
  if (normalized === 'confirmacao_titular_indisponivel') {
    return 'Não consegui confirmar o titular desta internet. Encaminhei ao suporte antes de falar sobre a região.';
  }
  if (normalized === 'confirmacao_titular_financeiro_indisponivel') {
    return 'Não consegui confirmar o titular da conta. Pedi ao Financeiro para conferir antes de falar da cobrança.';
  }
  if (normalized === 'ocorrencia_regional_confirmada_pendente_registro') {
    return 'Encontrei uma ocorrência na rede que afeta sua conexão. Avisei o suporte; ainda não há chamado individual.';
  }
  if (normalized === 'cadastro_sem_conexao_ativa') {
    return 'Não confirmei conexão ativa nesse cadastro. Pedi ao suporte para conferir contrato e endereço; ainda não abri chamado técnico.';
  }
  if (normalized === 'avaliacao_tecnica_residencial') {
    return 'Não encontrei ocorrência coletiva confirmada. A luz segue vermelha após reiniciar; o suporte vai avaliar visita. Ainda não há ordem de serviço aberta.';
  }
  if (normalized === 'avaliacao_tecnica_dispositivo') {
    return 'Não encontrei ocorrência coletiva confirmada. Como só um aparelho falha, o suporte vai avaliar. Ainda não há visita aberta.';
  }
  if (normalized === 'avaliacao_tecnica_dispositivo_regiao_inconclusiva') {
    return 'Ainda não confirmei se há queda geral. Como só um aparelho falha, o suporte vai avaliar. Ainda não há visita aberta.';
  }
  if (normalized === 'avaliacao_tecnica_multiplos_dispositivos') {
    return 'Não há ocorrência coletiva confirmada. Vários aparelhos seguem sem internet; o suporte vai avaliar. Ainda não há ordem de serviço aberta.';
  }
  if (normalized === 'avaliacao_tecnica_multiplos_dispositivos_regiao_inconclusiva') {
    return 'Ainda não confirmei se há queda geral. Vários aparelhos seguem sem internet; o suporte vai avaliar. Ainda não há ordem de serviço aberta.';
  }
  if (normalized === 'avaliacao_tecnica_sinal_restabelecido') {
    return 'Não há ocorrência coletiva confirmada. A luz vermelha apagou, mas a internet não voltou; o suporte vai avaliar. Ainda não há ordem de serviço aberta.';
  }
  if (normalized === 'avaliacao_tecnica_sinal_restabelecido_regiao_inconclusiva') {
    return 'Ainda não confirmei se há queda geral. A luz vermelha apagou, mas a internet não voltou; o suporte vai avaliar. Ainda não há ordem de serviço aberta.';
  }
  if (normalized === 'avaliacao_tecnica_regiao_inconclusiva') {
    return 'Ainda não confirmei se há queda geral. A luz segue vermelha após reiniciar; o suporte vai avaliar visita. Ainda não há ordem de serviço aberta.';
  }
  const options = normalized.includes('pedido_de_atendimento_humano')
    ? REQUESTED
    : normalized.includes('commercial_approval_required')
      ? COMMERCIAL
    : /seguran|fraude|ameaca|sensivel|identidade/.test(normalized)
      ? SECURITY
      : /indisponivel|falha|tempo_limite|provedor|ixc/.test(normalized)
        ? UNAVAILABLE
        : COMPLEX;
  const digest = createHash('sha256').update(`${conversationId}:${normalized}`).digest();
  return options[digest[0]! % options.length]!;
}
