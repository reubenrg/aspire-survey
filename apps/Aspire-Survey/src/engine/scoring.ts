/**
 * Quiz-style scoring. Authors give points to answer choices (or a per-unit weight to a
 * numeric answer); the respondent's score is the sum over the questions they actually
 * saw and answered. Optional result bands turn the total into a label and a message.
 *
 * The score is computed in the respondent's browser and stored in the `quiz_score`
 * column, so it is a convenience for the respondent and for reporting, NOT a
 * tamper-proof result: a determined respondent could submit a different number. Do not
 * use it for anything that must be trusted (certification, pass/fail with consequences)
 * without re-scoring from the stored answers.
 */
import type { Answers, Question, ScoreBand, SurveyDefinition } from './types.ts';
import { flatQuestions, isVisibleIn, sectionPath } from './definition.ts';

export const SCORE_FIELD = 'quiz_score';

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Points earned by one answer. */
export function questionScore(q: Question, value: unknown): number {
  switch (q.type) {
    case 'radio': case 'select':
      return typeof value === 'string' ? num(q.optionScores?.[value]) : 0;
    case 'checkbox':
      return Array.isArray(value) ? value.reduce((sum, v) => sum + num(q.optionScores?.[v as string]), 0) : 0;
    case 'image':
      if (Array.isArray(value)) return value.reduce((sum, v) => sum + num(q.optionScores?.[v as string]), 0);
      return typeof value === 'string' ? num(q.optionScores?.[value]) : 0;
    case 'yesno':
      return value === 'Yes' || value === 'No' ? num(q.optionScores?.[value]) : 0;
    case 'rating': case 'nps': case 'slider': case 'number':
      return typeof value === 'string' && value !== '' ? num(value) * num(q.scoreWeight) : 0;
    default:
      return 0;
  }
}

/** The most points a question can award. */
export function questionMax(q: Question): number {
  const positives = (scores?: Record<string, number>, options?: string[]) =>
    (options ?? Object.keys(scores ?? {})).map(o => num(scores?.[o]));
  switch (q.type) {
    case 'radio': case 'select':
      return Math.max(0, ...positives(q.optionScores, q.options));
    case 'checkbox':
      return positives(q.optionScores, q.options).filter(n => n > 0).reduce((a, b) => a + b, 0);
    case 'image':
      return q.multiple
        ? positives(q.optionScores, q.options).filter(n => n > 0).reduce((a, b) => a + b, 0)
        : Math.max(0, ...positives(q.optionScores, q.options));
    case 'yesno':
      return Math.max(0, num(q.optionScores?.Yes), num(q.optionScores?.No));
    case 'rating': return Math.max(0, (q.max ?? 5) * num(q.scoreWeight));
    case 'nps': return Math.max(0, 10 * num(q.scoreWeight));
    case 'slider': return Math.max(0, (q.max ?? 100) * num(q.scoreWeight));
    case 'number': return q.max !== undefined ? Math.max(0, q.max * num(q.scoreWeight)) : 0;
    default: return 0;
  }
}

/** The band a score falls in: the one with the highest `min` that the score reaches. */
export function bandFor(bands: ScoreBand[] | undefined, score: number): ScoreBand | undefined {
  return [...(bands ?? [])].filter(b => score >= b.min).sort((a, b) => b.min - a.min)[0];
}

export interface ScoreResult { score: number; max: number; band?: ScoreBand }

/** Total for a respondent, counting only questions on their route that were visible to them. */
export function computeScore(def: SurveyDefinition, answers: Answers): ScoreResult {
  const all = flatQuestions(def);
  const onPath = new Set(sectionPath(def, answers));
  let score = 0; let max = 0;
  def.sections.forEach((section, i) => {
    if (!onPath.has(i)) return;
    for (const q of section.questions) {
      if (!isVisibleIn(q, answers, all)) continue;
      score += questionScore(q, answers[q.id]);
      max += questionMax(q);
    }
  });
  score = Math.round(score * 1e6) / 1e6;
  return { score, max: Math.round(max * 1e6) / 1e6, band: bandFor(def.scoring?.bands, score) };
}

/** Replaces {{score}}, {{maxscore}} and {{result}} in a message. */
export function fillScoreTokens(text: string, r: ScoreResult): string {
  return text
    .replace(/\{\{\s*score\s*\}\}/gi, String(r.score))
    .replace(/\{\{\s*maxscore\s*\}\}/gi, String(r.max))
    .replace(/\{\{\s*result\s*\}\}/gi, r.band?.label ?? '');
}
