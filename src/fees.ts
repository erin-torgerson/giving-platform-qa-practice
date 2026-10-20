export interface FeeSchedule {
  /** Percentage of the amount, e.g. 2.9 for 2.9%. */
  percent: number;
  /** Fixed fee in cents added on top of the percentage, e.g. 30. */
  flat: number;
}

export interface FeeBreakdown {
  /** Total fee in cents: the rounded percentage portion plus the flat portion. */
  fee: number;
  /** What the church receives: `amount - fee`. */
  net: number;
}

/**
 * Calculates the processing fee for a donation amount given in cents.
 *
 * Policy: the percentage portion is rounded half-up to the nearest cent, then the
 * flat portion is added, so `fee + net === amount` always holds.
 *
 *   $100.00 at 2.9% + 30¢ → 290 + 30 = 320, net 9680
 */
export function calculateFee(amount: number, schedule: FeeSchedule): FeeBreakdown {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`amount must be a non-negative integer number of cents, got ${String(amount)}`);
  }
  if (schedule.percent < 0 || schedule.flat < 0) {
    throw new RangeError('fee schedule values must be non-negative');
  }

  const rate = schedule.percent / 100;
  const percentFee = Math.round(amount * rate);
  const fee = percentFee + schedule.flat;

  return { fee, net: amount - fee };
}
