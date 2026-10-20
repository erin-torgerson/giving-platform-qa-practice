import { describe, it, expect } from 'vitest';
import { calculateFee } from '../../src/fees';

const STANDARD = { percent: 2.9, flat: 30 };

describe('calculateFee — rounding', () => {
  // PLANTED BUG #1: fails until fees.ts multiplies before dividing.
  it('rounds half-up: $5.00 at 2.9% is exactly 14.5¢ → 15¢ (+30¢ = 45¢)', () => {
    expect(calculateFee(500, STANDARD)).toEqual({ fee: 45, net: 455 });
  });

  // Every amount under $200 where the float version drifts below .5
  it.each([500, 7_500, 8_500, 14_500, 15_500, 16_500, 17_500])(
    '%d¢ lands on an exact half cent and rounds up',
    (amount) => {
      const exactHalf = (amount * 29) % 1000 === 500;
      expect(exactHalf).toBe(true);
      const expectedPercentPart = Math.round((amount * 29) / 1000);
      expect(calculateFee(amount, STANDARD).fee).toBe(expectedPercentPart + 30);
    },
  );

  it.each([
    [250, 7, 37], // 7.25 → 7
    [750, 22, 52], // 21.75 → 22
    [1234, 36, 66], // 35.786 → 36
    [99, 3, 33], // 2.871 → 3
    [1, 0, 30], // 0.029 → 0
  ])('%d¢ → percent part %d¢, total fee %d¢', (amount, percentPart, fee) => {
    expect(calculateFee(amount, STANDARD).fee - 30).toBe(percentPart);
    expect(calculateFee(amount, STANDARD)).toEqual({ fee, net: amount - fee });
  });

  it('fee + net equals amount for every cent value up to $100', () => {
    for (let amount = 0; amount <= 10_000; amount++) {
      const { fee, net } = calculateFee(amount, STANDARD);
      expect(fee + net).toBe(amount);
      expect(Number.isInteger(fee)).toBe(true);
    }
  });

  it('never charges less than the flat fee', () => {
    expect(calculateFee(0, STANDARD).fee).toBe(30);
    expect(calculateFee(1, STANDARD).fee).toBe(30);
  });

  it('net goes negative below the flat fee — a policy question worth raising', () => {
    expect(calculateFee(10, STANDARD)).toEqual({ fee: 30, net: -20 });
  });
});

describe('calculateFee — schedules', () => {
  it('handles a percent-only schedule', () => {
    expect(calculateFee(12_345, { percent: 1, flat: 0 })).toEqual({ fee: 123, net: 12_222 });
  });

  it('handles a zero schedule', () => {
    expect(calculateFee(12_345, { percent: 0, flat: 0 })).toEqual({ fee: 0, net: 12_345 });
  });

  it('handles 100%', () => {
    expect(calculateFee(999, { percent: 100, flat: 0 })).toEqual({ fee: 999, net: 0 });
  });

  it('rejects negative schedule values', () => {
    expect(() => calculateFee(100, { percent: -1, flat: 0 })).toThrow(RangeError);
    expect(() => calculateFee(100, { percent: 0, flat: -1 })).toThrow(RangeError);
  });
});

describe('calculateFee — invalid amounts', () => {
  it.each([-1, 10.5, NaN, Infinity])('rejects %s', (amount) => {
    expect(() => calculateFee(amount, STANDARD)).toThrow(RangeError);
  });
});
