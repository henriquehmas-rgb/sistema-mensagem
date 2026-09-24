import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  type Message,
  KnowledgeGapStatus,
} from '@prisma/client';
import { Queue, type Job } from 'bullmq';
import {
  conversationInclude,
  messageInclude,
  messagePreview,
  toConversationDto,
  toMessageDto,
} from '../../common/serializers';
import { extractCaseSummary } from '../../common/case-summary';
import { identityVerificationIsValid } from '../../common/identity-verification';
import { latestConsecutiveUserText, planIxcReads, previousCustomerRequestText } from '../../integrations/ixc/ixc-query-planner';
import { IxcService } from '../../integrations/ixc/ixc.service';
import type { IxcOperationalEvidence, IxcStructuralIncidentEvidence } from '../../integrations/ixc/ixc.types';
import { IxcEvidenceCache } from '../../integrations/ixc/ixc-evidence-cache';
import { OmniNetworkOrchestratorService } from '../../integrations/olho-de-deus/omni-network-orchestrator.service';
import { IxcBoxNetworkEvidenceService } from '../../integrations/olho-de-deus/ixc-box-network-evidence.service';
import { confirmedRegionalNetworkIncident } from '../../integrations/olho-de-deus/regional-network-incident';
import type { OmniNetworkResolution } from '../../integrations/olho-de-deus/olho-de-deus.types';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { AuditService } from '../../audit/audit.service';
import { KnowledgeGapsService } from '../../knowledge-gaps/knowledge-gaps.service';
import { SupportCaseStateService } from '../../support-case-state/support-case-state.service';
import { OperationalIncidentsService, type OperationalIncidentSource } from '../../operational-incidents/operational-incidents.service';
import { TenancyService } from '../../tenancy/tenancy.service';
import { evaluateShadowAction } from '../../operational-actions/operational-action-shadow';
import { deriveOccurrenceId } from '../../operational-actions/operational-occurrence-identity';
import { AiServiceClient } from '../ai-service.client';
import { SalesAutoViabilityFlowService } from '../sales-auto-viability-flow.service';
import {
  AI_REPLY_CONTINGENCY_REASON,
  aiReplyContingencyMessage,
  isFinalAiReplyAttempt,
} from '../ai-reply-contingency';
import { classifyHandoff } from '../handoff-classification';
import { handoffMessage } from '../handoff-message';
import { hasCurrentIxcService, needsCurrentServiceHolder } from '../regional-service-eligibility';
import { observeAiReply, type ResponseObservation } from '../response-observation.policy';
import { guardReplySequence } from '../reply-sequence-guard';
import { resilientHandoffReason } from '../technical-resilience.policy';
import { hasEmoji, whatsappReplyParts } from '../whatsapp-humanization';
import {
  QUEUES,
  type AiReplyJob,
  type AutomationRunJob,
  type MemorySummarizeJob,
  type MessageOutboundJob,
} from '../queues.constants';

const HISTORY_WITHOUT_MEMORY_SIZE = 10;
const HISTORY_WITH_MEMORY_SIZE = 8;
const MEMORY_CHECKPOINT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SUPPORT_CURRENT_HOLDER_REQUEST = 'Encontrei seu cadastro, mas não confirmei uma conexão ativa. Pode me passar o CPF completo do titular da internet atual? Se for o mesmo, me diga.';

function supportCurrentHolderWasRequested(messages: Array<{ role: 'user' | 'assistant'; content: string }>): boolean {
  return messages.some((message) => message.role === 'assistant'
    && message.content.includes(SUPPORT_CURRENT_HOLDER_REQUEST));
}

function supportSameHolderConfirmed(messages: Array<{ role: 'user' | 'assistant'; content: string }>): boolean {
  const previousAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!previousAssistant?.content.includes(SUPPORT_CURRENT_HOLDER_REQUEST)) return false;
  const latest = normalizeAccountHolderText(latestConsecutiveUserText(messages));
  return /\b(?:mesmo cpf|cpf (?:e|eh) o mesmo|e o mesmo(?: cpf)?|sou o titular|mesmo titular)\b/.test(latest)
    && !/\b(?:nao|diferente|outro)\b/.test(latest);
}

/** Um job só pode publicar se ainda representar a mensagem inbound mais recente. */
export function isCurrentAiReplyTrigger(
  triggerMessageId: string,
  latestInboundMessageId: string | null | undefined,
): boolean {
  return latestInboundMessageId === triggerMessageId;
}

/** Uma resposta genérica não apaga o setor já identificado neste turno. */
export function resolveReplyRouteKey(replyRouteKey: string | null | undefined, effectiveIntent: string): string {
  if ((replyRouteKey === 'unrouted' || !replyRouteKey)
    && ['technical_support', 'billing', 'sales'].includes(effectiveIntent)) return effectiveIntent;
  return replyRouteKey ?? 'unrouted';
}

/** A resposta comercial determinística usa a mesma abertura no horário de Mato Grosso. */
export function salesFirstContactOpening(now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Cuiaba', hour: '2-digit', hourCycle: 'h23',
  }).format(now));
  const period = hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `${period}! Tudo bem?`;
}

/** Mantém o desafio técnico de identidade alinhado à pergunta que foi enviada. */
export function responseRequestsIdentityChallenge(value: string | null | undefined): boolean {
  const normalized = (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!normalized || /nao vou (?:te )?pedir.*cpf/.test(normalized)) return false;
  return (
    /\bcpf\b/.test(normalized)
    && /completo|numero|11\s*digitos|enviar|mande|inform/.test(normalized)
  );
}

type AccountHolderRebindIntent = 'confirmed' | 'uncertain' | 'none';

function normalizeAccountHolderText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function accountHolderRebindIntent(text: string, contextualCpfDenial: boolean, billingContext: boolean): AccountHolderRebindIntent {
  const normalized = normalizeAccountHolderText(text);
  // A negativa explícita prevalece sobre palavras próximas como "diferente".
  if (/\bcpf\b(?:\s+do\s+titular)?\s+(?:nao\s+(?:difere|difira|diverge)|nao\s+e\s+(?:diferente|divergente)|e\s+(?:o\s+)?mesmo|e\s+igual)\b|\b(?:mesmo|igual)\s+cpf\b/.test(normalized)) {
    return 'none';
  }
  const cpfMismatch = /\bcpf\b.{0,35}\b(?:difere|difira|diferente|diverge|divergente|outro|outra|nao\s+e\s+(?:o\s+)?mesmo|nao\s+corresponde|(?:de|do|da)\s+(?:outra\s+pessoa|outro\s+titular))\b|\b(?:difere|difira|diferente|diverge|divergente|outro|outra)\b.{0,25}\bcpf\b|\bnao\s+(?:e\s+)?(?:no\s+)?mesmo\s+cpf\b/.test(normalized);
  const shortCpfDenial = contextualCpfDenial && /\bcpf\b\s*(?:nao|n|naum)\b/.test(normalized);
  const otherHolder = /\b(?:nao\s+sou\s+(?:o\s+|a\s+)?titular|(?:outro|outra)\s+titular|titular.{0,25}(?:difere|diferente|outro|outra)|(?:em\s+nome\s+de|(?:e|esta)\s+d[eo]\s+)(?:outra\s+pessoa|outro\s+titular))\b/.test(normalized);
  const billingMismatch = billingContext && /\b(?:fatura|boleto|conta|pagamento|contrato)\b.{0,50}\b(?:meu\s+pai|minha\s+mae|outra\s+pessoa|outro\s+nome)\b/.test(normalized);
  if (!cpfMismatch && !shortCpfDenial && !otherHolder && !billingMismatch) return 'none';
  return /\?|\b(?:acho|talvez|parece|provavelmente|nao\s+sei|nao\s+tenho\s+certeza|pode\s+ser)\b/.test(normalized)
    ? 'uncertain' : 'confirmed';
}

/** Só troca o titular após a pergunta específica sobre CPF e endereço do serviço. */
export function supportAccountHolderRebindIntent(messages: Array<{ role: 'user' | 'assistant'; content: string }>): AccountHolderRebindIntent {
  const previousAssistant = normalizeAccountHolderText(
    [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? '',
  );
  const directConfirmation = /cpf do titular dessa internet e diferente do cadastro que encontrei\?/.test(previousAssistant);
  const latestUser = latestConsecutiveUserText(messages);
  if (directConfirmation && /^\s*(?:sim|s|isso|exato|correto)\s*[.!]?\s*$/i.test(latestUser)) return 'confirmed';
  if (!directConfirmation && !/essa internet esta no mesmo cpf e endereco desse cadastro\?/.test(previousAssistant)) return 'none';
  return accountHolderRebindIntent(latestUser, true, false);
}

export function supportNeedsAccountHolderRebind(messages: Array<{ role: 'user' | 'assistant'; content: string }>): boolean {
  return supportAccountHolderRebindIntent(messages) === 'confirmed';
}

/** Em Financeiro, a menção explícita a outro titular antecede qualquer leitura da conta. */
export function billingAccountHolderRebindIntent(messages: Array<{ role: 'user' | 'assistant'; content: string }>): AccountHolderRebindIntent {
  const previousAssistant = normalizeAccountHolderText(
    [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? '',
  );
  const latestUser = latestConsecutiveUserText(messages);
  if (/cpf do titular dessa conta e diferente do cadastro que encontrei\?/.test(previousAssistant)
    && /^\s*(?:sim|s|isso|exato|correto)\s*[.!]?\s*$/i.test(latestUser)) return 'confirmed';
  return accountHolderRebindIntent(latestUser, false, true);
}

export function billingNeedsAccountHolderRebind(messages: Array<{ role: 'user' | 'assistant'; content: string }>): boolean {
  return billingAccountHolderRebindIntent(messages) === 'confirmed';
}

/**
 * Processor `ai-reply` (CONTRACTS §4/§7): chama o FastAPI /reply com o histórico
 * da conversa e os dados do contato.
 * - reply → Message OUTBOUND isAiGenerated + message:new + fila message-outbound.
 * - gap real → cria dúvida interna deduplicada, avisa o cliente de forma natural e
 *   mantém a IA responsável; a orientação revisada volta ao prompt e a IA retoma.
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId do payload.
 */
@Processor(QUEUES.AI_REPLY)
export class AiReplyProcessor extends WorkerHost {
  private readonly logger = new Logger(AiReplyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly aiClient: AiServiceClient,
    private readonly metrics: MetricsService,
    private readonly ixc: IxcService,
    private readonly ixcEvidenceCache: IxcEvidenceCache,
    private readonly networkOrchestrator: OmniNetworkOrchestratorService,
    private readonly boxNetworkEvidence: IxcBoxNetworkEvidenceService,
    private readonly audit: AuditService,
    private readonly knowledgeGaps: KnowledgeGapsService,
    private readonly supportCaseState: SupportCaseStateService,
    private readonly operationalIncidents: OperationalIncidentsService,
    private readonly salesAutoViabilityFlow: SalesAutoViabilityFlowService,
    private readonly tenancy: TenancyService,
    @InjectQueue(QUEUES.MESSAGE_OUTBOUND)
    private readonly messageOutboundQueue: Queue<MessageOutboundJob>,
    @InjectQueue(QUEUES.AUTOMATION_RUN)
    private readonly automationRunQueue: Queue<AutomationRunJob>,
    @InjectQueue(QUEUES.MEMORY_SUMMARIZE)
    private readonly memorySummarizeQueue: Queue<MemorySummarizeJob>,
  ) {
    super();
  }

  async process(job: Job<AiReplyJob>): Promise<void> {
    const { orgId, conversationId, messageId, coalesce } = job.data;

    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: { contact: true, department: { select: { routingKey: true } } },
    });
    if (!conversation) {
      this.logger.warn(`Conversa ${conversationId} não encontrada (org=${orgId}) — descartado`);
      return;
    }
    if (!conversation.aiEnabled) {
      return; // agente humano assumiu entre o enfileiramento e o processamento
    }

    // Idempotência no retry do BullMQ: se o job falhou DEPOIS de a resposta ser
    // persistida (ex.: erro no emit ou no enqueue de message-outbound), uma nova
    // execução NÃO chama o LLM de novo — qualquer Message isAiGenerated criada a
    // partir do gatilho (reply OU handoff SYSTEM) encerra o job cedo.
    const trigger = await this.prisma.prismaSystem.message.findFirst({
      where: { id: messageId, orgId },
      select: { createdAt: true },
    });
    if (!trigger) {
      this.logger.warn(`Mensagem gatilho ${messageId} não encontrada (org=${orgId}) — descartado`);
      return;
    }
    if (coalesce) {
      const latestInbound = await this.prisma.prismaSystem.message.findFirst({
        where: {
          orgId,
          conversationId,
          direction: MessageDirection.INBOUND,
          type: { not: MessageType.SYSTEM },
        },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!isCurrentAiReplyTrigger(messageId, latestInbound?.id)) {
        return;
      }
    }
    const alreadyReplied = await this.prisma.prismaSystem.message.findFirst({
      where: {
        orgId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        isAiGenerated: true,
        createdAt: { gte: trigger.createdAt },
      },
      select: { id: true, type: true, status: true, content: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (alreadyReplied) {
      if (alreadyReplied.type === MessageType.SYSTEM) {
        const content = alreadyReplied.content as Record<string, unknown>;
        const existingAck = await this.prisma.prismaSystem.message.findFirst({
          where: {
            orgId, conversationId, direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT, isAiGenerated: true, createdAt: { gte: trigger.createdAt },
          },
          select: { id: true, status: true },
        });
        if (existingAck?.status === MessageStatus.PENDING) {
          await this.messageOutboundQueue.add('deliver', { orgId, messageId: existingAck.id });
        } else if (!existingAck) {
          await this.createHandoffAcknowledgement(
            orgId, conversationId,
            typeof content.handoff_reason === 'string' ? content.handoff_reason : undefined,
          );
        }
        return;
      }
      // Se o retry veio de falha APÓS criar a resposta mas ANTES de enfileirar a
      // entrega, garante o enqueue (o processor de outbound é idempotente por status).
      const turnReplies = await this.prisma.prismaSystem.message.findMany({
        where: {
          orgId,
          conversationId,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          isAiGenerated: true,
          content: { path: ['turnTriggerId'], equals: messageId },
        },
        select: { id: true, status: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (turnReplies.length > 0) {
        if (turnReplies.some((reply) => reply.status === MessageStatus.PENDING)) {
          await this.messageOutboundQueue.add('deliver', {
            orgId, messageId: turnReplies[0]!.id,
            turnMessageIds: turnReplies.map((reply) => reply.id),
          });
        }
      } else if (alreadyReplied.status === MessageStatus.PENDING) {
        await this.messageOutboundQueue.add('deliver', { orgId, messageId: alreadyReplied.id });
      }
      return;
    }

    const history = await this.prisma.prismaSystem.message.findMany({
      where: { conversationId, orgId, type: { not: MessageType.SYSTEM } },
      // `createdAt` pode coincidir quando a pessoa envia mensagens em
      // sequência. O ID dá desempate estável para que o histórico entregue à
      // IA nunca mude de ordem entre tentativas ou workers.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: conversation.contact.memorySummary
        ? HISTORY_WITH_MEMORY_SIZE
        : HISTORY_WITHOUT_MEMORY_SIZE,
    });
    history.reverse(); // ordem cronológica para o prompt
    const aiMessages = history.map((message) => ({
      role: message.direction === MessageDirection.INBOUND ? 'user' as const : 'assistant' as const,
      content: this.textOf(message),
    }));

    // Persiste um resumo provisório antes da chamada remota. Assim, timeout ou
    // indisponibilidade da IA não deixam o atendente sem contexto.
    const fallbackSummary = extractCaseSummary(aiMessages);
    const identityVerified = identityVerificationIsValid(conversation.identityVerifiedAt);
    const latestUserText = latestConsecutiveUserText(aiMessages);
    const priorUserContext = previousCustomerRequestText(aiMessages);
    const queryPlan = planIxcReads(latestUserText, conversation.lastIntent, priorUserContext);
    const recoveredOperationalIntent = queryPlan.operationalRouteHint
      ?? (queryPlan.actions.includes('connections')
        ? 'technical_support'
        : queryPlan.actions.includes('invoices')
          ? 'billing'
          : conversation.lastIntent);
    // No primeiro turno ainda não existe lastIntent. Quando a própria
    // mensagem traz uma intenção comercial, técnica ou financeira inequívoca,
    // o planejador fornece uma rota estrita para que o estado estruturado não
    // comece como "other" e repita uma pergunta já respondida.
    const caseStateRoute = queryPlan.operationalRouteHint ?? recoveredOperationalIntent;
    const accountHolderIntent = caseStateRoute === 'technical_support'
      ? supportAccountHolderRebindIntent(aiMessages)
      : caseStateRoute === 'billing'
        ? billingAccountHolderRebindIntent(aiMessages)
        : 'none';
    const accountHolderRebindRoute = caseStateRoute === 'technical_support'
      && accountHolderIntent === 'confirmed'
      ? 'technical_support'
      : caseStateRoute === 'billing' && accountHolderIntent === 'confirmed'
        ? 'billing'
        : null;
    if (accountHolderIntent === 'uncertain') {
      if (coalesce && !(await this.isLatestInboundTrigger(orgId, conversationId, messageId))) return;
      const reply = caseStateRoute === 'billing'
        ? 'Só para confirmar: o CPF do titular dessa conta é diferente do cadastro que encontrei?'
        : 'Só para confirmar: o CPF do titular dessa internet é diferente do cadastro que encontrei?';
      const source = 'policy:account-holder-clarification';
      await this.handleReply(
        orgId, conversationId, reply, 'direto', true, [source],
        observeAiReply({
          reply, clarification: true, sources: [source],
          identityRequiredNow: false, identityVerified, caseNextStep: null,
        }),
        coalesce ? messageId : null,
      );
      return;
    }
    if (accountHolderRebindRoute) {
      if (coalesce && !(await this.isLatestInboundTrigger(orgId, conversationId, messageId))) return;
      let ready = false;
      try {
        // Revoga primeiro o vínculo anterior; se o cache falhar, a leitura protegida continua bloqueada.
        if (!(await this.ixc.beginAccountHolderRebind(
          orgId, conversationId, conversation.contact.id, accountHolderRebindRoute,
        ))) {
          throw new Error('identity_rebind_not_started');
        }
        await this.ixcEvidenceCache.clear(orgId, conversationId);
        ready = true;
      } catch {
        // O desafio não é enviado se não houver garantia de limpar a evidência anterior.
      }
      if (!ready) {
        const departmentId = await this.applyTriage(
          orgId, conversationId, accountHolderRebindRoute, accountHolderRebindRoute, 0.9,
          fallbackSummary, false, null, null, false, ['identity_rebind_unavailable'],
        );
        await this.handleHandoff(
          orgId, conversationId,
          accountHolderRebindRoute === 'billing' ? 'confirmacao_titular_financeiro_indisponivel' : 'confirmacao_titular_indisponivel',
          accountHolderRebindRoute, accountHolderRebindRoute, 0.9, departmentId, coalesce ? messageId : null,
        );
        return;
      }
      const request = accountHolderRebindRoute === 'billing'
        ? 'Entendi. Me envie o CPF completo do titular dessa conta para consultar as informações financeiras corretas.'
        : 'Entendi. Me envie o CPF completo do titular dessa internet para consultar a conexão do endereço.';
      const reply = aiMessages.some((message) => message.role === 'assistant')
        ? request
        : `${salesFirstContactOpening()}\n\n${request}`;
      const source = accountHolderRebindRoute === 'billing'
        ? 'policy:billing-account-holder-rebind'
        : 'policy:support-account-holder-rebind';
      await this.handleReply(
        orgId, conversationId, reply, 'direto', true, [source],
        observeAiReply({
          reply, clarification: true, sources: [source],
          identityRequiredNow: true, identityVerified: false, caseNextStep: 'REQUEST_ACCOUNT_IDENTITY',
        }),
        coalesce ? messageId : null,
      );
      return;
    }
    if (caseStateRoute === 'technical_support' && supportSameHolderConfirmed(aiMessages)) {
      if (coalesce && !(await this.isLatestInboundTrigger(orgId, conversationId, messageId))) return;
      const departmentId = await this.applyTriage(
        orgId, conversationId, 'technical_support', 'technical_support', 0.9,
        fallbackSummary, false, null, null, false, ['same_holder_without_confirmed_service'],
      );
      await this.handleHandoff(
        orgId, conversationId, 'cadastro_sem_conexao_ativa',
        'technical_support', 'technical_support', 0.9, departmentId, coalesce ? messageId : null,
      );
      return;
    }
    const caseState = await this.supportCaseState.refresh({
      orgId,
      conversationId,
      messages: aiMessages,
      route: caseStateRoute,
      identityVerified,
      identityRequiredNow: queryPlan.requiresIdentity,
    });
    // Correções do CPF podem substituir o relato original no histórico curto.
    // O sintoma persistido mantém a leitura da conexão sem abrir um novo setor.
    const operationalActions = caseState.route === 'technical_support'
      && caseState.currentSymptom === 'OUTAGE'
      && identityVerified
      && /\[(?:Identidade|Valida[cç][aã]o|Resposta de valida[cç][aã]o)[^\]\n]*\]/i.test(latestUserText)
      && !queryPlan.actions.includes('connections')
      ? planIxcReads('Estou sem internet', 'technical_support').actions
      : queryPlan.actions;
    const autoViability = await this.salesAutoViabilityFlow.resolve({ orgId, conversationId, caseState });
    if (autoViability.kind !== 'NONE') {
      if (coalesce && !(await this.isLatestInboundTrigger(orgId, conversationId, messageId))) return;
      const firstResponse = !aiMessages.some((message) => message.role === 'assistant');
      const directSequence = autoViability.kind === 'REPLY'
        ? guardReplySequence({
          route: 'sales', nextStep: caseState.nextStep, reply: autoViability.reply,
          identityVerified, identityRequiredNow: false, firstResponse,
          opening: salesFirstContactOpening(),
        })
        : null;
      // Este caminho retorna antes da triagem comum. Sem gravar Vendas aqui,
      // a localização seguinte perde o setor e recebe uma pergunta genérica.
      await this.applyTriage(
        orgId, conversationId, 'sales', 'sales', 0.9, fallbackSummary,
        directSequence?.kind === 'REPLACE', null, null, false, ['deterministic_sales_auto_viability'],
      );
      await this.handleSalesAutoViability(
        orgId,
        conversationId,
        autoViability,
        identityVerified,
        typeof caseState.nextStep === 'string' ? caseState.nextStep : null,
        coalesce ? messageId : null,
        firstResponse,
      );
      return;
    }
    let identityPhoneCandidateStatus: 'candidate_ready' | 'no_candidate' | 'unavailable' | null = null;
    if (!identityVerified && queryPlan.requiresIdentity) {
      const challengeStarted = await this.ixc.startIdentityChallenge(
        orgId, conversationId, conversation.contact.id,
      );
      // A pré-busca ocorre somente em Suporte e Financeiro, antes de pedir
      // fatores pessoais. Vendas continua exclusivamente no fluxo técnico de
      // viabilidade, sem pesquisa de cadastro por telefone.
      const isAccountServiceRoute = caseStateRoute === 'technical_support' || caseStateRoute === 'billing';
      if (challengeStarted && isAccountServiceRoute) {
        const lookup = await this.ixc.preparePhoneIdentityFallback(
          orgId, conversationId, conversation.contact.id,
        );
        identityPhoneCandidateStatus = lookup.status === 'not_requested' ? 'unavailable' : lookup.status;
      }
    }
    let operationalEvidence: IxcOperationalEvidence | null = null;
    let cacheHitActions: string[] = [];
    let freshActions: string[] = [];
    if (identityVerified && operationalActions.length > 0) {
      try {
        const cached = await this.ixcEvidenceCache.read(orgId, conversationId, operationalActions);
        cacheHitActions = operationalActions.filter((action) => !cached.missing.includes(action));
        freshActions = [...cached.missing];
        operationalEvidence = cached.evidence;
        if (cached.missing.length > 0) {
          const fresh = await this.ixc.collectOperationalEvidence(orgId, conversationId, cached.missing);
          await this.ixcEvidenceCache.write(orgId, conversationId, cached.missing, fresh);
          const combinedFacts = [...(operationalEvidence?.facts ?? []), ...fresh.facts];
          operationalEvidence = {
            source: 'IXC',
            customerRef: operationalEvidence?.customerRef ?? fresh.customerRef,
            status: fresh.status === 'success' || fresh.status === 'empty'
              ? (combinedFacts.length > 0 ? 'success' : 'empty')
              : fresh.status,
            observedAt: operationalEvidence?.observedAt ?? fresh.observedAt,
            facts: combinedFacts,
          };
        }
      } catch (error) {
        this.logger.warn(
          `Consulta operacional IXC indisponível (org=${orgId}, conversation=${conversationId}): ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
        operationalEvidence = {
          source: 'IXC', status: 'unavailable', observedAt: new Date().toISOString(), facts: [],
        };
      }
    }
    if (operationalActions.length > 0) {
      await this.audit.logSystem(orgId, {
        action: 'ai.operational-plan.evaluate', entity: 'Conversation', entityId: conversationId,
        meta: {
          actions: operationalActions,
          identityVerified,
          continuedFromPrevious: queryPlan.continuedFromPrevious,
          cacheHitActions,
          freshActions,
          evidenceStatus: operationalEvidence?.status ?? (identityVerified ? 'not_executed' : 'identity_required'),
        },
      });
    }
    let networkContext: OmniNetworkResolution | null = null;
    let structuralIncident: IxcStructuralIncidentEvidence | null = null;
    let regionalIncident: { status: 'REGISTERED'; disposition: 'OPENED' | 'REOPENED_OR_REPEATED' } | null = null;
    const currentServiceConfirmed = hasCurrentIxcService(operationalEvidence);
    if (needsCurrentServiceHolder(caseState.route, identityVerified, operationalActions, operationalEvidence)) {
      if (coalesce && !(await this.isLatestInboundTrigger(orgId, conversationId, messageId))) return;
      if (supportCurrentHolderWasRequested(aiMessages)) {
        const departmentId = await this.applyTriage(
          orgId, conversationId, 'technical_support', 'technical_support', 0.9,
          fallbackSummary, false, null, null, false, ['service_not_confirmed_for_new_holder'],
        );
        await this.handleHandoff(
          orgId, conversationId, 'cadastro_sem_conexao_ativa',
          'technical_support', 'technical_support', 0.9, departmentId, coalesce ? messageId : null,
        );
        return;
      }
      let ready = false;
      try {
        if (!(await this.ixc.beginAccountHolderRebind(
          orgId, conversationId, conversation.contact.id, 'technical_support', 'current_service_not_confirmed',
        ))) throw new Error('identity_rebind_not_started');
        await this.ixcEvidenceCache.clear(orgId, conversationId);
        ready = true;
      } catch {
        // Não solicita outro CPF se não conseguiu revogar o vínculo e a evidência anteriores.
      }
      if (!ready) {
        const departmentId = await this.applyTriage(
          orgId, conversationId, 'technical_support', 'technical_support', 0.9,
          fallbackSummary, false, null, null, false, ['identity_rebind_unavailable'],
        );
        await this.handleHandoff(
          orgId, conversationId, 'confirmacao_titular_indisponivel',
          'technical_support', 'technical_support', 0.9, departmentId, coalesce ? messageId : null,
        );
        return;
      }
      const source = 'policy:support-current-service-holder';
      await this.handleReply(
        orgId, conversationId, SUPPORT_CURRENT_HOLDER_REQUEST, 'direto', true, [source],
        observeAiReply({
          reply: SUPPORT_CURRENT_HOLDER_REQUEST, clarification: true, sources: [source],
          identityRequiredNow: true, identityVerified: false, caseNextStep: 'REQUEST_ACCOUNT_IDENTITY',
        }),
        coalesce ? messageId : null,
      );
      return;
    }
    if (
      identityVerified
      && operationalActions.includes('connections')
      && operationalEvidence?.customerRef
      && currentServiceConfirmed
    ) {
      networkContext = await this.networkOrchestrator.resolve(
        operationalEvidence.customerRef,
        operationalEvidence.status,
      );
      await this.audit.logSystem(orgId, {
        action: 'ai.network-context.resolve', entity: 'Conversation', entityId: conversationId,
        meta: {
          status: networkContext.status,
          blocksSensitiveAutomation: networkContext.blocksSensitiveAutomation,
          reason: networkContext.reason,
          authorities: networkContext.authorities,
        },
      });
      const regionalOutage = confirmedRegionalNetworkIncident(networkContext);
      if (regionalOutage) {
        const registration = await this.operationalIncidents.record({
          orgId,
          source: 'OLHO_DE_DEUS',
          code: regionalOutage.code,
          severity: 'P1',
        });
        if (registration) {
          regionalIncident = { status: 'REGISTERED', disposition: registration.disposition };
          await this.audit.logSystem(orgId, {
            action: 'ai.network-regional-incident.registered',
            entity: 'Conversation',
            entityId: conversationId,
            meta: {
              disposition: registration.disposition,
              keySource: regionalOutage.keySource,
              destination: 'NOC',
              individualServiceOrderCreated: false,
            },
          });
        }
      }
    }
    // Fonte factual IXC: o cliente só entra em evento coletivo quando o seu
    // login está explicitamente listado como afetado por OS de estrutura ativa.
    // Não há inferência por sinal, caixa, OLT ou proximidade geográfica.
    if (identityVerified && operationalActions.includes('connections') && currentServiceConfirmed) {
      try {
        structuralIncident = await this.ixc.collectStructuralIncidentEvidence(orgId, conversationId);
        await this.audit.logSystem(orgId, {
          action: 'ai.ixc-structural-incident.evaluate', entity: 'Conversation', entityId: conversationId,
          meta: {
            status: structuralIncident.status,
            matchedLogins: structuralIncident.matchedLogins,
            matchedMaintenanceRegions: structuralIncident.matchedMaintenanceRegions,
            activeStructuralOrders: structuralIncident.activeStructuralOrders,
          },
        });
        if (structuralIncident.status === 'CONFIRMED' && structuralIncident.incidentCode) {
          const registration = await this.operationalIncidents.record({
            orgId,
            source: 'IXC',
            code: structuralIncident.incidentCode,
            severity: 'P2',
          });
          if (registration) {
            regionalIncident = { status: 'REGISTERED', disposition: registration.disposition };
            await this.audit.logSystem(orgId, {
              action: 'ai.network-regional-incident.registered',
              entity: 'Conversation', entityId: conversationId,
              meta: {
                disposition: registration.disposition,
                keySource: 'IXC_STRUCTURAL_OS',
                destination: 'NOC',
                individualServiceOrderCreated: false,
              },
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Evidência estrutural IXC indisponível (org=${orgId}, conversation=${conversationId}): ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      }
    }
    // A correlação caixa IXC -> telemetria ODG é deliberadamente isolada do
    // prompt. Nesta fase ela produz somente auditoria/medição em sombra: sem
    // expor membros, topologia ou criar OS/alerta a partir de uma inferência.
    if (identityVerified && operationalActions.includes('connections')) {
      try {
        await this.boxNetworkEvidence.evaluate(orgId, conversationId);
      } catch (error) {
        this.logger.warn(
          `Evidência de caixa IXC indisponível (org=${orgId}, conversation=${conversationId}): ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      }
    }
    if (fallbackSummary && conversation.caseSummary !== fallbackSummary) {
      await this.prisma.prismaSystem.conversation.update({
        where: { id: conversationId },
        data: { caseSummary: fallbackSummary },
      });
      await this.emitConversationUpdated(orgId, conversationId);
    }

    const answeredGap = await this.prisma.prismaSystem.knowledgeGap.findFirst({
      where: { orgId, conversationId, status: KnowledgeGapStatus.ANSWERED },
      orderBy: { answeredAt: 'desc' },
    });
    const activeSkills = await this.prisma.prismaSystem.operationalSkill.findMany({
      where: {
        orgId,
        status: 'ACTIVE',
        OR: [{ departmentId: null }, { department: { isActive: true } }],
      },
      include: { department: { select: { routingKey: true } } },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    const activeDirectives = await this.prisma.prismaSystem.globalDirective.findMany({
      where: {
        orgId,
        status: 'ACTIVE',
        OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
      },
      orderBy: [{ priority: 'asc' }, { key: 'asc' }, { version: 'desc' }],
    });

    // CONTRACTS §14: histograma ai_reply_duration_seconds — só a chamada
    // HTTP em si (exclui a leitura de histórico e a persistência abaixo).
    const start = process.hrtime.bigint();
    let response: Awaited<ReturnType<AiServiceClient['reply']>>;
    try {
      response = await this.aiClient.reply({
        org_id: orgId,
        conversation_id: conversationId,
        messages: aiMessages,
        contact: {
          id: conversation.contact.id,
          name: conversation.contact.name,
          phone: conversation.contact.phone,
          email: conversation.contact.email,
          memorySummary: conversation.contact.memorySummary,
        },
        clarification_count: conversation.clarificationCount,
        identity_verified: identityVerified,
        global_directives: activeDirectives.map((directive) => ({
          key: directive.key,
          title: directive.title,
          category: directive.category,
          version: directive.version,
          priority: directive.priority,
          principles: this.stringList(directive.principles),
          prohibitions: this.stringList(directive.prohibitions),
        })),
        operational_skills: activeSkills.map((skill) => ({
          key: skill.key,
          name: skill.name,
          version: skill.version,
          route_key: skill.department?.routingKey ?? null,
          trigger_conditions: this.stringList(skill.triggerConditions),
          required_data: this.stringList(skill.requiredData),
          allowed_sources: this.stringList(skill.allowedSources),
          protocol_steps: this.stringList(skill.protocolSteps),
          allowed_actions: this.stringList(skill.allowedActions),
          forbidden_actions: this.stringList(skill.forbiddenActions),
          completion_criteria: this.stringList(skill.completionCriteria),
          review_conditions: this.stringList(skill.reviewConditions),
          human_handoff_conditions: this.stringList(skill.humanHandoffConditions),
          identity_requirement: skill.identityRequirement,
          minimum_confidence: skill.minimumConfidence,
        })),
        operational_context: {
          identity_verified: identityVerified,
          identity_required_now: queryPlan.requiresIdentity,
          // Compatível com o contrato atual da IA: o telefone somente é um
          // dado de recuperação quando a conversa ainda não o possui.
          identity_phone_required: !conversation.contact.phone,
          identity_phone_candidate_status: identityPhoneCandidateStatus,
          case_state: caseState,
          planned_actions: operationalActions,
          previous_intent: queryPlan.continuedFromPrevious
            ? caseStateRoute
            : conversation.lastIntent,
          triage_confidence: conversation.triageConfidence,
          evidence: operationalEvidence,
          network_context: networkContext,
          structural_incident: structuralIncident ? {
            source: structuralIncident.source,
            status: structuralIncident.status,
            observedAt: structuralIncident.observedAt,
            matchedLogins: structuralIncident.matchedLogins,
            matchedMaintenanceRegions: structuralIncident.matchedMaintenanceRegions,
            activeStructuralOrders: structuralIncident.activeStructuralOrders,
          } : null,
          regional_incident: regionalIncident,
          continued_from_previous: queryPlan.continuedFromPrevious,
          cache_hit_actions: cacheHitActions,
          fresh_actions: freshActions,
          gap_resolution: answeredGap?.answer
            ? { gap_id: answeredGap.id, reason: answeredGap.reason, guidance: answeredGap.answer }
            : null,
        },
      });
    } catch (error) {
      // Mantém os retries normais do BullMQ. Somente no último deles emitimos
      // uma resposta de contingência: o resumo e o estado estruturado já foram
      // persistidos antes da chamada remota, portanto a pessoa não perde o
      // contexto nem o incidente vira um GAP de aprendizagem.
      if (!isFinalAiReplyAttempt(job.attemptsMade, job.opts.attempts)) {
        throw error;
      }
      this.logger.error(
        `Serviço de IA indisponível após todas as tentativas (org=${orgId}, conversation=${conversationId}): ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      try {
        await this.audit.logSystem(orgId, {
          action: 'ai.reply.contingency',
          entity: 'Conversation',
          entityId: conversationId,
          meta: { reason: AI_REPLY_CONTINGENCY_REASON, attempts: job.attemptsMade + 1 },
        });
      } catch (auditError) {
        this.logger.warn(
          `Não foi possível auditar a contingência da IA (conversation=${conversationId}): ${auditError instanceof Error ? auditError.message : 'erro desconhecido'}`,
        );
      }
      await this.operationalIncidents.record({
        orgId,
        source: 'AI_PROVIDER',
        code: AI_REPLY_CONTINGENCY_REASON,
        severity: 'P2',
      });
      await this.handleReply(
        orgId,
        conversationId,
        aiReplyContingencyMessage(),
        'contingencia',
        false,
        [],
        observeAiReply({
          reply: aiReplyContingencyMessage(),
          clarification: false,
          sources: [],
          identityRequiredNow: queryPlan.requiresIdentity,
          identityVerified,
          caseNextStep: typeof caseState?.nextStep === 'string' ? caseState.nextStep : null,
        }),
        coalesce ? messageId : null,
      );
      return;
    } finally {
      this.metrics.observeAiReplyDuration(Number(process.hrtime.bigint() - start) / 1e9);
    }

    // A validação feita antes da chamada evita trabalho desnecessário. Esta
    // segunda validação fecha a corrida em que outra mensagem chega enquanto
    // IXC/Olho de Deus/IA ainda estão processando o turno anterior.
    if (coalesce && !(await this.isLatestInboundTrigger(orgId, conversationId, messageId))) {
      return;
    }

    // O modelo pode solicitar os fatores antes de o plano de leitura passar a
    // exigi-los. Neste caso, abrimos o desafio com base na resposta efetiva,
    // impedindo que a próxima mensagem seja persistida como texto comum.
    if (!identityVerified && responseRequestsIdentityChallenge(response.reply)) {
      try {
        await this.ixc.startIdentityChallenge(orgId, conversationId, conversation.contact.id);
      } catch (error) {
        this.logger.warn(
          `Não foi possível preparar validação de identidade (org=${orgId}, conversation=${conversationId}): ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        );
      }
    }

    // Perguntas de continuidade ("qual a previsão?", "e dessas ordens?") não
    // devem apagar um setor específico já sustentado pelo histórico operacional.
    // O modelo ainda pode trocar de setor quando classifica uma nova intenção
    // específica; apenas o fallback genérico é estabilizado aqui.
    const effectiveIntent = response.intent === 'general_support'
      && recoveredOperationalIntent
      && recoveredOperationalIntent !== 'general_support'
      ? recoveredOperationalIntent
      : response.intent ?? 'general_support';
    const effectiveRouteKey = resolveReplyRouteKey(response.route_key, effectiveIntent);
    const effectiveConfidence = effectiveIntent !== (response.intent ?? 'general_support')
      ? Math.max(response.triage_confidence ?? 0, conversation.triageConfidence ?? 0)
      : response.triage_confidence ?? 0;
    const sequence = response.reply && !response.handoff ? guardReplySequence({
      route: caseState.route,
      nextStep: caseState.nextStep,
      reply: response.reply,
      identityVerified,
      identityRequiredNow: queryPlan.requiresIdentity,
      currentSymptom: caseState.route === 'technical_support' ? caseState.currentSymptom : undefined,
      supportLosLight: caseState.route === 'technical_support' ? caseState.losLight : undefined,
      customerReportedRedLight: aiMessages.some((message) => message.role === 'user'
        && /\bluz\b.{0,32}\bvermelh/i.test(message.content)),
      equipmentRestarted: caseState.route === 'technical_support' ? caseState.equipmentRestarted : undefined,
      affectedMultipleDevices: caseState.route === 'technical_support' ? caseState.affectedMultipleDevices : undefined,
      currentServiceConfirmed,
      regionalCheckComplete: regionalIncident?.status === 'REGISTERED'
        || structuralIncident?.status === 'NOT_CONFIRMED',
      regionalEventConfirmed: structuralIncident?.status === 'CONFIRMED'
        || confirmedRegionalNetworkIncident(networkContext) !== null,
      regionalIncidentRegistered: regionalIncident?.status === 'REGISTERED',
      latestUserText,
      firstResponse: !aiMessages.some((message) => message.role === 'assistant'),
      opening: salesFirstContactOpening(),
    }) : null;
    const finalClarification = sequence?.kind === 'HANDOFF'
      ? false : sequence?.kind === 'REPLACE' || response.clarification === true;

    const selectedSkill = response.selected_skill_key && response.selected_skill_version
      ? activeSkills.find((skill) => (
        skill.key === response.selected_skill_key
        && skill.version === response.selected_skill_version
      )) ?? null
      : null;
    if (selectedSkill) {
      await this.audit.logSystem(orgId, {
        action: 'ai.operational-skill.select',
        entity: 'OperationalSkill',
        entityId: selectedSkill.id,
        meta: {
          conversationId,
          key: selectedSkill.key,
          version: selectedSkill.version,
          routeKey: effectiveRouteKey,
        },
      });
      const allowedActions = this.stringList(selectedSkill.allowedActions);
      if (allowedActions.some((action) => (
        action === 'request_ticket' || action === 'request_service_order'
      ))) {
        const shadow = evaluateShadowAction({
          allowedActions,
          forbiddenActions: this.stringList(selectedSkill.forbiddenActions),
          minimumConfidence: selectedSkill.minimumConfidence,
          triageConfidence: effectiveConfidence,
          handoff: response.handoff || sequence?.kind === 'HANDOFF',
          clarification: finalClarification,
          evidence: operationalEvidence,
          networkDiagnosis: networkContext?.context?.diagnosis ?? null,
        });
        const occurrenceId = shadow.eligible
          ? deriveOccurrenceId({
              conversationId,
              messageId,
              customerId: shadow.customerId,
              networkEventId: networkContext?.context?.networkEventId,
            })
          : null;
        await this.audit.logSystem(orgId, {
          action: shadow.eligible
            ? 'ai.operational-action.shadow.eligible'
            : 'ai.operational-action.shadow.blocked',
          entity: 'Conversation',
          entityId: conversationId,
          meta: {
            skillId: selectedSkill.id,
            skillVersion: selectedSkill.version,
            eligible: shadow.eligible,
            action: shadow.action,
            reason: shadow.reason,
            occurrenceId,
            occurrenceSource: networkContext?.context?.networkEventId ? 'NETWORK_EVENT_ID' : 'MESSAGE_TRIGGER',
          },
        });
      }
    }

    if (answeredGap) {
      await this.prisma.prismaSystem.knowledgeGap.update({
        where: { id: answeredGap.id },
        data: { status: KnowledgeGapStatus.APPLIED },
      });
    }

    const departmentId = await this.applyTriage(
      orgId,
      conversationId,
      effectiveIntent,
      effectiveRouteKey,
      effectiveConfidence,
      response.case_summary ?? fallbackSummary,
      finalClarification,
      response.secondary_intent ?? null,
      response.alternative_route_key ?? null,
      response.conflict_detected === true,
      response.routing_evidence ?? [],
    );

    // Métricas agregadas de regressão: a conversa continua sendo auditada em
    // detalhe, mas aqui só registramos setor e resultado em valores fechados.
    // Assim, conseguimos acompanhar roteamento, esclarecimentos e handoffs
    // sem criar séries por cliente, conversa ou mensagem.
    this.metrics.recordAiDecision(
      effectiveRouteKey,
      response.handoff || sequence?.kind === 'HANDOFF' ? 'handoff' : finalClarification ? 'clarification' : 'reply',
    );
    if (conversation.department?.routingKey) {
      this.metrics.recordAiRouteTransition(conversation.department.routingKey, effectiveRouteKey);
    }

    if (response.handoff) {
      // Uma fonte indisponível foi observada pelo runtime, portanto não
      // delegamos ao modelo a classificação desta causa. Isso evita criar um
      // GAP de RAG quando o problema real é IXC/Olho de Deus temporariamente
      // indisponível. Com fontes saudáveis, o motivo do modelo é preservado.
      const handoffReason = resilientHandoffReason(response.handoff_reason, {
        ixcEvidenceStatus: operationalEvidence?.status,
        networkReason: networkContext?.reason,
      });
      await this.handleHandoff(
        orgId,
        conversationId,
        handoffReason,
        effectiveIntent,
        effectiveRouteKey,
        effectiveConfidence,
        departmentId,
        coalesce ? messageId : null,
      );
      return;
    }

    if (response.reply) {
      if (!sequence) return;
      if (sequence.kind !== 'PASS') {
        await this.audit.logSystem(orgId, {
          action: 'ai.reply.sequence-guard', entity: 'Conversation', entityId: conversationId,
          meta: { route: caseState.route, nextStep: caseState.nextStep,
            decision: sequence.kind, reason: sequence.kind === 'HANDOFF' ? sequence.violation : sequence.reason },
        });
      }
      if (sequence.kind === 'HANDOFF') {
        await this.handleHandoff(
          orgId, conversationId, sequence.reason, effectiveIntent, effectiveRouteKey,
          effectiveConfidence, departmentId, coalesce ? messageId : null,
        );
        return;
      }
      const reply = sequence.reply;
      const sources = sequence.kind === 'REPLACE'
        ? ['policy:reply-sequence-guard']
        : response.sources.filter((source): source is string => typeof source === 'string');
      const clarification = sequence.kind === 'REPLACE' ? true : response.clarification === true;
      const observation = observeAiReply({
        reply,
        clarification,
        sources,
        identityRequiredNow: queryPlan.requiresIdentity,
        identityVerified,
        caseNextStep: typeof caseState?.nextStep === 'string' ? caseState.nextStep : null,
      });
      observation.sequence = {
        route: caseState.route, nextStep: caseState.nextStep,
        decision: sequence.kind, reason: sequence.reason,
      };
      const published = await this.handleReply(
        orgId,
        conversationId,
        reply,
        response.conversation_level ?? 'direto',
        clarification,
        sources,
        observation,
        coalesce ? messageId : null,
      );
      if (published) await this.enqueueMemoryCheckpoint(
        orgId,
        conversationId,
        conversation.contact.id,
        conversation.contact.memoryUpdatedAt,
        clarification,
        sources,
      );
    }
  }

  /**
   * Atualiza memória após um marco confiável, sem esperar o fechamento manual.
   * Perguntas de esclarecimento, respostas sem fonte e intervalos muito curtos
   * são ignorados para evitar ruído e custo desnecessário.
   */
  private async enqueueMemoryCheckpoint(
    orgId: string,
    conversationId: string,
    contactId: string,
    memoryUpdatedAt: Date | null,
    clarification: boolean,
    sources: string[],
  ): Promise<void> {
    if (clarification || sources.length === 0) return;
    if (
      memoryUpdatedAt
      && Date.now() - memoryUpdatedAt.getTime() < MEMORY_CHECKPOINT_INTERVAL_MS
    ) return;
    const bucket = Math.floor(Date.now() / MEMORY_CHECKPOINT_INTERVAL_MS);
    await this.memorySummarizeQueue.add(
      'checkpoint',
      { orgId, contactId, conversationId },
      { jobId: `memory-checkpoint-${conversationId}-${bucket}` },
    );
  }

  /** Caminho determinístico: a IA não escolhe campos nem repete uma ação IXC. */
  private async handleSalesAutoViability(
    orgId: string,
    conversationId: string,
    flow: Awaited<ReturnType<SalesAutoViabilityFlowService['resolve']>>,
    identityVerified: boolean,
    caseNextStep: string | null,
    triggerMessageId: string | null,
    firstResponse: boolean,
  ): Promise<void> {
    if (triggerMessageId && !(await this.isLatestInboundTrigger(orgId, conversationId, triggerMessageId))) {
      return;
    }
    if (flow.kind === 'REPLY') {
      const reply = firstResponse ? `${salesFirstContactOpening()}\n\n${flow.reply}` : flow.reply;
      const sequence = guardReplySequence({
        route: 'sales', nextStep: caseNextStep, reply,
        identityVerified, identityRequiredNow: false,
        firstResponse, opening: salesFirstContactOpening(),
      });
      if (sequence.kind === 'HANDOFF') return;
      if (sequence.kind === 'REPLACE') {
        await this.audit.logSystem(orgId, {
          action: 'ai.reply.sequence-guard', entity: 'Conversation', entityId: conversationId,
          meta: { route: 'sales', nextStep: caseNextStep, decision: sequence.kind, reason: sequence.reason },
        });
      }
      const sources = sequence.kind === 'REPLACE'
        ? ['policy:reply-sequence-guard'] : ['IXC:inmap-auto-viability-flow'];
      const observation = observeAiReply({
        reply: sequence.reply, clarification: sequence.kind === 'REPLACE', sources,
        identityRequiredNow: false, identityVerified, caseNextStep,
      });
      observation.sequence = {
        route: 'sales', nextStep: caseNextStep,
        decision: sequence.kind, reason: sequence.reason,
      };
      await this.handleReply(
        orgId, conversationId, sequence.reply, 'direto', sequence.kind === 'REPLACE', sources,
        observation,
        triggerMessageId,
      );
      return;
    }
    if (flow.kind !== 'EXECUTE') return;
    try {
      const result = await this.tenancy.run({ orgId }, () => this.ixc.checkAutoViability({
        conversationId, ...flow.input,
      }));
      const eligiblePlanText = result.eligiblePlans.length > 0
        ? result.eligiblePlans.slice(0, 6).map((plan) => {
            const value = plan.value === null
              ? ''
              : ` — ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(plan.value)}`;
            return `${plan.name}${value}`;
          }).join('; ')
        : null;
      const resultReply = result.status === 'CONFIRMED'
        ? eligiblePlanText
          ? `A consulta oficial confirmou disponibilidade. Planos compatíveis para o local: ${eligiblePlanText}. Qual deles você prefere?`
          : 'A consulta oficial confirmou disponibilidade para o local. Os planos elegíveis não vieram identificados nessa resposta do IXC; encaminhei para conferência comercial sem pedir os dados novamente.'
        : result.status === 'NOT_AVAILABLE'
          ? 'A consulta oficial não identificou disponibilidade para o endereço informado neste momento. Não vou sugerir um plano incompatível. Se quiser, posso registrar seu interesse para análise comercial.'
          : 'A consulta oficial não conseguiu concluir a disponibilidade. Não vou estimar cobertura; o resultado ficará disponível para revisão comercial.';
      const reply = firstResponse ? `${salesFirstContactOpening()}\n\n${resultReply}` : resultReply;
      await this.handleReply(
        orgId, conversationId, reply, 'direto', false, ['IXC:inmap-auto-viability'],
        observeAiReply({
          reply, clarification: false, sources: ['IXC:inmap-auto-viability'],
          identityRequiredNow: false, identityVerified, caseNextStep,
        }),
        triggerMessageId,
      );
    } catch (error) {
      await this.audit.logSystem(orgId, {
        action: 'conversation.sales-auto-viability.direct-failed', entity: 'Conversation', entityId: conversationId,
        meta: { errorType: error instanceof Error ? error.constructor.name : 'UnknownError' },
      });
      const resultReply = 'Não foi possível concluir a consulta oficial agora. Ela não será repetida automaticamente; seu atendimento fica preservado para revisão.';
      const reply = firstResponse ? `${salesFirstContactOpening()}\n\n${resultReply}` : resultReply;
      await this.handleReply(
        orgId, conversationId, reply, 'direto', false, ['IXC:inmap-auto-viability'],
        observeAiReply({
          reply, clarification: false, sources: ['IXC:inmap-auto-viability'],
          identityRequiredNow: false, identityVerified, caseNextStep,
        }),
        triggerMessageId,
      );
    }
  }

  /** Persiste a triagem e resolve a fila por routingKey, com fallback seguro. */
  private async applyTriage(
    orgId: string,
    conversationId: string,
    intent: string,
    routeKey: string,
    confidence: number,
    caseSummary: string | null,
    clarification: boolean,
    secondaryIntent: string | null,
    alternativeRouteKey: string | null,
    conflictDetected: boolean,
    routingEvidence: string[],
  ): Promise<string | null> {
    // ``unrouted`` é uma desambiguação curta, não uma quarta fila. Durante
    // ela não atribuímos departamento nem aplicamos o fallback padrão; uma
    // intenção seguinte e específica fará a primeira atribuição.
    const routed = routeKey === 'unrouted'
      ? null
      : await this.prisma.prismaSystem.department.findFirst({
          where: { orgId, isActive: true, routingKey: routeKey },
          select: { id: true },
        });
    const department = routed ?? (routeKey === 'unrouted'
      ? null
      : await this.prisma.prismaSystem.department.findFirst({
          where: { orgId, isActive: true, isDefault: true },
          select: { id: true },
        }));
    await this.prisma.prismaSystem.conversation.update({
      where: { id: conversationId },
      data: {
        lastIntent: intent,
        secondaryIntent,
        alternativeRouteKey,
        triageConflict: conflictDetected,
        routingEvidence,
        triageConfidence: Math.max(0, Math.min(1, confidence)),
        triagedAt: new Date(),
        caseSummary,
        clarificationCount: clarification ? { increment: 1 } : 0,
        ...(department ? { departmentId: department.id } : {}),
      },
    });
    return department?.id ?? null;
  }

  private stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }

  private async isLatestInboundTrigger(
    orgId: string,
    conversationId: string,
    triggerMessageId: string,
  ): Promise<boolean> {
    const latestInbound = await this.prisma.prismaSystem.message.findFirst({
      where: {
        orgId,
        conversationId,
        direction: MessageDirection.INBOUND,
        type: { not: MessageType.SYSTEM },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return isCurrentAiReplyTrigger(triggerMessageId, latestInbound?.id);
  }

  /** Cria a resposta da IA como OUTBOUND PENDING e enfileira a entrega. */
  private async handleReply(
    orgId: string,
    conversationId: string,
    reply: string,
    conversationLevel: string,
    clarification: boolean,
    sources: string[],
    observation: ResponseObservation,
    triggerMessageId: string | null = null,
  ): Promise<boolean> {
    const conversationChannel = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId }, select: { channel: { select: { type: true } } },
    });
    const isWhatsApp = conversationChannel?.channel.type === 'WHATSAPP';
    const trigger = isWhatsApp && triggerMessageId && hasEmoji(reply)
      ? await this.prisma.prismaSystem.message.findFirst({
          where: { id: triggerMessageId, orgId, conversationId, direction: MessageDirection.INBOUND },
          select: { content: true },
        })
      : null;
    const customerUsedEmoji = trigger !== null && hasEmoji(
      typeof trigger.content === 'object' && trigger.content !== null
        ? String((trigger.content as Record<string, unknown>).text ?? '')
        : '',
    );
    const replyParts = this.presentationParts(reply, isWhatsApp, customerUsedEmoji);
    if (replyParts.length === 0) return false;
    const messages = await this.prisma.prismaSystem.$transaction(async (tx) => {
      if (triggerMessageId) {
        // Serializa apenas a publicação da mesma conversa. O lock é liberado
        // automaticamente no fim da transação e não retém conteúdo do cliente.
        // O lock retorna void no PostgreSQL. Prisma não desserializa uma
        // coluna void em $queryRaw; converter o resultado para text preserva
        // o bloqueio transacional e permite publicar a resposta.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${orgId}:${conversationId}`}))::text AS lock_acquired`;
        const latestInbound = await tx.message.findFirst({
          where: {
            orgId,
            conversationId,
            direction: MessageDirection.INBOUND,
            type: { not: MessageType.SYSTEM },
          },
          select: { id: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (!isCurrentAiReplyTrigger(triggerMessageId, latestInbound?.id)) return [];
        const alreadyPublished = await tx.message.findFirst({
          where: {
            orgId,
            conversationId,
            direction: MessageDirection.OUTBOUND,
            isAiGenerated: true,
            content: { path: ['turnTriggerId'], equals: triggerMessageId },
          },
          select: { id: true },
        });
        if (alreadyPublished) return [];
      }
      const created = [];
      for (const text of replyParts) {
        const content = {
          text,
          conversationLevel,
          clarification,
          sources,
          trace: {
            expectation: observation.traceExpectation,
            reason: observation.traceReason,
            ...(observation.sequence ? { sequence: observation.sequence } : {}),
          },
          ...(observation.clarificationKey ? { clarificationKey: observation.clarificationKey } : {}),
          ...(triggerMessageId ? { turnTriggerId: triggerMessageId } : {}),
        };
        created.push(await tx.message.create({
          data: {
            orgId,
            conversationId,
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT,
            content,
            status: MessageStatus.PENDING,
            isAiGenerated: true,
          },
          include: messageInclude,
        }));
      }
      const last = created.at(-1)!;
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: last.createdAt,
          lastMessagePreview: messagePreview(MessageType.TEXT, last.content as Record<string, unknown>),
        },
      });
      return created;
    });

    if (messages.length === 0) return false;

    for (const message of messages) {
      await this.emitMessageNew(orgId, conversationId, message);
    }
    await this.messageOutboundQueue.add('deliver', {
      orgId, messageId: messages[0]!.id,
      turnMessageIds: messages.map((message) => message.id),
    });
    return true;
  }

  private replyParts(reply: string): string[] {
    const [opening, ...rest] = reply.split(/\n{2,}/);
    if (rest.length === 0 || !/^(?:Bom dia|Boa tarde|Boa noite)! Tudo bem\?$/u.test(opening.trim())) {
      return [reply];
    }
    const body = rest.join('\n\n').trim();
    return body ? [opening.trim(), body] : [opening.trim()];
  }

  /** A apresentação é comum às respostas normais e aos avisos de encaminhamento. */
  private presentationParts(reply: string, isWhatsApp: boolean, customerUsedEmoji = false): string[] {
    return isWhatsApp ? whatsappReplyParts(reply, customerUsedEmoji) : this.replyParts(reply);
  }

  /** Abre uma dúvida interna; a IA permanece responsável pela conversa. */
  private async handleHandoff(
    orgId: string,
    conversationId: string,
    reason: string | undefined,
    intent: string,
    routeKey: string,
    confidence: number,
    departmentId: string | null,
    triggerMessageId: string | null = null,
  ): Promise<void> {
    if (triggerMessageId && !(await this.isLatestInboundTrigger(orgId, conversationId, triggerMessageId))) {
      return;
    }
    const classification = classifyHandoff(reason);
    await this.audit.logSystem(orgId, {
      action: 'ai.handoff.classified', entity: 'Conversation', entityId: conversationId,
      meta: {
        disposition: classification.disposition,
        reason: classification.auditReason,
        intent,
        routeKey,
      },
    });
    if (classification.disposition === 'TECHNICAL_INCIDENT') {
      const incident = this.toTechnicalIncident(classification.auditReason);
      if (incident) {
        await this.operationalIncidents.record({ orgId, ...incident, severity: 'P2' });
      }
    }
    if (classification.disposition === 'KNOWLEDGE_GAP') {
      await this.knowledgeGaps.createSystem({
        orgId, conversationId, departmentId,
        reason: classification.auditReason,
        question: `Qual orientação deve ser usada para resolver este atendimento (${intent})?`,
        context: { intent, routeKey, confidence },
      });
    }

    // Mensagem SYSTEM visível na timeline, nunca enviada ao cliente. O texto
    // indica para a equipe se é conhecimento, incidente ou revisão, sem expor
    // conteúdo da conversa nos logs.
    const internalText = classification.disposition === 'KNOWLEDGE_GAP'
      ? 'Dúvida de conhecimento encaminhada para curadoria; a IA permanece no atendimento'
      : classification.disposition === 'TECHNICAL_INCIDENT'
        ? 'Incidente técnico interno registrado; a IA permanece no atendimento'
        : 'Revisão operacional encaminhada; a IA permanece no atendimento';
    const systemMessage = await this.prisma.prismaSystem.message.create({
      data: {
        orgId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.SYSTEM,
        content: {
          text: internalText,
          handoff_reason: classification.auditReason,
          handoff_disposition: classification.disposition,
          intent,
          route_key: routeKey,
          triage_confidence: confidence,
        },
        status: MessageStatus.SENT,
        isAiGenerated: true,
      },
      include: messageInclude,
    });

    await this.emitConversationUpdated(orgId, conversationId);
    await this.emitMessageNew(orgId, conversationId, systemMessage);
    await this.createHandoffAcknowledgement(orgId, conversationId, reason);

    await this.automationRunQueue.add('conversation.handoff', {
      orgId,
      event: 'conversation.handoff',
      context: {
        conversationId,
        departmentId,
        intent,
        routeKey,
        confidence,
        reason: classification.auditReason,
        disposition: classification.disposition,
      },
    });
    if (classification.disposition === 'KNOWLEDGE_GAP') {
      await this.automationRunQueue.add('conversation.knowledge-gap', {
        orgId,
        event: 'conversation.knowledge-gap',
        context: { conversationId, departmentId, intent, routeKey, confidence, reason: classification.auditReason },
      });
    }
  }

  /** Não alerta Teams para erro de digitação/identidade do cliente; só fontes técnicas reais. */
  private toTechnicalIncident(reason: string): { source: OperationalIncidentSource; code: string } | null {
    if (reason.includes('ixc')) return { source: 'IXC', code: 'ixc_indisponivel' };
    if (reason.includes('olho_de_deus')) return { source: 'OLHO_DE_DEUS', code: 'olho_de_deus_indisponivel' };
    if (reason.includes('llm') || reason.includes('provedor') || reason.includes('servico_de_ia')) {
      return { source: 'AI_PROVIDER', code: 'ai_provider_indisponivel' };
    }
    return null;
  }

  private async createHandoffAcknowledgement(
    orgId: string,
    conversationId: string,
    reason: string | undefined,
  ): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId }, select: { channel: { select: { type: true } } },
    });
    const parts = this.presentationParts(
      handoffMessage(reason, conversationId), conversation?.channel.type === 'WHATSAPP',
    );
    if (parts.length === 0) return;
    const messages = await this.prisma.prismaSystem.$transaction(async (tx) => {
      const created = [];
      for (const text of parts) {
        created.push(await tx.message.create({
          data: {
            orgId, conversationId, direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT, content: { text, handoff: true },
            status: MessageStatus.PENDING, isAiGenerated: true,
          },
          include: messageInclude,
        }));
      }
      const last = created.at(-1)!;
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: last.createdAt,
          lastMessagePreview: messagePreview(MessageType.TEXT, last.content as Record<string, unknown>),
        },
      });
      return created;
    });
    for (const message of messages) await this.emitMessageNew(orgId, conversationId, message);
    await this.messageOutboundQueue.add('deliver', {
      orgId, messageId: messages[0]!.id,
      ...(messages.length > 1 ? { turnMessageIds: messages.map((message) => message.id) } : {}),
    });
  }

  private async emitMessageNew(
    orgId: string,
    conversationId: string,
    message: Parameters<typeof toMessageDto>[0],
  ): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: conversationInclude,
    });
    if (!conversation) {
      return;
    }
    this.realtime.emitMessageNew(orgId, {
      message: toMessageDto(message),
      conversation: toConversationDto(conversation),
    });
  }

  private async emitConversationUpdated(orgId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: conversationInclude,
    });
    if (!conversation) {
      return;
    }
    this.realtime.emitConversationUpdated(orgId, { conversation: toConversationDto(conversation) });
  }

  private textOf(message: Message): string {
    const content = message.content;
    if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
      const locationStatus = (content as Record<string, unknown>).identityLocationStatus;
      if (locationStatus === 'candidate_ready') {
        return '[Localização recebida para confirmar o cadastro]';
      }
      if (locationStatus === 'no_candidate') {
        return '[Localização recebida sem cadastro correspondente]';
      }
      if (locationStatus === 'unavailable') {
        return '[Localização recebida; consulta de cadastro indisponível]';
      }
      const text = (content as Record<string, unknown>).text;
      if (typeof text === 'string' && text.length > 0) {
        return text;
      }
    }
    return `[${message.type.toLowerCase()}]`;
  }
}
