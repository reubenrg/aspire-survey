/**
 * Randomisation that is random ACROSS respondents but stable for one: the order
 * is derived from a per-session seed, so a re-render (typing in another field,
 * going back a page) never reshuffles the options under someone's cursor.
 */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small, well-distributed seeded generator. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new session seed. */
export function newSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}

/** Fisher-Yates over a copy, seeded by the session seed and a per-use key (e.g. the question id). */
export function seededShuffle<T>(items: readonly T[], seed: number, key: string): T[] {
  const out = items.slice();
  const rand = generator(hash(`${seed}:${key}`));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Shuffles options but leaves anchors where they belong: "Other", "None of the
 * above" and "Not applicable" stay last, as respondents expect.
 */
export function shuffleOptions(options: readonly string[], seed: number, key: string): string[] {
  const isAnchor = (o: string) => /^(other|none of the above|not applicable|n\/a|prefer not to say)\b/i.test(o.trim());
  const movable = options.filter(o => !isAnchor(o));
  const anchored = options.filter(isAnchor);
  return [...seededShuffle(movable, seed, key), ...anchored];
}
