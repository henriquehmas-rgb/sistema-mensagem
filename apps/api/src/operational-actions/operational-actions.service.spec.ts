import { describe, expect, it, vi } from 'vitest';
import { OperationalActionsService } from './operational-actions.service';

const request = {
  action: 'request_ticket' as const,
  skillId: 'skill_1',
  conversationId: 'conv_1',
  customerId: 'customer_1',
  contractId: 'contract_1',
  intent: 'sem conexão',
  mappingKey: 'support.connectivity.ticket',
};

function harness() {
  const prisma = { tenant: {
    conversation: { findUnique: vi.fn().mockResolvedValue({
      id: 'conv_1', departmentId: 'department_support', triageConfidence: 0.95,
      identityVerifiedAt: new Date(),
      department: { routingKey: 'technical_support' },
    }) },
    operationalSkill: { findUnique: vi.fn().mockResolvedValue({
      id: 'skill_1', key: 'support-ticket', version: 1, status: 'ACTIVE',
      departmentId: 'department_support', validUntil: null, minimumConfidence: 0.8,
      allowedActions: ['request_ticket'], forbiddenActions: [],
    }) },
    operationalActionRequest: {
      upsert: vi.fn().mockResolvedValue({
        id: 'proposal_1', status: 'PENDING_REVIEW', requestedById: 'user_requester',
      }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'proposal_1', status: 'PENDING_REVIEW', requestedById: 'user_requester',
      }),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'proposal_1', ...data })),
    },
  } };
  const ixc = {
    collectOperationalEvidence: vi.fn().mockResolvedValue({
      source: 'IXC', status: 'success', customerRef: 'customer_1', observedAt: '2026-09-09T12:00:00Z',
      facts: [{ resource: 'contracts', entityRef: 'contract_1', fields: { status: 'A' } }],
    }),
    listTickets: vi.fn().mockResolvedValue([]),
    listServiceOrders: vi.fn().mockResolvedValue([]),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue('org_1') };
  return {
    service: new OperationalActionsService(prisma as never, tenancy as never, ixc as never, audit as never),
    prisma, tenancy, ixc, audit,
  };
}

describe('OperationalActionsService', () => {
  it('publica matriz de homologação imutável e sem escrita externa', () => {
    const plan = harness().service.homologationPlan();
    expect(plan).toMatchObject({
      mode: 'SHADOW', externalWriteEnabled: false,
      requiredModeForFirstRealTest: 'REVIEW_REQUIRED',
      policy: {
        version: '1.2.0',
        ownership: { operationalExecutor: 'IXC_DIRECT', olhoDeDeusAccess: 'READ_ONLY' },
        safety: { minimumConfidenceFloor: 0.85 },
      },
    });
    expect(plan.scenarios).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'support-individual-failure', expectedState: 'READY_TO_TRIGGER' }),
      expect.objectContaining({ id: 'existing-service-order', expectedState: 'DUPLICATE_FOUND' }),
      expect.objectContaining({ id: 'similar-ticket', expectedState: 'REVIEW_REQUIRED' }),
      expect.objectContaining({ id: 'collective-outage', expectedState: 'BLOCKED' }),
      expect.objectContaining({ id: 'trigger-timeout', expectedState: 'UNCERTAIN' }),
      expect.objectContaining({ id: 'unknown-mapping', expectedState: 'BLOCKED' }),
    ]));
    expect(plan.scenarios.every((scenario) => scenario.externalWriteExpected === false)).toBe(true);
  });

  it('simula sem executar escrita externa e produz uma chave determinística', async () => {
    const h = harness();
    const first = await h.service.simulate(request);
    const second = await h.service.simulate(request);

    expect(first).toMatchObject({
      mode: 'SIMULATION', wouldCreate: true, requiresApproval: true,
      authorizedForSimulation: true, externalReadPerformed: true,
      externalWritePerformed: false, duplicateCandidates: [], blockers: [],
      ixcMapping: {
        key: 'support.connectivity.ticket', status: 'DRAFT', subjectId: '60',
      },
    });
    expect(first.deduplicationKey).toBe(second.deduplicationKey);
    expect(first).toMatchObject({
      occurrence: { source: 'CONVERSATION_FALLBACK', explicitIdRequiredBeforeRealExecution: true },
    });
    expect(h.ixc.listTickets).toHaveBeenCalledWith('customer_1', 'conv_1');
    expect(h.ixc.collectOperationalEvidence).toHaveBeenCalledWith('org_1', 'conv_1', ['contracts']);
    expect(h.audit.log).toHaveBeenCalled();
  });

  it('bloqueia antes da checagem de duplicidade se a identidade não corresponde ao cliente informado', async () => {
    const h = harness();
    h.ixc.collectOperationalEvidence.mockResolvedValue({
      source: 'IXC', status: 'success', customerRef: 'customer_other', observedAt: '2026-09-09T12:00:00Z',
      facts: [{ resource: 'contracts', entityRef: 'contract_1', fields: { status: 'A' } }],
    });

    const result = await h.service.simulate(request);

    expect(result).toMatchObject({
      proposedState: 'BLOCKED', authorizedForSimulation: false,
      externalReadPerformed: true, externalWritePerformed: false,
      blockers: ['identity_customer_mismatch'],
    });
    expect(h.ixc.listTickets).not.toHaveBeenCalled();
    expect(h.ixc.listServiceOrders).not.toHaveBeenCalled();
  });

  it('bloqueia contrato que não pertence ao cadastro confirmado', async () => {
    const h = harness();
    h.ixc.collectOperationalEvidence.mockResolvedValue({
      source: 'IXC', status: 'success', customerRef: 'customer_1', observedAt: '2026-09-09T12:00:00Z',
      facts: [{ resource: 'contracts', entityRef: 'contract_other', fields: { status: 'A' } }],
    });

    const result = await h.service.simulate(request);

    expect(result).toMatchObject({ blockers: ['identity_contract_mismatch'] });
    expect(h.ixc.listTickets).not.toHaveBeenCalled();
  });

  it('bloqueia contrato inativo mesmo quando ele pertence ao cliente confirmado', async () => {
    const h = harness();
    h.ixc.collectOperationalEvidence.mockResolvedValue({
      source: 'IXC', status: 'success', customerRef: 'customer_1', observedAt: '2026-09-09T12:00:00Z',
      facts: [{ resource: 'contracts', entityRef: 'contract_1', fields: { status: 'C' } }],
    });

    const result = await h.service.simulate(request);

    expect(result).toMatchObject({ blockers: ['identity_contract_inactive'] });
    expect(h.ixc.listTickets).not.toHaveBeenCalled();
  });

  it('recusa assunto externo ao catálogo controlado antes de consultar o IXC', async () => {
    const h = harness();
    await expect(h.service.simulate({
      ...request, mappingKey: 'support.arbitrary.external.subject',
    })).rejects.toThrow('IXC_MAPPING_NOT_FOUND');
    expect(h.ixc.listTickets).not.toHaveBeenCalled();
    expect(h.ixc.listServiceOrders).not.toHaveBeenCalled();
  });

  it('separa duas ocorrências do mesmo assunto e mantém idempotência dentro de cada uma', async () => {
    const h = harness();
    const first = await h.service.simulate({ ...request, occurrenceId: 'occurrence-0001' });
    const retry = await h.service.simulate({ ...request, occurrenceId: 'occurrence-0001' });
    const recurrence = await h.service.simulate({ ...request, occurrenceId: 'occurrence-0002' });
    expect(first.deduplicationKey).toBe(retry.deduplicationKey);
    expect(first.deduplicationKey).not.toBe(recurrence.deduplicationKey);
    expect(first).toMatchObject({
      occurrence: { source: 'OMNI_OCCURRENCE_ID', explicitIdRequiredBeforeRealExecution: false },
    });
  });

  it('bloqueia antes de consultar o IXC quando identidade ou política falham', async () => {
    const h = harness();
    h.prisma.tenant.conversation.findUnique.mockResolvedValue({
      id: 'conv_1', departmentId: 'department_support', triageConfidence: 0.4,
      identityVerifiedAt: null,
      department: { routingKey: 'technical_support' },
    });
    h.prisma.tenant.operationalSkill.findUnique.mockResolvedValue({
      id: 'skill_1', key: 'support-order', version: 1, status: 'ACTIVE',
      departmentId: 'department_support', validUntil: null, minimumConfidence: 0.8,
      allowedActions: ['request_service_order'], forbiddenActions: ['request_ticket'],
    });

    const result = await h.service.simulate(request);
    expect(result).toMatchObject({
      authorizedForSimulation: false,
      externalReadPerformed: false,
      externalWritePerformed: false,
      requiresApproval: true,
    });
    expect(result.blockers).toEqual(expect.arrayContaining([
      'action_not_allowed', 'action_explicitly_forbidden',
      'identity_not_verified', 'confidence_below_required_minimum',
    ]));
    expect(h.ixc.listTickets).not.toHaveBeenCalled();
    expect(h.ixc.listServiceOrders).not.toHaveBeenCalled();
  });

  it('cria proposta idempotente somente depois da simulação autorizada', async () => {
    const h = harness();
    const result = await h.service.createProposal(request, 'user_requester');

    expect(result.simulation.authorizedForSimulation).toBe(true);
    expect(result.proposal).toMatchObject({ id: 'proposal_1', status: 'PENDING_REVIEW' });
    expect(h.prisma.tenant.operationalActionRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_deduplicationKey: expect.objectContaining({ orgId: 'org_1' }) },
      }),
    );
  });

  it('impede que o solicitante aprove a própria proposta', async () => {
    const h = harness();
    await expect(h.service.reviewProposal(
      'proposal_1', { decision: 'APPROVED' }, 'user_requester',
    )).rejects.toThrow('não pode revisar');
    expect(h.prisma.tenant.operationalActionRequest.update).not.toHaveBeenCalled();
  });

  it('permite que outro responsável rejeite a proposta e registra a revisão', async () => {
    const h = harness();
    const result = await h.service.reviewProposal(
      'proposal_1', { decision: 'REJECTED', note: 'Necessário diagnóstico adicional' }, 'user_reviewer',
    );
    expect(result).toMatchObject({ id: 'proposal_1', status: 'REJECTED', reviewedById: 'user_reviewer' });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'operational-action.proposal.reject',
    }));
  });

  it('envia registros abertos sem vínculo suficiente para revisão', async () => {
    const h = harness();
    h.ixc.listTickets.mockResolvedValue([
      { id: 'ticket_1', protocol: 'T-1', status: 'A' },
      { id: 'ticket_2', protocol: 'T-2', status: 'FINALIZADO' },
    ]);
    h.ixc.listServiceOrders.mockResolvedValue([
      { id: 'os_1', protocol: 'OS-1', status: 'ABERTA' },
      { id: 'os_2', protocol: 'OS-2', status: 'C' },
    ]);

    const result = await h.service.simulate(request);
    expect(result.wouldCreate).toBe(false);
    expect(result.proposedState).toBe('REVIEW_REQUIRED');
    expect(result.duplicateCandidates).toEqual([]);
    expect('possibleDuplicateCandidates' in result).toBe(true);
    if (!('possibleDuplicateCandidates' in result)) throw new Error('resultado operacional inesperado');
    expect(result.possibleDuplicateCandidates).toEqual([
      { kind: 'ticket', id: 'ticket_1', protocol: 'T-1', status: 'A' },
      { kind: 'service_order', id: 'os_1', protocol: 'OS-1', status: 'ABERTA' },
    ]);
    expect(result.externalWritePerformed).toBe(false);
  });

  it('não trata registro aberto de outro assunto e contrato como duplicidade', async () => {
    const h = harness();
    h.ixc.listTickets.mockResolvedValue([{
      id: 'ticket_other', protocol: 'T-OTHER', status: 'T',
      contractId: 'contract_other', subjectId: 'subject_other',
    }]);
    h.ixc.listServiceOrders.mockResolvedValue([{
      id: 'os_other', protocol: 'OS-OTHER', status: 'A', ticketId: 'ticket_other',
      subjectId: 'subject_other',
    }]);
    const result = await h.service.simulate(request);
    expect(result).toMatchObject({
      proposedState: 'READY_TO_TRIGGER', wouldCreate: true,
      duplicateStrategy: 'OCCURRENCE_AWARE', duplicateCandidates: [],
      possibleDuplicateCandidates: [],
    });
  });

  it('confirma duplicidade de OS somente pelo mesmo chamado de origem', async () => {
    const h = harness();
    h.prisma.tenant.operationalSkill.findUnique.mockResolvedValue({
      id: 'skill_1', key: 'support-order', version: 1, status: 'ACTIVE',
      departmentId: 'department_support', validUntil: null, minimumConfidence: 0.8,
      allowedActions: ['request_service_order'], forbiddenActions: [],
    });
    h.ixc.listTickets.mockResolvedValue([{
      id: 'ticket_1', protocol: 'T-1', status: 'T',
      contractId: 'contract_1', subjectId: '25',
    }]);
    h.ixc.listServiceOrders.mockResolvedValue([{
      id: 'os_1', protocol: 'OS-1', status: 'A', ticketId: 'ticket_1', subjectId: '25',
    }]);
    const result = await h.service.simulate({
      ...request, action: 'request_service_order', mappingKey: 'support.fiber_los.service_order',
      sourceTicketId: 'ticket_1',
      networkDiagnosis: 'INDIVIDUAL_FAILURE',
    });
    expect(result).toMatchObject({
      proposedState: 'DUPLICATE_FOUND', wouldCreate: false,
      duplicateCandidates: [{ kind: 'service_order', id: 'os_1' }],
      possibleDuplicateCandidates: [],
    });
  });

  it('restringe chamado e OS ao departamento de suporte', async () => {
    const h = harness();
    h.prisma.tenant.conversation.findUnique.mockResolvedValue({
      id: 'conv_1', departmentId: 'department_financial', triageConfidence: 0.95,
      identityVerifiedAt: new Date(), department: { routingKey: 'financial' },
    });
    const result = await h.service.simulate(request);
    expect(result).toMatchObject({
      proposedState: 'BLOCKED', authorizedForSimulation: false,
      externalReadPerformed: false, externalWritePerformed: false,
    });
    expect(result.blockers).toContain('support_department_required');
  });

  it('bloqueia ação individual durante rompimento coletivo', async () => {
    const h = harness();
    const result = await h.service.simulate({
      ...request, networkDiagnosis: 'COLLECTIVE_OUTAGE_CONFIRMED',
    });
    expect(result.proposedState).toBe('BLOCKED');
    expect(result.blockers).toContain('collective_outage_blocks_individual_action');
    expect(h.ixc.listTickets).not.toHaveBeenCalled();
  });

  it('só permite propor OS com falha individual confirmada e sem duplicidade', async () => {
    const h = harness();
    h.prisma.tenant.operationalSkill.findUnique.mockResolvedValue({
      id: 'skill_1', key: 'support-order', version: 1, status: 'ACTIVE',
      departmentId: 'department_support', validUntil: null, minimumConfidence: 0.8,
      allowedActions: ['request_service_order'], forbiddenActions: [],
    });
    const withoutDiagnosis = await h.service.simulate({
      ...request, action: 'request_service_order', mappingKey: 'support.fiber_los.service_order',
    });
    expect(withoutDiagnosis.blockers).toContain('service_order_requires_confirmed_individual_failure');

    const confirmed = await h.service.simulate({
      ...request, action: 'request_service_order', mappingKey: 'support.fiber_los.service_order',
      networkDiagnosis: 'INDIVIDUAL_FAILURE',
    });
    expect(confirmed).toMatchObject({
      proposedState: 'READY_TO_TRIGGER', wouldCreate: true,
      authorizedForSimulation: true, externalWritePerformed: false,
    });
  });
});
