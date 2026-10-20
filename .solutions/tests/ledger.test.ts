import { describe, it, expect, beforeEach } from 'vitest';
import { Ledger, LedgerError, reconcile, signedAmount, type LedgerEntry } from '../../src/ledger';
import { entry, fixedClock, GRACE, HILLSIDE } from '../../tests/helpers';

describe('Ledger.record — validation', () => {
  let ledger: Ledger;

  beforeEach(() => {
    ledger = new Ledger(fixedClock);
  });

  it('rejects a duplicate id and leaves the ledger unchanged', () => {
    ledger.record(entry({ id: 'don_1', amount: 100 }));

    expect(() => ledger.record(entry({ id: 'don_1', amount: 999 }))).toThrowError(LedgerError);
    expect(ledger.all()).toHaveLength(1);
    expect(ledger.all()[0].amount).toBe(100);
  });

  it.each([0, -5, 12.5, NaN])('rejects amount %s', (amount) => {
    expect(() => ledger.record(entry({ id: 'x', amount }))).toThrow(/positive integers/);
  });

  it('fills in occurredAt from the clock when omitted', () => {
    const stored = ledger.record({ id: 'don_1', churchId: GRACE, type: 'donation', amount: 100 });
    expect(stored.occurredAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('stores a copy, so mutating the input afterwards does not change the ledger', () => {
    const input = entry({ id: 'don_1', amount: 100 });
    ledger.record(input);
    input.amount = 5;
    expect(ledger.all()[0].amount).toBe(100);
  });
});

describe('Ledger.balanceFor — more cases', () => {
  it('subtracts payouts', () => {
    const ledger = new Ledger();
    ledger.record(entry({ id: 'don_1', amount: 10_000 }));
    ledger.record(entry({ id: 'pay_1', type: 'payout', amount: 9_000 }));
    expect(ledger.balanceFor(GRACE)).toBe(1_000);
  });

  it('can go negative when refunds exceed what is left', () => {
    const ledger = new Ledger();
    ledger.record(entry({ id: 'don_1', amount: 1_000 }));
    ledger.record(entry({ id: 'pay_1', type: 'payout', amount: 1_000 }));
    ledger.record(entry({ id: 'ref_1', type: 'refund', amount: 1_000 }));
    expect(ledger.balanceFor(GRACE)).toBe(-1_000);
  });

  it('signedAmount is positive only for donations', () => {
    expect(signedAmount(entry({ id: 'a', amount: 5 }))).toBe(5);
    expect(signedAmount(entry({ id: 'b', amount: 5, type: 'fee' }))).toBe(-5);
    expect(signedAmount(entry({ id: 'c', amount: 5, type: 'refund' }))).toBe(-5);
    expect(signedAmount(entry({ id: 'd', amount: 5, type: 'payout' }))).toBe(-5);
  });
});

describe('reconcile', () => {
  const source: LedgerEntry[] = [
    entry({ id: 'don_1', amount: 2500 }),
    entry({ id: 'don_1:fee', type: 'fee', amount: 103 }),
    entry({ id: 'don_2', amount: 500, churchId: HILLSIDE }),
  ];

  it('returns no mismatches when both sides agree', () => {
    expect(reconcile(source, [...source])).toEqual([]);
  });

  it('is order-independent', () => {
    expect(reconcile(source, [...source].reverse())).toEqual([]);
  });

  it('returns [] for two empty lists', () => {
    expect(reconcile([], [])).toEqual([]);
  });

  it('reports every source entry when the ledger is empty', () => {
    expect(reconcile(source, [])).toEqual([
      { kind: 'missing', id: 'don_1' },
      { kind: 'missing', id: 'don_1:fee' },
      { kind: 'missing', id: 'don_2' },
    ]);
  });

  it('reports a source entry the ledger never recorded', () => {
    const ledger = source.filter((e) => e.id !== 'don_2');
    expect(reconcile(source, ledger)).toEqual([{ kind: 'missing', id: 'don_2' }]);
  });

  it('reports an entry recorded twice as a duplicate with its count', () => {
    const ledger = [...source, entry({ id: 'don_1', amount: 2500 })];
    expect(reconcile(source, ledger)).toEqual([{ kind: 'duplicate', id: 'don_1', count: 2 }]);
  });

  it('counts triplicates correctly', () => {
    const ledger = [...source, entry({ id: 'don_1', amount: 2500 }), entry({ id: 'don_1', amount: 2500 })];
    expect(reconcile(source, ledger)).toEqual([{ kind: 'duplicate', id: 'don_1', count: 3 }]);
  });

  it('reports amount differences with expected = source and actual = ledger', () => {
    const ledger = source.map((e) => (e.id === 'don_1:fee' ? { ...e, amount: 102 } : e));
    expect(reconcile(source, ledger)).toEqual([
      { kind: 'amount-differs', id: 'don_1:fee', expected: 103, actual: 102 },
    ]);
  });

  it('reports several kinds at once, in source order with duplicates last', () => {
    const ledger = [
      entry({ id: 'don_1', amount: 2400 }), // differs
      entry({ id: 'don_2', amount: 500, churchId: HILLSIDE }),
      entry({ id: 'don_2', amount: 500, churchId: HILLSIDE }), // duplicate
      // don_1:fee missing
    ];
    expect(reconcile(source, ledger)).toEqual([
      { kind: 'amount-differs', id: 'don_1', expected: 2500, actual: 2400 },
      { kind: 'missing', id: 'don_1:fee' },
      { kind: 'duplicate', id: 'don_2', count: 2 },
    ]);
  });

  it('matches on id only — church or type differences are not reported (pin and ask)', () => {
    const ledger = source.map((e) => (e.id === 'don_2' ? { ...e, churchId: GRACE } : e));
    expect(reconcile(source, ledger)).toEqual([]);
  });

  it('does not report ledger entries the source never mentions (pin and ask)', () => {
    const ledger = [...source, entry({ id: 'don_999', amount: 1 })];
    expect(reconcile(source, ledger)).toEqual([]);
  });

  it('compares against the first copy when a duplicate has a different amount', () => {
    const ledger = [...source, entry({ id: 'don_1', amount: 1 })];
    expect(reconcile(source, ledger)).toEqual([{ kind: 'duplicate', id: 'don_1', count: 2 }]);
  });
});
