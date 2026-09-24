import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationalActionRequestStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { identityVerificationIsValid } from '../common/identity-verification';
import { IxcService } from '../integrations/ixc/ixc.service';
import type { IxcOperationalEvidence } from '../integrations/ixc/ixc.types';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { SimulateOperationalActionDto } from './dto/simulate-operational-action.dto';
import type { ReviewOperationalActionDto } from './dto/review-operational-action.dto';
import { HOMOLOGATION_SCENARIOS } from './homologation-scenarios';
import { OMNI_OPERATIONAL_POLICY } from '../operational-policy/omni-operational-policy';
import { findEquivalentOperationalRecords } from './operational-duplicate-policy';
import {
  IXC_OPERATIONAL_MAPPING_DRAFTS,
  resolveIxcMappingForSimulation,
} from '../integrations/ixc/ixc-operational-mapping';

const COLLECTIVE = new Set(['COLLECTIVE_OUTAGE_SUSPECTED', 'COLLECTIVE_OUTAGE_CONFIRMED']);
const NON_ACTIONABLE_NETWORK = new Set(['INCONCLUSIVE', 'IXC_FALSE_POSITIVE_SUSPECTED']);
const ACTIVE_CONTRACT = new Set(['A', 'ATIVO', 'ACTIVE']);
const EXECUTION_OWNERSHIP = OMNI_OPERATIONAL_POLICY.ownership;

@Injectable()
export class OperationalActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly ixc: IxcService,
    private readonly audit: AuditService,
  ) {}

  homologationPlan() {
    return {
      policy: OMNI_OPERATIONAL_POLICY,
      mode: OMNI_OPERATIONAL_POLICY.effectiveMode,
      externalWriteEnabled: OMNI_OPERATIONAL_POLICY.externalWriteEnabled,
      requiredModeForFirstRealTest: OMNI_OPERATIONAL_POLICY.firstRealTestMode,
      scenarios: HOMOLOGATION_SCENARIOS,
    };
  }

  async simulate(dto: SimulateOperationalActionDto) {
    let resolvedMapping;
    try {
      resolvedMapping = resolveIxcMappingForSimulation(
        IXC_OPERATIONAL_MAPPING_DRAFTS, dto.mappingKey, dto.action,
      );
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'IXC_MAPPING_INVALID');
    }
    const subjectId = resolvedMapping.action === 'request_ticket'
      ? resolvedMapping.mapping.ticketSubjectId
      : resolvedMapping.mapping.serviceOrderSubjectId;
    const [conversation, skill] = await Promise.all([
      this.prisma.tenant.conversation.findUnique({
        where: { id: dto.conversationId },
        select: {
          id: true,
          departmentId: true,
          department: { select: { routingKey: true } },
          triageConfidence: true,
          identityVerifiedAt: true,
        },
      }),
      this.prisma.tenant.operationalSkill.findUnique({ where: { id: dto.skillId } }),
    ]);
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (!skill) throw new NotFoundException('Skill operacional não encontrada');

    const allowedActions = this.stringSet(skill.allowedActions);
    const forbiddenActions = this.stringSet(skill.forbiddenActions);
    const blockers: string[] = [];
    if (skill.status !== 'ACTIVE') blockers.push('skill_not_active');
    if (skill.validUntil && skill.validUntil.getTime() < Date.now()) blockers.push('skill_expired');
    if (skill.departmentId && skill.departmentId !== conversation.departmentId) blockers.push('department_mismatch');
    if (conversation.department?.routingKey !== OMNI_OPERATIONAL_POLICY.scope.pilotDepartmentRoutingKey) {
      blockers.push('support_department_required');
    }
    if (!allowedActions.has(dto.action)) blockers.push('action_not_allowed');
    if (forbiddenActions.has(dto.action)) blockers.push('action_explicitly_forbidden');
    if (!identityVerificationIsValid(conversation.identityVerifiedAt)) blockers.push('identity_not_verified');
    const requiredConfidence = Math.max(
      skill.minimumConfidence,
      OMNI_OPERATIONAL_POLICY.safety.minimumConfidenceFloor,
    );
    if ((conversation.triageConfidence ?? 0) < requiredConfidence) {
      blockers.push('confidence_below_required_minimum');
    }
    if (dto.networkDiagnosis && COLLECTIVE.has(dto.networkDiagnosis)) blockers.push('collective_outage_blocks_individual_action');
    if (dto.networkDiagnosis && NON_ACTIONABLE_NETWORK.has(dto.networkDiagnosis)) blockers.push('network_context_not_actionable');
    if (
      dto.action === 'request_service_order' &&
      dto.networkDiagnosis !== OMNI_OPERATIONAL_POLICY.scope.serviceOrderRequiredDiagnosis
    ) {
      blockers.push('service_order_requires_confirmed_individual_failure');
    }

    if (blockers.length > 0) {
      const blocked = {
        mode: 'SIMULATION' as const,
        executionOwnership: EXECUTION_OWNERSHIP,
        action: dto.action,
        proposedState: 'BLOCKED' as const,
        authorizedForSimulation: false,
        blockers,
        skill: { id: skill.id, key: skill.key, version: skill.version },
        externalReadPerformed: false,
        externalWritePerformed: false,
        requiresApproval: true,
        wouldCreate: false,
        deduplicationKey: null,
        duplicateCandidates: [],
      };
      await this.audit.log({
        action: 'operational-action.simulation.blocked',
        entity: 'Conversation',
        entityId: dto.conversationId,
        meta: { requestedAction: dto.action, skillId: skill.id, blockers },
      });
      return blocked;
    }

    // A confirmação de identidade não pode autorizar uma ação para outro
    // cadastro. A evidência operacional parte do vínculo efêmero que a
    // validação IXC acabou de confirmar; nenhum CPF ou mês é persistido aqui.
    const orgId = this.tenancy.getOrgIdOrThrow();
    let identityEvidence: IxcOperationalEvidence | null;
    try {
      identityEvidence = await this.ixc.collectOperationalEvidence(
        orgId,
        dto.conversationId,
        ['contracts'],
      );
    } catch {
      identityEvidence = null;
    }
    const verifiedContract = identityEvidence?.facts.find((fact) => (
      fact.resource === 'contracts' && fact.entityRef === dto.contractId
    ));
    if (
      !identityEvidence
      || !['success', 'empty'].includes(identityEvidence.status)
      || identityEvidence.customerRef !== dto.customerId
      || !verifiedContract
      || !ACTIVE_CONTRACT.has(String(verifiedContract?.fields.status ?? '').toUpperCase())
    ) {
      const bindingBlocker = !identityEvidence || !['success', 'empty'].includes(identityEvidence.status)
        ? 'identity_binding_unavailable'
        : identityEvidence.customerRef !== dto.customerId
          ? 'identity_customer_mismatch'
          : !verifiedContract
            ? 'identity_contract_mismatch'
            : 'identity_contract_inactive';
      const blocked = {
        mode: 'SIMULATION' as const,
        executionOwnership: EXECUTION_OWNERSHIP,
        action: dto.action,
        proposedState: 'BLOCKED' as const,
        authorizedForSimulation: false,
        blockers: [bindingBlocker],
        skill: { id: skill.id, key: skill.key, version: skill.version },
        externalReadPerformed: true,
        externalWritePerformed: false,
        requiresApproval: true,
        wouldCreate: false,
        deduplicationKey: null,
        duplicateCandidates: [],
      };
      await this.audit.log({
        action: 'operational-action.simulation.blocked',
        entity: 'Conversation',
        entityId: dto.conversationId,
        meta: { requestedAction: dto.action, skillId: skill.id, blockers: [bindingBlocker] },
      });
      return blocked;
    }

    const [tickets, serviceOrders] = await Promise.all([
      this.ixc.listTickets(dto.customerId, dto.conversationId),
      this.ixc.listServiceOrders(dto.customerId, dto.conversationId),
    ]);
    const equivalent = findEquivalentOperationalRecords({
      action: dto.action,
      contractId: dto.contractId,
      subjectId,
      sourceTicketId: dto.sourceTicketId,
    }, tickets, serviceOrders);
    const duplicateCandidates = [
      ...equivalent.confirmedTickets.map((item) => ({ kind: 'ticket', id: item.id, protocol: item.protocol, status: item.status })),
      ...equivalent.confirmedServiceOrders.map((item) => ({ kind: 'service_order', id: item.id, protocol: item.protocol, status: item.status })),
    ];
    const possibleDuplicateCandidates = [
      ...equivalent.possibleTickets.map((item) => ({ kind: 'ticket', id: item.id, protocol: item.protocol, status: item.status })),
      ...equivalent.possibleServiceOrders.map((item) => ({ kind: 'service_order', id: item.id, protocol: item.protocol, status: item.status })),
    ];
    const occurrenceSource = dto.occurrenceId
      ? `omni:${dto.occurrenceId}`
      : dto.networkEventId
        ? `network:${dto.networkEventId}:${dto.customerId}:${dto.contractId}`
        : `fallback:${dto.conversationId}:${dto.customerId}:${dto.contractId}:${subjectId}:${dto.intent}`;
    const occurrenceKey = createHash('sha256').update(occurrenceSource).digest('hex');
    const deduplicationKey = createHash('sha256')
      .update([
        occurrenceKey, dto.action, subjectId, dto.sourceTicketId ?? '',
      ].join(':'))
      .digest('hex');
    const result = {
      mode: 'SIMULATION' as const,
      executionOwnership: EXECUTION_OWNERSHIP,
      action: dto.action,
      authorizedForSimulation: true,
      blockers: [],
      skill: { id: skill.id, key: skill.key, version: skill.version },
      ixcMapping: {
        key: resolvedMapping.key,
        version: resolvedMapping.version,
        status: resolvedMapping.status,
        subjectId,
      },
      externalReadPerformed: true,
      wouldCreate: duplicateCandidates.length === 0 && possibleDuplicateCandidates.length === 0,
      proposedState: duplicateCandidates.length > 0
        ? 'DUPLICATE_FOUND' as const
        : possibleDuplicateCandidates.length > 0
          ? 'REVIEW_REQUIRED' as const
          : 'READY_TO_TRIGGER' as const,
      requiresApproval: true,
      deduplicationKey,
      occurrence: {
        key: occurrenceKey,
        source: dto.occurrenceId
          ? 'OMNI_OCCURRENCE_ID' as const
          : dto.networkEventId
            ? 'NETWORK_EVENT_ID' as const
            : 'CONVERSATION_FALLBACK' as const,
        explicitIdRequiredBeforeRealExecution: !dto.occurrenceId && !dto.networkEventId,
      },
      duplicateCandidates,
      possibleDuplicateCandidates,
      duplicateStrategy: equivalent.strategy,
      externalWritePerformed: false,
    };
    await this.audit.log({
      action: 'operational-action.simulate', entity: 'Conversation', entityId: dto.conversationId,
      meta: {
        requestedAction: dto.action,
        wouldCreate: result.wouldCreate,
        duplicateCount: duplicateCandidates.length,
        possibleDuplicateCount: possibleDuplicateCandidates.length,
        duplicateStrategy: equivalent.strategy,
      },
    });
    return result;
  }

  async createProposal(dto: SimulateOperationalActionDto, requestedById: string) {
    const simulation = await this.simulate(dto);
    if (!simulation.authorizedForSimulation || !simulation.wouldCreate || !simulation.deduplicationKey) {
      return { simulation, proposal: null };
    }
    const orgId = this.tenancy.getOrgIdOrThrow();
    const proposal = await this.prisma.tenant.operationalActionRequest.upsert({
      where: {
        orgId_deduplicationKey: { orgId, deduplicationKey: simulation.deduplicationKey },
      },
      update: {},
      create: {
        orgId,
        conversationId: dto.conversationId,
        skillId: dto.skillId,
        requestedAction: dto.action,
        deduplicationKey: simulation.deduplicationKey,
        requestedById,
        requestPayload: {
          customerId: dto.customerId,
          contractId: dto.contractId,
          intent: dto.intent,
          mappingKey: dto.mappingKey,
          mappingVersion: simulation.ixcMapping.version,
          mappingStatus: simulation.ixcMapping.status,
          subjectId: simulation.ixcMapping.subjectId,
          sourceTicketId: dto.sourceTicketId ?? null,
          occurrenceId: dto.occurrenceId ?? null,
          occurrenceKey: simulation.occurrence.key,
          occurrenceSource: simulation.occurrence.source,
          duplicateStrategy: simulation.duplicateStrategy,
          networkEventId: dto.networkEventId ?? null,
          networkDiagnosis: dto.networkDiagnosis ?? null,
        },
      },
    });
    await this.audit.log({
      action: 'operational-action.proposal.create',
      entity: 'OperationalActionRequest',
      entityId: proposal.id,
      meta: { conversationId: dto.conversationId, requestedAction: dto.action },
    });
    return { simulation, proposal };
  }

  listProposals(status?: string) {
    const parsedStatus = status
      ? this.parseStatus(status)
      : undefined;
    return this.prisma.tenant.operationalActionRequest.findMany({
      where: parsedStatus ? { status: parsedStatus } : undefined,
      include: {
        skill: { select: { id: true, key: true, name: true, version: true } },
        conversation: { select: { id: true, protocol: true, caseSummary: true, departmentId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewProposal(id: string, dto: ReviewOperationalActionDto, reviewedById: string) {
    const proposal = await this.prisma.tenant.operationalActionRequest.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('Proposta operacional não encontrada');
    if (proposal.status !== OperationalActionRequestStatus.PENDING_REVIEW) {
      throw new BadRequestException('A proposta já foi revisada e não pode ser alterada');
    }
    if (proposal.requestedById === reviewedById) {
      throw new BadRequestException('Quem criou a proposta não pode revisar a própria solicitação');
    }
    const updated = await this.prisma.tenant.operationalActionRequest.update({
      where: { id },
      data: {
        status: dto.decision,
        reviewedById,
        reviewedAt: new Date(),
        reviewNote: dto.note?.trim() || null,
      },
    });
    await this.audit.log({
      action: dto.decision === 'APPROVED'
        ? 'operational-action.proposal.approve'
        : 'operational-action.proposal.reject',
      entity: 'OperationalActionRequest',
      entityId: id,
      meta: { noteProvided: Boolean(dto.note?.trim()) },
    });
    return updated;
  }

  private parseStatus(value: string): OperationalActionRequestStatus {
    if (!Object.values(OperationalActionRequestStatus).includes(value as OperationalActionRequestStatus)) {
      throw new BadRequestException('Status de proposta inválido');
    }
    return value as OperationalActionRequestStatus;
  }

  private stringSet(value: unknown): Set<string> {
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item): item is string => typeof item === 'string'));
  }
}
