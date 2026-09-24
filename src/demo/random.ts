// Deterministic helpers for the synthetic demo dataset.

export interface Rng {
  next(): number;
  between(min: number, max: number): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  normal(mu?: number, sigma?: number): number;
  logNormal(median: number, sigma: number): number;
}

/** mulberry32 — small, fast, seedable PRNG. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mu = 0, sigma = 1) => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return {
    next,
    between: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    normal,
    logNormal: (median, sigma) => median * Math.exp(normal(0, sigma)),
  };
}

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Muscat working hours are 08:00–16:00 (UTC+4), Sunday–Thursday. */
const WORK_START_UTC = 4;
const WORK_END_UTC = 12;

function isWeekendUtc(ts: number): boolean {
  const day = new Date(ts).getUTCDay();
  return day === 5 || day === 6;
}

/** Move a timestamp forward into the next Omani working window. */
export function snapToWork(ts: number, rng: Rng): number {
  const d = new Date(ts);
  const hour = d.getUTCHours();
  if (hour >= WORK_END_UTC) {
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(WORK_START_UTC, rng.int(0, 59), 0, 0);
  } else if (hour < WORK_START_UTC) {
    d.setUTCHours(WORK_START_UTC, rng.int(0, 59), 0, 0);
  }
  let out = d.getTime();
  while (isWeekendUtc(out)) out += DAY;
  return out;
}

export const iso = (ts: number) => new Date(ts).toISOString();
export const r3 = (v: number) => Math.round(v * 1000) / 1000;
