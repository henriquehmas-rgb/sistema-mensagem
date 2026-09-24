import type { IxcOperationalEvidence } from '../integrations/ixc/ixc.types';
import { OMNI_OPERATIONAL_POLICY } from '../operational-policy/omni-operational-policy';

type ProposedAction = 'request_ticket' | 'request_service_order';

interface ShadowInput {
  allowedActions: string[];
  forbiddenActions: string[];
  minimumConfidence: number;
  triageConfidence: number;
  handoff: boolean;
  clarification: boolean;
  evidence: IxcOperationalEvidence | null;
  networkDiagnosis?: string | null;
}

export type ShadowActionEvaluation =
  | { eligible: true; action: ProposedAction; customerId: string; contractId: string; reason: null }
  | { eligible: false; action: ProposedAction | null; reason: string };

const SUPPORTED = new Set<ProposedAction>(OMNI_OPERATIONAL_POLICY.scope.allowedActions);
const CLOSED = new Set(['F', 'C', 'FINALIZADO', 'ENCERRADO', 'CANCELADO']);
const ACTIVE_CONTRACT = new Set(['A', 'ATIVO', 'ACTIVE']);

/** Avaliação determinística, sem persistência e sem chamadas externas. */
export function evaluateShadowAction(input: ShadowInput): ShadowActionEvaluation {
  const forbidden = new Set(input.forbiddenActions);
  const actions = input.allowedActions.filter(
    (value): value is ProposedAction => SUPPORTED.has(value as ProposedAction) && !forbidden.has(value),
  );
  if (actions.length !== 1) {
    return {
      eligible: false,
      action: null,
      reason: actions.length === 0 ? 'no_supported_action' : 'ambiguous_action',
    };
  }
  const action = actions[0]!;
  if (input.handoff) return { eligible: false, action, reason: 'handoff_required' };
  if (input.clarification) return { eligible: false, action, reason: 'clarification_in_progress' };
  if (input.networkDiagnosis === 'COLLECTIVE_OUTAGE_SUSPECTED'
    || input.networkDiagnosis === 'COLLECTIVE_OUTAGE_CONFIRMED') {
    return { eligible: false, action, reason: 'collective_outage_blocks_individual_action' };
  }
  if (input.networkDiagnosis === 'INCONCLUSIVE'
    || input.networkDiagnosis === 'IXC_FALSE_POSITIVE_SUSPECTED') {
    return { eligible: false, action, reason: 'network_context_not_actionable' };
  }
  if (action === 'request_service_order' && input.networkDiagnosis !== 'INDIVIDUAL_FAILURE') {
    return { eligible: false, action, reason: 'service_order_requires_confirmed_individual_failure' };
  }
  const requiredConfidence = Math.max(
    input.minimumConfidence,
    OMNI_OPERATIONAL_POLICY.safety.minimumConfidenceFloor,
  );
  if (input.triageConfidence < requiredConfidence) {
    return { eligible: false, action, reason: 'confidence_below_required_minimum' };
  }
  if (!input.evidence || !['success', 'empty'].includes(input.evidence.status)) {
    return { eligible: false, action, reason: 'operational_evidence_unavailable' };
  }
  if (!input.evidence.customerRef) {
    return { eligible: false, action, reason: 'customer_not_resolved' };
  }

  const activeContracts = input.evidence.facts.filter((fact) => (
    fact.resource === 'contracts'
    && ACTIVE_CONTRACT.has(String(fact.fields.status ?? '').toUpperCase())
  ));
  if (activeContracts.length !== 1) {
    return {
      eligible: false,
      action,
      reason: activeContracts.length === 0 ? 'active_contract_not_found' : 'active_contract_ambiguous',
    };
  }

  const duplicateResource = action === 'request_ticket' ? 'tickets' : 'service_orders';
  const hasOpenDuplicate = input.evidence.facts.some((fact) => (
    fact.resource === duplicateResource
    && !CLOSED.has(String(fact.fields.status ?? '').toUpperCase())
  ));
  if (hasOpenDuplicate) return { eligible: false, action, reason: 'open_duplicate_found' };

  return {
    eligible: true,
    action,
    customerId: input.evidence.customerRef,
    contractId: activeContracts[0]!.entityRef,
    reason: null,
  };
}
