import { round } from './stats';

export interface BenfordResult {
  sampleSize: number;
  digits: { digit: number; expected: number; observed: number; count: number }[];
  /** Mean absolute deviation between observed and expected first-digit proportions. */
  mad: number;
  conformity: 'close' | 'acceptable' | 'marginal' | 'nonconformity' | 'insufficient data';
}

export const BENFORD_EXPECTED = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));

export function firstDigit(value: number): number | null {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs < 1) return null;
  return Number(String(Math.floor(abs))[0]);
}

/**
 * First-digit Benford test. Conformity thresholds for MAD follow Nigrini (2012):
 * < 0.006 close, < 0.012 acceptable, < 0.015 marginal, otherwise nonconformity.
 */
export function benfordTest(values: number[]): BenfordResult {
  const counts = new Array(9).fill(0);
  let n = 0;
  for (const v of values) {
    const d = firstDigit(v);
    if (d) { counts[d - 1]++; n++; }
  }
  const digits = counts.map((count, i) => ({
    digit: i + 1,
    expected: round(BENFORD_EXPECTED[i], 4),
    observed: round(n ? count / n : 0, 4),
    count,
  }));
  const mad = n ? digits.reduce((acc, d) => acc + Math.abs(d.observed - d.expected), 0) / 9 : 0;
  let conformity: BenfordResult['conformity'] = 'insufficient data';
  if (n >= 100) {
    conformity = mad < 0.006 ? 'close' : mad < 0.012 ? 'acceptable' : mad < 0.015 ? 'marginal' : 'nonconformity';
  }
  return { sampleSize: n, digits, mad: round(mad, 4), conformity };
}
