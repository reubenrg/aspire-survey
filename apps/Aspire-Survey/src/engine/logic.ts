/**
 * The one evaluator for survey logic: question display, page display, skip
 * jumps and answer piping all come through here. The builder previews and the
 * respondent renderer call these same functions, so what an author sees in the
 * editor is what a respondent gets. Do not write a second evaluator anywhere.
 */
import type { AnswerValue, Answers, ConditionGroup, Logic, Rule } from './types.ts';

export function isGroup(logic: Logic): logic is ConditionGroup {
  return 'rules' in logic;
}

/** Every stored definition uses the single-rule shape, so it is read as one `equals` rule. */
export function normalizeLogic(logic: Logic): ConditionGroup {
  if (isGroup(logic)) return logic;
  return { match: 'all', rules: [{ questionId: logic.questionId, op: 'equals', value: logic.equals }] };
}

/** Ids of every question a piece of logic reads. */
export function logicQuestionIds(logic: Logic): string[] {
  return normalizeLogic(logic).rules.map(r => r.questionId);
}

/** Whether an answer counts as "not answered". */
export function isEmptyAnswer(value: AnswerValue): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value).every(v => !v);
}

function asNumber(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** -1 / 0 / 1, comparing as numbers when both are numeric, as ISO dates when both are dates, otherwise not comparable. */
function compare(a: string, b: string): number | null {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;
  if (ISO_DATE.test(a) && ISO_DATE.test(b)) return a === b ? 0 : a < b ? -1 : 1;
  return null;
}

export function ruleHolds(rule: Rule, answers: Answers): boolean {
  const answer = answers[rule.questionId];
  const wanted = rule.value ?? [];

  if (rule.op === 'answered') return !isEmptyAnswer(answer);
  if (rule.op === 'notAnswered') return isEmptyAnswer(answer);

  // A matrix answers many things at once; there is no meaningful single comparison.
  if (answer !== undefined && typeof answer === 'object' && !Array.isArray(answer)) return false;

  const values: string[] = Array.isArray(answer) ? answer : typeof answer === 'string' && answer !== '' ? [answer] : [];

  switch (rule.op) {
    case 'equals': return values.some(v => wanted.includes(v));
    case 'notEquals': return !values.some(v => wanted.includes(v));
    case 'contains':
      if (Array.isArray(answer)) return answer.some(v => wanted.includes(v));
      return values.some(v => wanted.some(w => w !== '' && v.toLowerCase().includes(w.toLowerCase())));
    case 'notContains':
      if (Array.isArray(answer)) return !answer.some(v => wanted.includes(v));
      return !values.some(v => wanted.some(w => w !== '' && v.toLowerCase().includes(w.toLowerCase())));
    case 'gt': case 'gte': case 'lt': case 'lte': {
      if (values.length === 0 || wanted.length === 0) return false;
      const c = compare(values[0], wanted[0]);
      if (c === null) return false;
      return rule.op === 'gt' ? c > 0 : rule.op === 'gte' ? c >= 0 : rule.op === 'lt' ? c < 0 : c <= 0;
    }
  }
}

/** True when the logic holds for these answers. An empty rule list holds (nothing restricts). */
export function evaluate(logic: Logic | undefined, answers: Answers): boolean {
  if (!logic) return true;
  const { match, rules } = normalizeLogic(logic);
  if (rules.length === 0) return true;
  return match === 'any' ? rules.some(r => ruleHolds(r, answers)) : rules.every(r => ruleHolds(r, answers));
}

/** An answer as one readable string, for piping and summaries. */
export function answerText(value: AnswerValue): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return '';
}

const PIPE = /\{\{\s*answer:([A-Za-z0-9_.-]+)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Replaces {{answer:question_id}} (or {{answer:question_id|fallback}}) with what
 * the respondent said earlier. With no answer it uses the fallback, or nothing.
 * Run this AFTER translating: the translation table is keyed by the text as
 * authored, placeholder included.
 */
export function pipe(text: string, answers: Answers): string {
  if (!text.includes('{{')) return text;
  return text.replace(PIPE, (_m, id: string, fallback?: string) => {
    const said = answerText(answers[id]).trim();
    return said !== '' ? said : (fallback ?? '').trim();
  });
}

/**
 * A label with its piping placeholders shown as a neutral blank, for places with
 * no respondent (analytics, exports, the response table) where "{{answer:csat|-}}"
 * would just be noise.
 */
export function stripPipes(text: string): string {
  return text.includes('{{') ? text.replace(PIPE, '[earlier answer]') : text;
}

/** Question ids a string pipes in, for validation. */
export function pipedQuestionIds(text: string | undefined): string[] {
  if (!text || !text.includes('{{')) return [];
  return Array.from(text.matchAll(PIPE), m => m[1]);
}
