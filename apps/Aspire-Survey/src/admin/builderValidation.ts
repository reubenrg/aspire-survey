/**
 * Structural validation for Builder V2, run before Preview and before
 * Publish. This is separate from engine/additive.ts's validateAdditive: that
 * guard protects answers already collected against a *change*; this one
 * checks that a definition is internally well-formed at all, whether or not
 * it has ever been published. Publish runs both.
 */
import { hasOptions, hasStringAnswer } from '../engine/questionFactory.ts';
import type { Question, Section, SurveyDefinition } from '../engine/types.ts';

export interface BuilderIssue {
  severity: 'error' | 'warning';
  /** A question or section id, for attaching the message to the right place in the UI. */
  subject: string;
  message: string;
}

export function validateSurveyStructure(def: SurveyDefinition): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  const allQuestions = def.sections.flatMap(s => s.questions);

  if (def.sections.length === 0 || allQuestions.length === 0) {
    issues.push({ severity: 'error', subject: 'survey', message: 'This survey has no questions yet.' });
  }

  const sectionIdCounts = countBy(def.sections.map(s => s.id));
  for (const [id, count] of sectionIdCounts) {
    if (count > 1) {
      issues.push({ severity: 'error', subject: id, message: `Two sections share the id "${id}". Section ids must be unique.` });
    }
  }

  const idCounts = countBy(allQuestions.map(q => q.id));
  for (const [id, count] of idCounts) {
    if (count > 1) {
      issues.push({ severity: 'error', subject: id, message: `Two questions share the answer key "${id}". Each question needs its own key, or one would overwrite the other's answers.` });
    }
  }

  const questionsById = new Map(allQuestions.map(q => [q.id, q]));
  // Position in reading order, so a self-reference and a forward reference
  // (to a question later in the survey) are both structurally invalid the
  // same way the respondent-facing editors already require.
  const positionById = new Map(allQuestions.map((q, i) => [q.id, i]));

  for (const section of def.sections) {
    for (const q of section.questions) {
      if (!q.label || q.label.trim() === '') {
        issues.push({ severity: 'error', subject: q.id, message: 'This question has no text yet.' });
      }

      if (hasOptions(q)) {
        const options = q.options.filter(o => o.trim() !== '');
        if (options.length === 0) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" has no options.` });
        }
        const dupes = countBy(options);
        for (const [opt, count] of dupes) {
          if (count > 1) {
            issues.push({ severity: 'warning', subject: q.id, message: `"${q.label || q.id}" lists "${opt}" more than once.` });
          }
        }
      }

      if (q.type === 'checkbox' && q.maxSelections !== undefined) {
        const optionCount = q.options.filter(o => o.trim() !== '').length;
        if (!Number.isInteger(q.maxSelections) || q.maxSelections < 1) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" has an invalid maximum selection count.` });
        } else if (optionCount > 0 && q.maxSelections > optionCount) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" allows up to ${q.maxSelections} selections, but only has ${optionCount} option${optionCount === 1 ? '' : 's'}.` });
        }
      }

      if (q.type === 'matrix') {
        if (q.rows.filter(r => r.trim() !== '').length === 0) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" has no statements/rows.` });
        }
        if (q.scale.filter(s => s.trim() !== '').length === 0) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" has no scale.` });
        }
        if (!q.columnPrefix || q.columnPrefix.trim() === '') {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" has no column prefix.` });
        }
      }

      if (q.showIf) {
        issues.push(...validateCondition(q, questionsById, positionById));
      }
    }
  }

  return issues;
}

function validateCondition(
  q: Question,
  questionsById: Map<string, Question>,
  positionById: Map<string, number>,
): BuilderIssue[] {
  const cond = q.showIf!;
  const label = q.label || q.id;

  if (cond.questionId === q.id) {
    return [{ severity: 'error', subject: q.id, message: `"${label}" is set to depend on itself.` }];
  }

  const source = questionsById.get(cond.questionId);
  if (!source) {
    return [{ severity: 'error', subject: q.id, message: `"${label}" depends on a question that no longer exists.` }];
  }

  const myPos = positionById.get(q.id)!;
  const sourcePos = positionById.get(source.id)!;
  if (sourcePos >= myPos) {
    return [{ severity: 'error', subject: q.id, message: `"${label}" depends on "${source.label || source.id}", which comes after it. A condition can only depend on an earlier question.` }];
  }

  if (!hasStringAnswer(source.type)) {
    return [{ severity: 'error', subject: q.id, message: `"${label}" depends on "${source.label || source.id}", a ${source.type} question. Conditions can only depend on a short text, long text, dropdown or single-choice question.` }];
  }

  const issues: BuilderIssue[] = [];
  if (cond.equals.length === 0) {
    issues.push({ severity: 'error', subject: q.id, message: `"${label}" has no value to match yet.` });
  }
  if (hasOptions(source)) {
    const missing = cond.equals.filter(v => !source.options.includes(v));
    if (missing.length > 0) {
      issues.push({
        severity: 'error', subject: q.id,
        message: `"${label}" checks for ${missing.length === 1 ? 'an option' : 'options'} ${missing.map(v => `"${v}"`).join(', ')} on "${source.label || source.id}" that no longer exist${missing.length === 1 ? 's' : ''}.`,
      });
    }
  }
  return issues;
}

function countBy<T>(items: T[]): Map<T, number> {
  const map = new Map<T, number>();
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
  return map;
}

/** True when nothing here would block Preview or Publish. */
export function isPublishable(issues: BuilderIssue[]): boolean {
  return issues.every(i => i.severity !== 'error');
}

export function newSectionId(existing: Section[]): string {
  let n = existing.length + 1;
  const used = new Set(existing.map(s => s.id));
  while (used.has(`section_${n}`)) n++;
  return `section_${n}`;
}
