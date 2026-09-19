/**
 * Net Promoter Score arithmetic, kept out of the components so it can be tested.
 * NPS = % promoters (9-10) minus % detractors (0-6); passives (7-8) count in the
 * total but in neither group. The result is a whole-number-ish figure from -100
 * to +100, not a percentage.
 */
export interface NpsResult {
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
  /** Rounded to one decimal, or null when there are no answers. */
  score: number | null;
}

export function npsFromDistribution(dist: { value: string; n: number }[]): NpsResult {
  let promoters = 0; let passives = 0; let detractors = 0;
  for (const { value, n } of dist) {
    const score = Number(value);
    if (!Number.isInteger(score) || score < 0 || score > 10) continue;
    if (score >= 9) promoters += n;
    else if (score >= 7) passives += n;
    else detractors += n;
  }
  const total = promoters + passives + detractors;
  return {
    promoters, passives, detractors, total,
    score: total === 0 ? null : Math.round(((promoters - detractors) / total) * 1000) / 10,
  };
}

/** Mean of a distribution whose values are numbers as text, e.g. a 1-5 rating. Ignores non-numeric values. */
export function meanFromDistribution(dist: { value: string; n: number }[]): number | null {
  let sum = 0; let count = 0;
  for (const { value, n } of dist) {
    const v = Number(value);
    if (!Number.isFinite(v)) continue;
    sum += v * n; count += n;
  }
  return count === 0 ? null : Math.round((sum / count) * 100) / 100;
}

/** Fills in zero-count steps so a 1..max rating always shows every step, in order. */
export function fillScale(dist: { value: string; n: number }[], from: number, to: number): { value: string; n: number }[] {
  const byValue = new Map(dist.map(d => [d.value, d.n]));
  const out: { value: string; n: number }[] = [];
  for (let v = from; v <= to; v++) out.push({ value: String(v), n: byValue.get(String(v)) ?? 0 });
  return out;
}
