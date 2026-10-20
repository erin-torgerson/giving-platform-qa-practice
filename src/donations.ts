import { randomUUID } from 'node:crypto';

export const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'GBP'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const RECURRING_INTERVALS = ['weekly', 'monthly'] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export type DonationStatus = 'pending' | 'settled' | 'partially_refunded' | 'refunded';

export interface DonationInput {
  /** Amount in the smallest unit of the currency (cents). Must be a positive integer. */
  amount: number;
  /** ISO 4217 code, upper-case. See SUPPORTED_CURRENCIES. */
  currency: string;
  churchId: string;
  donorId: string;
  /** Omit or pass null for a one-time gift. */
  recurring?: RecurringInterval | null;
}

export interface Donation {
  id: string;
  amount: number;
  currency: Currency;
  churchId: string;
  donorId: string;
  recurring: RecurringInterval | null;
  status: DonationStatus;
  /** Total refunded so far, in cents. */
  refundedAmount: number;
  createdAt: string;
}

export type DonationErrorCode =
  | 'INVALID_AMOUNT'
  | 'UNSUPPORTED_CURRENCY'
  | 'MISSING_FIELD'
  | 'INVALID_RECURRING';

export class DonationError extends Error {
  constructor(
    public readonly code: DonationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DonationError';
  }
}

/** Injectable clock and id source so tests can be deterministic. */
export interface DonationDeps {
  now?: () => Date;
  newId?: () => string;
}

/**
 * Validates the input and returns a new donation in `pending` status.
 * Nothing is charged here; settlement happens when the payment processor confirms.
 */
export function createDonation(input: DonationInput, deps: DonationDeps = {}): Donation {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => `don_${randomUUID()}`);

  if (!isNonEmptyString(input.churchId)) {
    throw new DonationError('MISSING_FIELD', 'churchId is required');
  }
  if (!isNonEmptyString(input.donorId)) {
    throw new DonationError('MISSING_FIELD', 'donorId is required');
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new DonationError(
      'INVALID_AMOUNT',
      `amount must be a positive integer number of cents, got ${String(input.amount)}`,
    );
  }
  if (!isSupportedCurrency(input.currency)) {
    throw new DonationError(
      'UNSUPPORTED_CURRENCY',
      `currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}, got ${String(input.currency)}`,
    );
  }
  const recurring = input.recurring ?? null;
  if (recurring !== null && !isRecurringInterval(recurring)) {
    throw new DonationError(
      'INVALID_RECURRING',
      `recurring must be one of ${RECURRING_INTERVALS.join(', ')}, got ${String(recurring)}`,
    );
  }

  return {
    id: newId(),
    amount: input.amount,
    currency: input.currency,
    churchId: input.churchId,
    donorId: input.donorId,
    recurring,
    status: 'pending',
    refundedAmount: 0,
    createdAt: now().toISOString(),
  };
}

/**
 * Marks a pending donation as settled (the processor captured the funds).
 * Donations in any other status are returned unchanged.
 */
export function settleDonation(donation: Donation): Donation {
  if (donation.status !== 'pending') return donation;
  return { ...donation, status: 'settled' };
}

export interface DonationStore {
  get(id: string): Donation | undefined;
  save(donation: Donation): void;
  all(): Donation[];
}

export class InMemoryDonationStore implements DonationStore {
  private readonly byId = new Map<string, Donation>();

  get(id: string): Donation | undefined {
    return this.byId.get(id);
  }

  save(donation: Donation): void {
    this.byId.set(donation.id, donation);
  }

  all(): Donation[] {
    return [...this.byId.values()];
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSupportedCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

function isRecurringInterval(value: unknown): value is RecurringInterval {
  return typeof value === 'string' && (RECURRING_INTERVALS as readonly string[]).includes(value);
}
