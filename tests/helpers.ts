import {
  createDonation,
  settleDonation,
  InMemoryDonationStore,
  type Donation,
  type DonationInput,
} from '../src/donations';
import type { LedgerEntry } from '../src/ledger';

export const GRACE = 'church_grace';
export const HILLSIDE = 'church_hillside';

/** A frozen clock so timestamps in assertions can be literal. */
export const fixedClock = () => new Date('2026-10-19T12:00:00.000Z');

let counter = 0;
/** Deterministic ids: id_001, id_002, ... Call resetIds() in beforeEach if you assert on them. */
export const sequentialId = () => `id_${String(++counter).padStart(3, '0')}`;
export function resetIds(): void {
  counter = 0;
}

/** A valid pending donation; override any field. */
export function buildDonation(overrides: Partial<DonationInput> = {}): Donation {
  return createDonation(
    { amount: 2500, currency: 'USD', churchId: GRACE, donorId: 'donor_erin', ...overrides },
    { now: fixedClock, newId: sequentialId },
  );
}

/** Same, but already settled so it can be refunded. */
export function buildSettledDonation(overrides: Partial<DonationInput> = {}): Donation {
  return settleDonation(buildDonation(overrides));
}

export function storeWith(...donations: Donation[]): InMemoryDonationStore {
  const store = new InMemoryDonationStore();
  for (const donation of donations) store.save(donation);
  return store;
}

/** A ledger entry for GRACE of type 'donation' unless overridden. */
export function entry(
  overrides: Partial<LedgerEntry> & Pick<LedgerEntry, 'id' | 'amount'>,
): LedgerEntry {
  return {
    churchId: GRACE,
    type: 'donation',
    occurredAt: fixedClock().toISOString(),
    ...overrides,
  };
}
