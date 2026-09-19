/**
 * Structural validation for Builder V2, run before Preview and before
 * Publish. This is separate from engine/additive.ts's validateAdditive: that
 * guard protects answers already collected against a *change*; this one
 * checks that a definition is internally well-formed at all, whether or not
 * it has ever been published. Publish runs both.
 */
import { hasOptions, hasStringAnswer } from '../engine/questionFactory.ts';
import { columnsFor, defaultColumn } from '../engine/definition.ts';
import { normalizeLogic, pipedQuestionIds } from '../engine/logic.ts';
import { safePattern } from '../engine/validation.ts';
import type { Logic, Question, Section, SurveyDefinition } from '../engine/types.ts';

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

      if (q.type === 'sum' || q.type === 'multitext') {
        if (q.rows.filter(r => r.trim() !== '').length === 0) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" has no ${q.type === 'sum' ? 'items' : 'boxes'}.` });
        }
        if (!q.columnPrefix || q.columnPrefix.trim() === '') {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" has no column prefix.` });
        }
      }

      if (q.type === 'image') {
        const missing = q.options.filter((o, i) => o.trim() !== '' && !(q.images?.[i] ?? '').trim()).length;
        if (missing > 0) {
          issues.push({ severity: 'warning', subject: q.id, message: `"${q.label || q.id}" has ${missing} choice${missing === 1 ? '' : 's'} without a picture.` });
        }
        for (const [i, url] of (q.images ?? []).entries()) {
          if (url.trim() !== '' && !/^https:\/\//i.test(url.trim())) {
            issues.push({ severity: 'error', subject: q.id, message: `Picture ${i + 1} of "${q.label || q.id}" must be an https:// address.` });
          }
        }
      }

      if ('options' in q && q.optionsFrom) {
        const from = questionsById.get(q.optionsFrom.questionId);
        if (!from || !('options' in from)) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" carries choices forward from a question that does not exist or has no options.` });
        } else if (positionById.get(from.id)! >= positionById.get(q.id)!) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" carries choices forward from "${from.label || from.id}", which comes after it.` });
        }
      }
      if ('options' in q && q.optionLogic) {
        for (const [option, logic] of Object.entries(q.optionLogic)) {
          if (!q.options.includes(option)) {
            issues.push({ severity: 'warning', subject: q.id, message: `"${q.label || q.id}" has a display rule for "${option}", which is no longer one of its options.` });
          }
          issues.push(...validateLogic(q.id, `${q.label || q.id} - option "${option}"`, logic, positionById.get(q.id)!, questionsById, positionById));
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

      issues.push(...validateTypeSettings(q));

      if (q.showIf) {
        issues.push(...validateLogic(q.id, q.label || q.id, q.showIf, positionById.get(q.id)!, questionsById, positionById));
      }
      for (const ref of pipedQuestionIds(`${q.label} ${q.hint ?? ''}`)) {
        const src = questionsById.get(ref);
        if (!src) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" pipes in an answer from "${ref}", which does not exist.` });
        } else if (positionById.get(ref)! >= positionById.get(q.id)!) {
          issues.push({ severity: 'error', subject: q.id, message: `"${q.label || q.id}" pipes in "${src.label || ref}", which comes after it. A piped answer must come from an earlier question.` });
        }
      }
    }
  }

  // Page-level logic: a page's own display rule may read anything before the
  // page; a skip jump may also read the page's own questions (it runs after
  // they are answered) and may only lead forward.
  let cursor = 0;
  def.sections.forEach((section, si) => {
    const start = cursor;
    cursor += section.questions.length;
    const end = cursor;
    const name = `Page "${section.title || section.id}"`;

    if (section.showIf) {
      issues.push(...validateLogic(section.id, name, section.showIf, start, questionsById, positionById));
    }
    (section.jumps ?? []).forEach((jump, ji) => {
      issues.push(...validateLogic(section.id, `${name} skip rule ${ji + 1}`, jump.when, end, questionsById, positionById));
      if (jump.to !== 'end') {
        const target = def.sections.findIndex(x => x.id === jump.to);
        if (target < 0) {
          issues.push({ severity: 'error', subject: section.id, message: `${name} skip rule ${ji + 1} goes to a page that no longer exists.` });
        } else if (target <= si) {
          issues.push({ severity: 'error', subject: section.id, message: `${name} skip rule ${ji + 1} goes backwards. Skip rules can only jump forward or end the survey.` });
        }
      }
    });
  });

  // Two questions writing to one column would silently overwrite each other.
  const seenColumns = new Set<string>();
  for (const c of columnsFor(def)) {
    if (seenColumns.has(c.name)) {
      issues.push({ severity: 'error', subject: 'survey', message: `Two questions write to the column "${c.name}". Give one of them a different id or column prefix.` });
    }
    seenColumns.add(c.name);
  }

  const RESERVED = new Set(['id', 'submitted_at', 'definition_version', 'employee_id', 'resp_department', 'resp_location', 'resp_designation']);
  const takenColumns = new Set(def.sections.flatMap(s => s.questions.map(q => (q.type === 'matrix' ? q.columnPrefix : (q.column || defaultColumn(q.id))))));
  const seenHidden = new Set<string>();
  for (const h of def.hiddenFields ?? []) {
    const col = defaultColumn(h);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(h)) {
      issues.push({ severity: 'error', subject: 'survey', message: `Hidden field "${h}" must start with a letter and use only letters, numbers and underscores (40 characters at most).` });
    } else if (RESERVED.has(col) || takenColumns.has(col) || questionsById.has(h)) {
      issues.push({ severity: 'error', subject: 'survey', message: `Hidden field "${h}" clashes with a question or a reserved column. Choose another name.` });
    } else if (seenHidden.has(col)) {
      issues.push({ severity: 'error', subject: 'survey', message: `Hidden field "${h}" is listed twice.` });
    }
    seenHidden.add(col);
  }

  for (const ref of pipedQuestionIds(def.thankYou.body)) {
    if (!questionsById.has(ref)) {
      issues.push({ severity: 'error', subject: 'survey', message: `The thank-you message pipes in an answer from "${ref}", which does not exist.` });
    }
  }

  return issues;
}

/** Checks each type's own settings, so a nonsense limit is caught before a respondent hits it. */
function validateTypeSettings(q: Question): BuilderIssue[] {
  const out: BuilderIssue[] = [];
  const label = q.label || q.id;
  const err = (message: string) => out.push({ severity: 'error', subject: q.id, message });

  switch (q.type) {
    case 'text':
    case 'textarea':
      if (q.minLength !== undefined && q.maxLength !== undefined && q.minLength > q.maxLength) {
        err(`"${label}" has a minimum length above its maximum.`);
      }
      if (q.type === 'text' && q.pattern && !safePattern(q.pattern)) {
        err(`"${label}" has a format pattern that is not a valid regular expression.`);
      }
      break;
    case 'number':
      if (q.min !== undefined && q.max !== undefined && q.min > q.max) err(`"${label}" has a minimum above its maximum.`);
      break;
    case 'date':
      if (q.min && q.max && q.min > q.max) err(`"${label}" has an earliest date after its latest date.`);
      break;
    case 'rating':
      if (q.max !== undefined && (!Number.isInteger(q.max) || q.max < 3 || q.max > 10)) err(`"${label}" must have a top rating between 3 and 10.`);
      break;
    case 'slider': {
      const lo = q.min ?? 0;
      const hi = q.max ?? 100;
      if (lo >= hi) err(`"${label}" needs a maximum above its minimum.`);
      if (q.step !== undefined && !(q.step > 0)) err(`"${label}" needs a step above zero.`);
      break;
    }
    case 'checkbox':
      if (q.minSelections !== undefined) {
        const n = q.options.filter(o => o.trim() !== '').length;
        if (!Number.isInteger(q.minSelections) || q.minSelections < 0) err(`"${label}" has an invalid minimum selection count.`);
        else if (q.minSelections > n) err(`"${label}" needs at least ${q.minSelections} selections but only has ${n} option${n === 1 ? '' : 's'}.`);
        else if (q.maxSelections !== undefined && q.minSelections > q.maxSelections) err(`"${label}" has a minimum selection count above its maximum.`);
      }
      break;
    case 'ranking':
      if (q.options.filter(o => o.trim() !== '').length < 2) err(`"${label}" needs at least two options to rank.`);
      break;
    case 'sum':
      if (!(q.total > 0) || !Number.isFinite(q.total)) err(`"${label}" needs a total above zero.`);
      break;
    case 'file':
      if (q.maxSizeMb !== undefined && (q.maxSizeMb < 1 || q.maxSizeMb > 10)) err(`"${label}" must allow files between 1 and 10 MB.`);
      break;
    case 'image':
      if (q.minSelections !== undefined && q.maxSelections !== undefined && q.minSelections > q.maxSelections) err(`"${label}" has a minimum above its maximum.`);
      break;
    default:
      break;
  }
  return out;
}

const VALUE_OPS = new Set(['equals', 'notEquals', 'contains', 'notContains', 'gt', 'gte', 'lt', 'lte']);
const COMPARE_OPS = new Set(['gt', 'gte', 'lt', 'lte']);
const COMPARABLE_TYPES = new Set(['number', 'rating', 'nps', 'slider', 'date']);

/**
 * `limit` is the reading-order position a source must be BEFORE: a question's
 * own position, a page's first question, or one past a page's last question.
 */
function validateLogic(
  subject: string,
  label: string,
  logic: Logic,
  limit: number,
  questionsById: Map<string, Question>,
  positionById: Map<string, number>,
): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', subject, message });
  const { rules } = normalizeLogic(logic);

  if (rules.length === 0) {
    err(`"${label}" has a condition with no rules.`);
    return issues;
  }

  for (const rule of rules) {
    if (rule.questionId === subject) { err(`"${label}" is set to depend on itself.`); continue; }
    const source = questionsById.get(rule.questionId);
    if (!source) { err(`"${label}" depends on a question that no longer exists.`); continue; }
    if (positionById.get(source.id)! >= limit) {
      err(`"${label}" depends on "${source.label || source.id}", which comes after it. A condition can only depend on an earlier question.`);
      continue;
    }
    if (!hasStringAnswer(source.type)) {
      err(`"${label}" depends on "${source.label || source.id}", a matrix. Conditions cannot read a matrix.`);
      continue;
    }

    const values = (rule.value ?? []).filter(v => v.trim() !== '');
    if (VALUE_OPS.has(rule.op) && values.length === 0) {
      err(`"${label}" has a rule on "${source.label || source.id}" with no value to compare against yet.`);
      continue;
    }
    if (COMPARE_OPS.has(rule.op)) {
      if (!COMPARABLE_TYPES.has(source.type)) {
        err(`"${label}" compares "${source.label || source.id}" with a greater-than / less-than rule, but that question is not a number, rating, score, slider or date.`);
      } else if (source.type !== 'date' && !Number.isFinite(Number(values[0]))) {
        err(`"${label}" compares "${source.label || source.id}" against "${values[0]}", which is not a number.`);
      }
    }

    const optionList = hasOptions(source) ? source.options : source.type === 'yesno' ? ['Yes', 'No'] : null;
    if (optionList && (rule.op === 'equals' || rule.op === 'notEquals' || rule.op === 'contains' || rule.op === 'notContains')) {
      const missing = values.filter(v => !optionList.includes(v));
      if (missing.length > 0) {
        err(`"${label}" checks for ${missing.length === 1 ? 'an option' : 'options'} ${missing.map(v => `"${v}"`).join(', ')} on "${source.label || source.id}" that no longer exist${missing.length === 1 ? 's' : ''}.`);
      }
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
