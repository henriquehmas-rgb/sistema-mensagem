/**
 * Ações de alto impacto que nunca podem ser liberadas apenas pela decisão do
 * modelo ou por uma skill. A lista é uma barreira de ativação; os executores
 * externos continuam bloqueados separadamente.
 */
export const HUMAN_REVIEW_ACTIONS = new Set([
  'create_commercial_proposal',
  'grant_discount',
  'change_price',
  'change_commercial_terms',
  'approve_refund',
  'execute_refund',
  'approve_chargeback',
  'move_funds',
  'change_invoice',
  'change_due_date',
  'change_amount',
  'negotiate_terms',
  'write_off_debt',
  'cancel_contract',
  'complete_financial_adjustment',
  'change_bank_details',
  'change_pix_key',
]);

export function actionRequiresHumanReview(action: string): boolean {
  return HUMAN_REVIEW_ACTIONS.has(action);
}
