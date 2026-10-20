import { describe, it, expect } from 'vitest';
import {
  createDonation,
  settleDonation,
  DonationError,
  SUPPORTED_CURRENCIES,
  type DonationErrorCode,
  type RecurringInterval,
} from '../../src/donations';
import { buildDonation, buildSettledDonation, fixedClock, GRACE } from '../../tests/helpers';

/** Returns the DonationError code thrown by fn, or undefined if it did not throw one. */
function codeOf(fn: () => unknown): DonationErrorCode | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof DonationError) return err.code;
    throw err;
  }
  return undefined;
}

describe('createDonation — validation', () => {
  it.each([0, -1, -2500])('rejects amount %d with INVALID_AMOUNT', (amount) => {
    expect(codeOf(() => buildDonation({ amount }))).toBe('INVALID_AMOUNT');
  });

  it.each([10.5, 0.1, NaN, Infinity])('rejects non-integer amount %s', (amount) => {
    expect(codeOf(() => buildDonation({ amount }))).toBe('INVALID_AMOUNT');
  });

  it('accepts the smallest valid amount, 1 cent', () => {
    expect(buildDonation({ amount: 1 }).amount).toBe(1);
  });

  it.each(['EUR', 'usd', 'US', '', 'USD '])('rejects unsupported currency %j', (currency) => {
    expect(codeOf(() => buildDonation({ currency }))).toBe('UNSUPPORTED_CURRENCY');
  });

  it.each(SUPPORTED_CURRENCIES)('accepts %s', (currency) => {
    expect(buildDonation({ currency }).currency).toBe(currency);
  });

  it.each([
    ['churchId', ''],
    ['churchId', '   '],
    ['donorId', ''],
  ])('rejects a blank %s with MISSING_FIELD', (field, value) => {
    expect(codeOf(() => buildDonation({ [field]: value }))).toBe('MISSING_FIELD');
  });

  it('rejects an unknown recurring interval', () => {
    const recurring = 'daily' as RecurringInterval;
    expect(codeOf(() => buildDonation({ recurring }))).toBe('INVALID_RECURRING');
  });

  it('treats recurring: undefined and recurring: null the same (one-time gift)', () => {
    expect(buildDonation({ recurring: undefined }).recurring).toBeNull();
    expect(buildDonation({ recurring: null }).recurring).toBeNull();
  });

  it('checks required fields before the amount, so the error points at the first problem', () => {
    expect(codeOf(() => buildDonation({ churchId: '', amount: -1 }))).toBe('MISSING_FIELD');
  });

  it('throws a DonationError with a human-readable message', () => {
    expect(() => buildDonation({ amount: -5 })).toThrowError(DonationError);
    expect(() => buildDonation({ amount: -5 })).toThrow(/positive integer/);
  });
});

describe('createDonation — deterministic deps', () => {
  it('uses the injected clock and id source', () => {
    const donation = createDonation(
      { amount: 100, currency: 'USD', churchId: GRACE, donorId: 'd' },
      { now: fixedClock, newId: () => 'don_fixed' },
    );
    expect(donation.id).toBe('don_fixed');
    expect(donation.createdAt).toBe('2026-10-19T12:00:00.000Z');
  });
});

describe('settleDonation', () => {
  it('moves a pending donation to settled and leaves other fields alone', () => {
    const pending = buildDonation();
    const settled = settleDonation(pending);
    expect(settled).toEqual({ ...pending, status: 'settled' });
  });

  it('does not mutate the original donation', () => {
    const pending = buildDonation();
    settleDonation(pending);
    expect(pending.status).toBe('pending');
  });

  it('is a no-op for an already settled donation', () => {
    const settled = buildSettledDonation();
    expect(settleDonation(settled)).toBe(settled);
  });

  it('does not reopen a refunded donation', () => {
    const refunded = { ...buildSettledDonation(), status: 'refunded' as const, refundedAmount: 2500 };
    expect(settleDonation(refunded).status).toBe('refunded');
  });
});
