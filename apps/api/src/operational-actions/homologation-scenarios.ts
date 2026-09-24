export interface HomologationScenario {
  id: string;
  title: string;
  action: 'request_ticket' | 'request_service_order';
  setup: string[];
  expectedState: 'READY_TO_TRIGGER' | 'REVIEW_REQUIRED' | 'DUPLICATE_FOUND' | 'BLOCKED' | 'UNCERTAIN';
  expectedBehavior: string;
  externalWriteExpected: false;
}

/** Catálogo imutável: descreve testes, não contém clientes nem executa ações. */
export const HOMOLOGATION_SCENARIOS: readonly HomologationScenario[] = [
  {
    id: 'support-individual-failure', title: 'Falha individual confirmada',
    action: 'request_service_order',
    setup: ['Setor suporte', 'Identidade validada', 'Falha individual confirmada', 'Sem OS ou chamado aberto'],
    expectedState: 'READY_TO_TRIGGER',
    expectedBehavior: 'Preparar a proposta para revisão, sem executar escrita.', externalWriteExpected: false,
  },
  {
    id: 'existing-service-order', title: 'OS equivalente já existente',
    action: 'request_service_order',
    setup: ['Setor suporte', 'Falha individual confirmada', 'OS aberta encontrada no IXC'],
    expectedState: 'DUPLICATE_FOUND',
    expectedBehavior: 'Reutilizar o protocolo existente e não criar nova OS.', externalWriteExpected: false,
  },
  {
    id: 'similar-ticket', title: 'Chamado técnico semelhante já existente',
    action: 'request_ticket',
    setup: ['Setor suporte', 'Chamado aberto do mesmo assunto encontrado no IXC', 'Ocorrência não confirmada'],
    expectedState: 'REVIEW_REQUIRED',
    expectedBehavior: 'Exibir o possível conflito para revisão, sem presumir duplicidade.', externalWriteExpected: false,
  },
  {
    id: 'collective-outage', title: 'Rompimento coletivo',
    action: 'request_service_order',
    setup: ['Olho de Deus confirma evento coletivo'], expectedState: 'BLOCKED',
    expectedBehavior: 'Informar o evento e bloquear atendimento técnico individual.', externalWriteExpected: false,
  },
  {
    id: 'ambiguous-customer', title: 'Cliente ou contrato ambíguo',
    action: 'request_ticket', setup: ['IXC retorna mais de um cliente ou contrato'], expectedState: 'BLOCKED',
    expectedBehavior: 'Solicitar confirmação segura antes de continuar.', externalWriteExpected: false,
  },
  {
    id: 'wrong-department', title: 'Atendimento fora do suporte',
    action: 'request_service_order', setup: ['Setor financeiro ou vendas'], expectedState: 'BLOCKED',
    expectedBehavior: 'Impedir criação de chamado ou OS técnica.', externalWriteExpected: false,
  },
  {
    id: 'ixc-unavailable', title: 'IXC indisponível',
    action: 'request_ticket', setup: ['Consulta IXC falha ou expira'], expectedState: 'BLOCKED',
    expectedBehavior: 'Não disparar e orientar espera sem expor detalhes internos.', externalWriteExpected: false,
  },
  {
    id: 'network-source-unavailable', title: 'Olho de Deus indisponível',
    action: 'request_service_order', setup: ['Contexto técnico indisponível'], expectedState: 'BLOCKED',
    expectedBehavior: 'Gerar GAP ou aguardar confirmação; nunca criar OS às cegas.', externalWriteExpected: false,
  },
  {
    id: 'trigger-timeout', title: 'Timeout após disparo',
    action: 'request_service_order', setup: ['Comando enviado sem resposta conclusiva'], expectedState: 'UNCERTAIN',
    expectedBehavior: 'Consultar pela chave de idempotência antes de qualquer repetição.', externalWriteExpected: false,
  },
  {
    id: 'identity-not-verified', title: 'Identidade ainda não validada',
    action: 'request_ticket', setup: ['Conversa de Suporte sem validação de identidade'], expectedState: 'BLOCKED',
    expectedBehavior: 'Solicitar validação segura antes de consultar ou preparar a ação.', externalWriteExpected: false,
  },
  {
    id: 'confidence-below-floor', title: 'Confiança abaixo do mínimo',
    action: 'request_ticket', setup: ['Confiança inferior ao máximo entre skill e piso global'], expectedState: 'BLOCKED',
    expectedBehavior: 'Fazer esclarecimento ou gerar GAP; não consultar nem preparar escrita.', externalWriteExpected: false,
  },
  {
    id: 'unknown-mapping', title: 'Mapeamento externo desconhecido',
    action: 'request_ticket', setup: ['mappingKey ausente do catálogo controlado'], expectedState: 'BLOCKED',
    expectedBehavior: 'Recusar antes de consultar o IXC; a IA não escolhe IDs externos.', externalWriteExpected: false,
  },
  {
    id: 'legitimate-recurrence', title: 'Nova recorrência do mesmo problema',
    action: 'request_ticket', setup: ['Mesmo assunto', 'Novo occurrenceId', 'Sem identidade inequívoca de duplicidade'], expectedState: 'REVIEW_REQUIRED',
    expectedBehavior: 'Tratar como nova ocorrência possível e revisar conflito existente.', externalWriteExpected: false,
  },
] as const;
