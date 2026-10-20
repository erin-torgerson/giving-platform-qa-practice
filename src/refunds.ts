import { randomUUID } from 'node:crypto';
import type { Donation, DonationStore } from './donations';

export interface Refund {
  id: string;
  donationId: string;
  /** Cents returned to the donor by this refund. */
  amount: number;
  createdAt: string;
}

export type RefundErrorCode =
  | 'NOT_FOUND'
  | 'NOT_SETTLED'
  | 'ALREADY_REFUNDED'
  | 'EXCEEDS_REFUNDABLE'
  | 'INVALID_AMOUNT';

export class RefundError extends Error {
  constructor(
    public readonly code: RefundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RefundError';
  }
}

export interface RefundDeps {
  now?: () => Date;
  newId?: () => string;
}

/**
 * Issues refunds against settled donations.
 *
 * - Omit `amount` to refund everything still refundable (a full refund).
 * - Partial refunds can be repeated until the original amount has been returned.
 * - In total a donation can never be refunded for more than its original amount.
 * - Processing fees are not returned; the ledger side of that lives in the API layer.
 */
export class RefundService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly donations: DonationStore,
    deps: RefundDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => `ref_${randomUUID()}`);
  }

  refund(donationId: string, amount?: number): Refund {
    const donation = this.donations.get(donationId);
    if (!donation) {
      throw new RefundError('NOT_FOUND', `donation ${donationId} not found`);
    }
    if (donation.status === 'pending') {
      throw new RefundError('NOT_SETTLED', `donation ${donationId} has not settled yet`);
    }
    if (donation.status === 'refunded') {
      throw new RefundError('ALREADY_REFUNDED', `donation ${donationId} was already refunded in full`);
    }

    const remaining = donation.amount - donation.refundedAmount;
    const refundAmount = amount ?? remaining;

    if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
      throw new RefundError(
        'INVALID_AMOUNT',
        `refund amount must be a positive integer number of cents, got ${String(refundAmount)}`,
      );
    }
    if (refundAmount > donation.amount) {
      throw new RefundError(
        'EXCEEDS_REFUNDABLE',
        `cannot refund ${refundAmount}; only ${remaining} is still refundable`,
      );
    }

    const refundedAmount = donation.refundedAmount + refundAmount;
    const updated: Donation = {
      ...donation,
      refundedAmount,
      status: refundedAmount >= donation.amount ? 'refunded' : 'partially_refunded',
    };
    this.donations.save(updated);

    return {
      id: this.newId(),
      donationId,
      amount: refundAmount,
      createdAt: this.now().toISOString(),
    };
  }
}
