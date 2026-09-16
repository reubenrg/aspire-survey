/**
 * Scoring a matrix/rating-grid row. Pulled out of SurveyAnalytics.tsx so it
 * can be unit tested directly - this is the one piece of arithmetic in
 * Sprint 4 that a mistake in would produce a wrong, confidently-displayed
 * number rather than an obviously broken page.
 */

/**
 * The scale's own position (1..N) is the numeric value - the standard way
 * to score an ordinal Likert scale - never the label text itself. Returns
 * null when nobody answered, so a caller can render "—" instead of 0/0.
 * Part 6: never fabricate an average for arbitrary textual choices - this
 * only works because engine matrix scales are already ordered lists, and
 * the average is explicitly labeled "position on the scale" wherever shown.
 */
export function averagePosition(counts: Record<string, number>, scale: string[]): number | null {
  let sum = 0;
  let n = 0;
  scale.forEach((s, i) => {
    const c = counts[s] ?? 0;
    sum += c * (i + 1);
    n += c;
  });
  return n > 0 ? sum / n : null;
}
