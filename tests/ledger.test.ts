import { describe, it, expect, beforeEach } from 'vitest';
import { Ledger } from '../src/ledger';
import { entry, GRACE, HILLSIDE } from './helpers';

describe('Ledger', () => {
  let ledger: Ledger;

  beforeEach(() => {
    ledger = new Ledger();
  });

  describe('record', () => {
    it('stores the entry and returns it', () => {
      const stored = ledger.record(entry({ id: 'don_1', amount: 2500 }));

      expect(stored).toMatchObject({ id: 'don_1', amount: 2500, churchId: GRACE, type: 'donation' });
      expect(ledger.all()).toHaveLength(1);
    });
  });

  describe('balanceFor', () => {
    it('is zero for a church with no entries', () => {
      expect(ledger.balanceFor(GRACE)).toBe(0);
    });

    it('adds donations and subtracts fees and refunds', () => {
      ledger.record(entry({ id: 'don_1', amount: 10_000 }));
      ledger.record(entry({ id: 'don_1:fee', type: 'fee', amount: 320 }));
      ledger.record(entry({ id: 'ref_1', type: 'refund', amount: 2_000 }));

      expect(ledger.balanceFor(GRACE)).toBe(7_680);
    });

    it('keeps churches separate', () => {
      ledger.record(entry({ id: 'don_1', amount: 10_000 }));
      ledger.record(entry({ id: 'don_2', amount: 500, churchId: HILLSIDE }));

      expect(ledger.balanceFor(GRACE)).toBe(10_000);
      expect(ledger.balanceFor(HILLSIDE)).toBe(500);
    });
  });
});
