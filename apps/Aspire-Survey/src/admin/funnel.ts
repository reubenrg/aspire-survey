/**
 * Turns the raw step counters into a drop-off funnel a person can read.
 * Step 0 = opened the survey, step k = reached the page at section index k-1,
 * and "submitted" is the response count itself (counted from the responses, not
 * from a counter, so it can never disagree with them).
 */
import type { SurveyDefinition } from '../engine/types.ts';

export interface FunnelRow {
  key: string;
  label: string;
  n: number;
  /** Share of everyone who opened the survey, 0-100 (one decimal). Null when nobody has. */
  pctOfOpened: number | null;
  /** How many fewer than the previous row. Null for the first row. */
  lostFromPrevious: number | null;
}

export function buildFunnel(
  def: SurveyDefinition,
  steps: { step: number; n: number }[],
  responses: number,
): FunnelRow[] {
  const at = new Map(steps.map(s => [s.step, s.n]));
  const opened = at.get(0) ?? 0;
  const raw: { key: string; label: string; n: number }[] = [{ key: 'opened', label: 'Opened the survey', n: opened }];
  def.sections.forEach((s, i) => raw.push({ key: s.id, label: s.title || `Page ${i + 1}`, n: at.get(i + 1) ?? 0 }));
  raw.push({ key: 'submitted', label: 'Submitted', n: responses });

  return raw.map((r, i) => ({
    ...r,
    pctOfOpened: opened > 0 ? Math.round((r.n / opened) * 1000) / 10 : null,
    // Skip logic means a later page can be reached by more people than an earlier page's
    // successor (people are routed past pages), so a negative "loss" is clamped to zero.
    lostFromPrevious: i === 0 ? null : Math.max(0, raw[i - 1].n - r.n),
  }));
}

/** The page where the most people stopped: the biggest drop between two consecutive rows, or null with too little data. */
export function biggestDrop(rows: FunnelRow[]): FunnelRow | null {
  if (rows.length < 2 || (rows[0].n ?? 0) < 5) return null;
  let worst: FunnelRow | null = null;
  for (const r of rows.slice(1)) {
    if (r.lostFromPrevious && r.lostFromPrevious > 0 && (!worst || r.lostFromPrevious > (worst.lostFromPrevious ?? 0))) worst = r;
  }
  return worst;
}
