import { OMNI_OPERATIONAL_POLICY } from '../operational-policy/omni-operational-policy';

export type ExternalChannelKind = 'WHATSAPP' | 'INSTAGRAM';
export type ActivationReadinessStatus = 'BLOCKED' | 'PREPARING' | 'READY_FOR_REVIEW';

export interface ExternalChannelReadinessInput {
  channel: ExternalChannelKind;
  configured: boolean;
  hasCredentials: boolean;
  hasExternalId: boolean;
  lastTestSucceeded: boolean | null;
  approvedTemplates: number;
}

export interface IntegrationActivationReadinessInput {
  channels: ExternalChannelReadinessInput[];
  sentryConfigured: boolean;
  teamsAlertsConfigured: boolean;
  confirmedTopologyMappings: number;
  shadowTopologyMappings: number;
}

export interface ExternalChannelActivationReadiness {
  channel: ExternalChannelKind;
  status: ActivationReadinessStatus;
  approvedTemplates: number;
  blockers: string[];
}

export interface IntegrationActivationReadinessResult {
  status: ActivationReadinessStatus;
  effectiveMode: typeof OMNI_OPERATIONAL_POLICY.effectiveMode;
  externalDeliveryEnabled: typeof OMNI_OPERATIONAL_POLICY.externalChannelDeliveryEnabled;
  sentryConfigured: boolean;
  teamsAlertsConfigured: boolean;
  alertsConfigured: boolean;
  confirmedTopologyMappings: number;
  shadowTopologyMappings: number;
  channels: ExternalChannelActivationReadiness[];
  blockers: string[];
  /** Afeta apenas decisão individual de rede, não canais Financeiro/Vendas. */
  networkDecisionBlocker: string | null;
  manualRequirements: string[];
}

function assessChannel(input: ExternalChannelReadinessInput): ExternalChannelActivationReadiness {
  const blockers: string[] = [];
  if (!input.configured) blockers.push('canal não cadastrado');
  if (input.configured && !input.hasCredentials) blockers.push('credenciais não configuradas');
  if (input.configured && !input.hasExternalId) blockers.push('identificador externo não configurado');
  if (input.lastTestSucceeded !== true) blockers.push('teste técnico ainda não aprovado');
  if (input.channel === 'WHATSAPP' && input.approvedTemplates === 0) {
    blockers.push('nenhum template WhatsApp aprovado');
  }
  return {
    channel: input.channel,
    status: blockers.length > 0 ? 'BLOCKED' : 'READY_FOR_REVIEW',
    approvedTemplates: input.approvedTemplates,
    blockers,
  };
}

/**
 * Consolida requisitos sem habilitar entrega. A trava de runtime continua sendo
 * a política operacional; este parecer só reduz erro humano na preparação.
 */
export function assessIntegrationActivationReadiness(
  input: IntegrationActivationReadinessInput,
): IntegrationActivationReadinessResult {
  const channels = input.channels.map(assessChannel);
  const blockers = [
    ...channels.flatMap((channel) => channel.blockers.map((blocker) => `${channel.channel}: ${blocker}`)),
  ];
  const alertsConfigured = input.sentryConfigured || input.teamsAlertsConfigured;
  if (!alertsConfigured) blockers.push('destino de alertas de produção não configurado');
  if (!OMNI_OPERATIONAL_POLICY.externalChannelDeliveryEnabled) {
    blockers.push('entrega externa permanece bloqueada pela política operacional');
  }

  return {
    status: blockers.length > 0 ? 'BLOCKED' : 'READY_FOR_REVIEW',
    effectiveMode: OMNI_OPERATIONAL_POLICY.effectiveMode,
    externalDeliveryEnabled: OMNI_OPERATIONAL_POLICY.externalChannelDeliveryEnabled,
    sentryConfigured: input.sentryConfigured,
    teamsAlertsConfigured: input.teamsAlertsConfigured,
    alertsConfigured,
    confirmedTopologyMappings: input.confirmedTopologyMappings,
    shadowTopologyMappings: input.shadowTopologyMappings,
    channels,
    blockers,
    networkDecisionBlocker: input.confirmedTopologyMappings === 0
      ? 'correlação IXC/Olho de Deus sem mapeamento técnico confirmado; usar somente evidência agregada em suporte'
      : null,
    manualRequirements: [
      'homologar recebimento por webhook assinado e continuidade no contato central',
      'usar contato de teste autorizado e registrar a entrega auditável',
      'aprovar explicitamente qualquer mudança de modo ou entrega externa',
    ],
  };
}
