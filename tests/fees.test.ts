import { describe, it, expect } from 'vitest';
import { calculateFee } from '../src/fees';

const STANDARD = { percent: 2.9, flat: 30 };

describe('calculateFee', () => {
  it('charges 2.9% + 30¢ on $100.00', () => {
    expect(calculateFee(10_000, STANDARD)).toEqual({ fee: 320, net: 9_680 });
  });

  it('charges 2.9% + 30¢ on $50.00', () => {
    expect(calculateFee(5_000, STANDARD)).toEqual({ fee: 175, net: 4_825 });
  });

  it('charges only the flat fee when the percentage is zero', () => {
    expect(calculateFee(1_000, { percent: 0, flat: 30 })).toEqual({ fee: 30, net: 970 });
  });
});
