export type LedgerEntryType = 'donation' | 'fee' | 'refund' | 'payout';

export interface LedgerEntry {
  /**
   * Unique within the ledger. Convention: donations use the donation id,
   * fees use `${donationId}:fee`, refunds use the refund id, payouts use the payout id.
   */
  id: string;
  churchId: string;
  type: LedgerEntryType;
  /**
   * Always positive, in cents. Direction comes from `type`:
   * donations credit the church; fees, refunds and payouts debit it.
   */
  amount: number;
  /** ISO timestamp. Defaults to the time of recording. */
  occurredAt?: string;
}

export type Mismatch =
  | { kind: 'missing'; id: string }
  | { kind: 'duplicate'; id: string; count: number }
  | { kind: 'amount-differs'; id: string; expected: number; actual: number };

export type LedgerErrorCode = 'DUPLICATE_ENTRY' | 'INVALID_AMOUNT';

export class LedgerError extends Error {
  constructor(
    public readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

const CREDIT_TYPES: ReadonlySet<LedgerEntryType> = new Set<LedgerEntryType>(['donation']);

/** The entry's effect on the church balance: positive for credits, negative for debits. */
export function signedAmount(entry: LedgerEntry): number {
  return CREDIT_TYPES.has(entry.type) ? entry.amount : -entry.amount;
}

export class Ledger {
  private readonly entries = new Map<string, LedgerEntry>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Appends an entry. Ids must be unique; amounts must be positive integers. */
  record(entry: LedgerEntry): LedgerEntry {
    if (this.entries.has(entry.id)) {
      throw new LedgerError('DUPLICATE_ENTRY', `ledger already has an entry with id ${entry.id}`);
    }
    if (!Number.isInteger(entry.amount) || entry.amount <= 0) {
      throw new LedgerError(
        'INVALID_AMOUNT',
        `ledger amounts must be positive integers, got ${String(entry.amount)}`,
      );
    }
    const stored: LedgerEntry = {
      ...entry,
      occurredAt: entry.occurredAt ?? this.now().toISOString(),
    };
    this.entries.set(stored.id, stored);
    return stored;
  }

  entriesFor(churchId: string): LedgerEntry[] {
    return this.all().filter((entry) => entry.churchId === churchId);
  }

  /** Funds available to pay out, in cents: donations minus fees, refunds and payouts. */
  balanceFor(churchId: string): number {
    return this.entriesFor(churchId).reduce((sum, entry) => sum + signedAmount(entry), 0);
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }
}

/**
 * Compares an authoritative export (for example the payment processor's settlement
 * report) against what we recorded. Entries are matched by id.
 *
 *   missing        – in the source, not in the ledger
 *   duplicate      – the same id appears more than once in the ledger
 *   amount-differs – same id on both sides, different amounts
 *
 * Ledger entries that the source does not mention are not reported.
 * Mismatches come back in source order, with duplicates last.
 */
export function reconcile(sourceEntries: LedgerEntry[], ledgerEntries: LedgerEntry[]): Mismatch[] {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, LedgerEntry>();
  for (const entry of ledgerEntries) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    if (!firstSeen.has(entry.id)) firstSeen.set(entry.id, entry);
  }

  const mismatches: Mismatch[] = [];
  for (const source of sourceEntries) {
    const ours = firstSeen.get(source.id);
    if (!ours) {
      mismatches.push({ kind: 'missing', id: source.id });
    } else if (ours.amount !== source.amount) {
      mismatches.push({
        kind: 'amount-differs',
        id: source.id,
        expected: source.amount,
        actual: ours.amount,
      });
    }
  }
  for (const [id, count] of counts) {
    if (count > 1) mismatches.push({ kind: 'duplicate', id, count });
  }
  return mismatches;
}
