/**
 * The row a submission writes: the answers flattened to columns (buildRow) plus the
 * quiz score when scoring is on. Both submission paths (open link and invitation)
 * build their row here so they can never disagree.
 */
import { buildRow, defaultColumn } from './definition.ts';
import { computeScore, SCORE_FIELD } from './scoring.ts';
import type { Answers, SurveyDefinition } from './types.ts';

export function buildSubmissionRow(def: SurveyDefinition, answers: Answers): Record<string, unknown> {
  const row = buildRow(def, answers);
  // Set from the answers, never from the link, even if a visitor added ?quiz_score=… to the URL.
  if (def.scoring?.enabled && (def.hiddenFields ?? []).includes(SCORE_FIELD)) {
    row[defaultColumn(SCORE_FIELD)] = String(computeScore(def, answers).score);
  }
  return row;
}
