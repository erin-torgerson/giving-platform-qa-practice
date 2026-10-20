import { describe, it, expect, beforeEach } from 'vitest';
import { RefundError, RefundService, type RefundErrorCode } from '../../src/refunds';
import type { Donation, InMemoryDonationStore } from '../../src/donations';
import { buildDonation, buildSettledDonation, fixedClock, resetIds, storeWith } from '../../tests/helpers';

function codeOf(fn: () => unknown): RefundErrorCode | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof RefundError) return err.code;
    throw err;
  }
  return undefined;
}

describe('RefundService.refund', () => {
  let donation: Donation;
  let store: InMemoryDonationStore;
  let refunds: RefundService;

  beforeEach(() => {
    resetIds();
    donation = buildSettledDonation({ amount: 1000 });
    store = storeWith(donation);
    refunds = new RefundService(store, { now: fixedClock, newId: () => 'ref_fixed' });
  });

  describe('partial refunds', () => {
    it('marks the donation partially_refunded and tracks the amount', () => {
      const refund = refunds.refund(donation.id, 300);

      expect(refund).toEqual({
        id: 'ref_fixed',
        donationId: donation.id,
        amount: 300,
        createdAt: '2026-10-19T12:00:00.000Z',
      });
      expect(store.get(donation.id)).toMatchObject({ status: 'partially_refunded', refundedAmount: 300 });
    });

    it('two partials that add up to the original fully refund it', () => {
      refunds.refund(donation.id, 400);
      refunds.refund(donation.id, 600);

      expect(store.get(donation.id)).toMatchObject({ status: 'refunded', refundedAmount: 1000 });
    });

    it('with no amount after a partial, refunds exactly the remainder', () => {
      refunds.refund(donation.id, 300);
      const rest = refunds.refund(donation.id);

      expect(rest.amount).toBe(700);
      expect(store.get(donation.id)).toMatchObject({ status: 'refunded', refundedAmount: 1000 });
    });
  });

  describe('over-refunds', () => {
    it('rejects a single refund larger than the original', () => {
      expect(codeOf(() => refunds.refund(donation.id, 1001))).toBe('EXCEEDS_REFUNDABLE');
    });

    // PLANTED BUG #2: fails until refunds.ts compares against `remaining`, not `donation.amount`.
    it('rejects partial refunds whose total would exceed the original', () => {
      refunds.refund(donation.id, 600);

      expect(codeOf(() => refunds.refund(donation.id, 600))).toBe('EXCEEDS_REFUNDABLE');
      expect(store.get(donation.id)).toMatchObject({ status: 'partially_refunded', refundedAmount: 600 });
    });

    it('allows refunding exactly the remainder', () => {
      refunds.refund(donation.id, 600);
      expect(() => refunds.refund(donation.id, 400)).not.toThrow();
      expect(store.get(donation.id)?.refundedAmount).toBe(1000);
    });
  });

  describe('double refunds', () => {
    it('rejects a second full refund', () => {
      refunds.refund(donation.id);
      expect(codeOf(() => refunds.refund(donation.id))).toBe('ALREADY_REFUNDED');
    });

    it('rejects any refund once partials have returned everything', () => {
      refunds.refund(donation.id, 500);
      refunds.refund(donation.id, 500);
      expect(codeOf(() => refunds.refund(donation.id, 1))).toBe('ALREADY_REFUNDED');
    });
  });

  describe('preconditions', () => {
    it('rejects refunds on a pending donation', () => {
      const pending = buildDonation({ amount: 1000 });
      store.save(pending);
      expect(codeOf(() => refunds.refund(pending.id))).toBe('NOT_SETTLED');
    });

    it('rejects an unknown donation id', () => {
      expect(codeOf(() => refunds.refund('don_nope'))).toBe('NOT_FOUND');
    });

    it.each([0, -100, 12.5, NaN])('rejects amount %s', (amount) => {
      expect(codeOf(() => refunds.refund(donation.id, amount))).toBe('INVALID_AMOUNT');
    });

    it('does not change the donation when the refund is rejected', () => {
      const before = store.get(donation.id);
      expect(() => refunds.refund(donation.id, 5000)).toThrow();
      expect(store.get(donation.id)).toEqual(before);
    });
  });
});
