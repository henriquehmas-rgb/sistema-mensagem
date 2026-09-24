import { describe, expect, it } from 'vitest';
import { actionRequiresHumanReview } from './commercial-action-policy';

describe('commercial action policy', () => {
  it.each([
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
  ])('exige revisão humana para %s', (action) => {
    expect(actionRequiresHumanReview(action)).toBe(true);
  });

  it('não classifica consulta simples como alteração comercial', () => {
    expect(actionRequiresHumanReview('read_published_plan')).toBe(false);
  });
});
