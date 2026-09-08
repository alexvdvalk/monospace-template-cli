/**
 * Seeded pseudo-randomness. Seed data must be identical on every run, so the
 * generators never touch `Math.random()`, `Date.now()`, or `new Date()`.
 */

/** mulberry32 — small, fast, fully determined by its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Integer in [min, max]. */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    /** Uniform pick. */
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    /** Pick where earlier entries are more likely (weight n, n-1, … 1). */
    weighted: <T>(items: readonly T[]): T => {
      const total = (items.length * (items.length + 1)) / 2;
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= items.length - i;
        if (roll <= 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },
    /** True with probability `p`. */
    chance: (p: number) => next() < p,
  };
}

export type Rng = ReturnType<typeof rng>;

/** Fixed epoch all seeded timestamps are offset from: 2026-01-05T09:00:00Z. */
export const EPOCH_MS = 1767603600000;

/** ISO timestamp `days`/`hours` after the fixed epoch. */
export function stamp(days: number, hours = 0): string {
  return new Date(EPOCH_MS + days * 86400000 + hours * 3600000).toISOString();
}

/** Date-only string (`YYYY-MM-DD`) `days` after the fixed epoch. */
export function day(days: number): string {
  return stamp(days).slice(0, 10);
}
