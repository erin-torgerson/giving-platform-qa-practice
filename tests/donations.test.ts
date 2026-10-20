import { describe, it, expect } from 'vitest';
import { createDonation } from '../src/donations';
import { buildDonation, GRACE } from './helpers';

describe('createDonation', () => {
  it('returns a pending donation carrying the fields we passed in', () => {
    const donation = createDonation({
      amount: 2500,
      currency: 'USD',
      churchId: GRACE,
      donorId: 'donor_erin',
    });

    expect(donation).toMatchObject({
      amount: 2500,
      currency: 'USD',
      churchId: GRACE,
      donorId: 'donor_erin',
      status: 'pending',
      refundedAmount: 0,
      recurring: null,
    });
    expect(donation.id).toMatch(/^don_/);
    expect(new Date(donation.createdAt).getTime()).not.toBeNaN();
  });

  it('stores the recurring interval when one is given', () => {
    const donation = buildDonation({ recurring: 'monthly' });

    expect(donation.recurring).toBe('monthly');
  });

  it('gives every donation its own id', () => {
    const first = buildDonation();
    const second = buildDonation();

    expect(first.id).not.toBe(second.id);
  });
});
