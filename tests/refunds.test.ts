import { describe, it, expect, beforeEach } from 'vitest';
import { RefundService } from '../src/refunds';
import { buildSettledDonation, fixedClock, resetIds, storeWith } from './helpers';

describe('RefundService', () => {
  beforeEach(() => {
    resetIds();
  });

  it('refunds a settled donation in full when no amount is given', () => {
    const donation = buildSettledDonation({ amount: 2500 });
    const store = storeWith(donation);
    const refunds = new RefundService(store, { now: fixedClock });

    const refund = refunds.refund(donation.id);

    expect(refund).toMatchObject({ donationId: donation.id, amount: 2500 });
    expect(store.get(donation.id)).toMatchObject({ status: 'refunded', refundedAmount: 2500 });
  });
});
