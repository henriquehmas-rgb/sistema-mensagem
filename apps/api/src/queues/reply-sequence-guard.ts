/**
 * Última barreira de ordem antes de publicar uma resposta. Não escolhe o setor
 * nem substitui a conversa: intervém apenas quando o texto contradiz o estado
 * operacional ou afirma um fato individual sem a validação necessária.
 */
export type ReplySequenceDecision =
  | { kind: 'PASS'; reply: string; reason: 'sequence_valid' }
  | { kind: 'REPLACE'; reply: string; reason: 'sales_usage_before_address' | 'billing_identity_before_account_fact' | 'support_regional_event_first' | 'support_unconfirmed_symptom' | 'support_identity_before_local' | 'support_service_before_local' }
  | { kind: 'HANDOFF'; reason: 'verificacao_regional_indisponivel' | 'ocorrencia_regional_confirmada_pendente_registro'; violation: 'support_regional_before_local' };

export interface ReplySequenceInput {
  route: string;
  nextStep: string | null;
  reply: string;
  identityVerified: boolean;
  identityRequiredNow: boolean;
  currentSymptom?: string;
  supportLosLight?: string;
  customerReportedRedLight?: boolean;
  equipmentRestarted?: boolean;
  affectedMultipleDevices?: boolean;
  currentServiceConfirmed?: boolean;
  regionalCheckComplete?: boolean;
  regionalEventConfirmed?: boolean;
  regionalIncidentRegistered?: boolean;
  latestUserText?: string;
  firstResponse?: boolean;
  opening?: string;
}

const SALES_USAGE_QUESTION = 'Para eu te orientar melhor, o que você mais usa na internet no dia a dia: trabalho remoto, streaming, jogos ou outra coisa?';
const BILLING_IDENTITY_QUESTION = 'Para consultar as informações da sua conta, preciso confirmar o cadastro. Pode me enviar o CPF completo do titular?';
const SUPPORT_IDENTITY_QUESTION = 'Entendi. Para conferir sua conexão e verificar se há uma ocorrência na região, me envie o CPF completo do titular.';
const SUPPORT_SERVICE_QUESTION = 'Antes de concluir sobre a região, preciso confirmar a conexão correta. Essa internet está no mesmo CPF e endereço desse cadastro?';
const CONFIRMED_REGIONAL_OUTAGE = 'Identificamos uma instabilidade regional confirmada e ela já foi registrada para tratativa da equipe de rede. Por enquanto, não vou pedir testes individuais nem criar uma ordem de serviço separada.';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function withOpening(input: ReplySequenceInput, body: string): string {
  return input.firstResponse && input.opening ? `${input.opening}\n\n${body}` : body;
}

export function guardReplySequence(input: ReplySequenceInput): ReplySequenceDecision {
  const reply = normalize(input.reply);
  const latestUser = normalize(input.latestUserText ?? '');
  const recoveryReported = /\b(?:voltou(?: a funcionar)?|normalizou|restabeleceu|funcionando de novo)\b/.test(latestUser)
    && !/\b(?:nao voltou|voltou a cair|voltou a falhar|caiu de novo)\b/.test(latestUser);

  if (input.route === 'sales' && input.nextStep === 'ASK_PRIMARY_USAGE' && !input.identityRequiredNow) {
    const requestsLocation = /\b(?:compartilh\w*|envi\w*|pass\w*|inform\w*|preciso|diga|qual|onde)\b[^?\n]{0,140}\b(?:localizacao|cep|endereco|bairro|cidade|rua|numero da casa)\b/.test(reply);
    if (requestsLocation) {
      return {
        kind: 'REPLACE',
        reply: withOpening(input, SALES_USAGE_QUESTION),
        reason: 'sales_usage_before_address',
      };
    }
  }

  if (input.route === 'technical_support' && input.currentSymptom === 'OUTAGE'
    && !recoveryReported
    && input.regionalIncidentRegistered && !reply.includes('instabilidade regional confirmada')) {
    return {
      kind: 'REPLACE', reply: withOpening(input, CONFIRMED_REGIONAL_OUTAGE),
      reason: 'support_regional_event_first',
    };
  }

  if (
    input.route === 'technical_support'
    && input.currentSymptom === 'OUTAGE'
    && !recoveryReported
    && input.identityVerified
    && input.currentServiceConfirmed
    && !input.regionalCheckComplete
    && ((/\?/.test(reply)
      && /\b(?:los|pon|roteador|modem|equipamento|tomada|reinici\w*|cabo|aparelhos|dispositivos|vizinhos)\b|sua casa/.test(reply))
      || /\bnao (?:ha|existe|encontrei|identifiquei) (?:queda|falha|ocorrencia|instabilidade)\b|\ba regiao (?:esta|segue) normal\b/.test(reply))
  ) {
    return {
      kind: 'HANDOFF', reason: input.regionalEventConfirmed
        ? 'ocorrencia_regional_confirmada_pendente_registro'
        : 'verificacao_regional_indisponivel',
      violation: 'support_regional_before_local',
    };
  }

  // Memórias antigas ou o modelo não podem transformar sintomas não relatados
  // neste atendimento em fatos: isso pula a consulta regional e inventa diagnóstico.
  const assertsRedLight = (input.supportLosLight !== 'RED' && !input.customerReportedRedLight) && (
    /\b(?:luz|los|pon)\b.{0,28}\bvermelh\w*\b.{0,25}\b(?:continua|permanece|ficou|esta)\b/.test(reply)
    || /\b(?:como|ja que|pois|porque)\b.{0,60}\b(?:luz|los|pon)\b.{0,25}\bvermelh\w*\b/.test(reply)
  );
  const assertsRestart = input.equipmentRestarted !== true
    && /\b(?:apos|depois d[eo]|mesmo apos)\s+(?:o\s+)?reinici\w*\b/.test(reply);
  const assertsMultipleDevices = input.affectedMultipleDevices !== true
    && /\b(?:como|ja que|pois|porque)\b.{0,65}\b(?:todos os aparelhos|mais de um aparelho)\b/.test(reply);
  if (input.route === 'technical_support' && input.currentSymptom === 'OUTAGE'
    && (assertsRedLight || assertsRestart || assertsMultipleDevices)) {
    if (input.identityVerified && input.currentServiceConfirmed && !input.regionalCheckComplete) {
      return {
        kind: 'HANDOFF', reason: input.regionalEventConfirmed
          ? 'ocorrencia_regional_confirmada_pendente_registro'
          : 'verificacao_regional_indisponivel',
        violation: 'support_regional_before_local',
      };
    }
    const safeReply = !input.identityVerified
      ? SUPPORT_IDENTITY_QUESTION
      : !input.currentServiceConfirmed
        ? SUPPORT_SERVICE_QUESTION
        : 'Não encontrei ocorrência coletiva confirmada para sua conexão agora. Isso não descarta totalmente uma falha na rede. Você percebe alguma luz do equipamento vermelha, piscando ou apagada?';
    return {
      kind: 'REPLACE', reply: withOpening(input, safeReply), reason: 'support_unconfirmed_symptom',
    };
  }

  const localTroubleshooting = /\b(?:los|pon|roteador|modem|equipamento|tomada|reinici\w*|cabo|aparelhos|dispositivos|vizinhos)\b/.test(reply)
    && (/\?/.test(reply) || /\b(?:verifique|confira|reinicie|desligue|ligue|teste|encaixe)\b/.test(reply));
  if (input.route === 'technical_support' && input.currentSymptom === 'OUTAGE'
    && !recoveryReported && localTroubleshooting && !input.identityVerified) {
    return {
      kind: 'REPLACE', reply: withOpening(input, SUPPORT_IDENTITY_QUESTION),
      reason: 'support_identity_before_local',
    };
  }
  if (input.route === 'technical_support' && input.currentSymptom === 'OUTAGE'
    && !recoveryReported && localTroubleshooting && !input.currentServiceConfirmed) {
    return {
      kind: 'REPLACE', reply: withOpening(input, SUPPORT_SERVICE_QUESTION),
      reason: 'support_service_before_local',
    };
  }

  if (input.route === 'billing' && input.nextStep === 'REQUEST_ACCOUNT_IDENTITY'
    && input.identityRequiredNow && !input.identityVerified) {
    const individualAccountFact = /\b(?:sua fatura|seu boleto|seu pagamento|seu contrato|sua conta)\b.{0,90}(?:\b(?:esta|foi|vence|venceu|consta|aparece|valor|pendente|paga|quitad\w*)\b|r\$)/.test(reply);
    if (individualAccountFact) {
      return {
        kind: 'REPLACE',
        reply: withOpening(input, BILLING_IDENTITY_QUESTION),
        reason: 'billing_identity_before_account_fact',
      };
    }
  }

  return { kind: 'PASS', reply: input.reply, reason: 'sequence_valid' };
}
