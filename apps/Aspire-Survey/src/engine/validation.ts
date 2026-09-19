/**
 * Answer validation: what makes an answer acceptable, beyond "is it filled in".
 * Shared by the respondent renderer (which shows the message under the field)
 * and the builder's own checks, so the two cannot disagree.
 *
 * Messages are plain English. The renderer passes them through the survey's
 * translator, which falls back to English for anything untranslated.
 */
import type { AnswerValue, Answers, Question, Section } from './types.ts';
import { isBlank, matrixRows, visibleQuestions } from './definition.ts';

export const REQUIRED_MESSAGE = 'This question is required.';

/** Practical, not RFC-complete: something@something.tld, no spaces. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Compiles an author-supplied pattern. A pattern that is not valid never blocks a respondent. */
export function safePattern(source: string): RegExp | null {
  try { return new RegExp(`^(?:${source})$`); } catch { return null; }
}

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** null when fine, otherwise the message to show. `answers` is only used for matrix row lookup. */
export function validateAnswer(q: Question, value: AnswerValue, answers: Answers): string | null {
  if (isBlank(q, value, answers)) {
    return q.required ? REQUIRED_MESSAGE : null;
  }

  switch (q.type) {
    case 'text': {
      const s = (value as string).trim();
      if (q.minLength && s.length < q.minLength) return `Please enter at least ${q.minLength} characters.`;
      if (q.maxLength && s.length > q.maxLength) return `Please keep this to ${q.maxLength} characters or fewer.`;
      if (q.pattern) {
        const re = safePattern(q.pattern);
        if (re && !re.test(s)) return q.patternMessage || 'Please check the format of this answer.';
      }
      return null;
    }
    case 'textarea': {
      const s = (value as string).trim();
      if (q.minLength && s.length < q.minLength) return `Please enter at least ${q.minLength} characters.`;
      if (q.maxLength && s.length > q.maxLength) return `Please keep this to ${q.maxLength} characters or fewer.`;
      return null;
    }
    case 'email':
      return EMAIL.test((value as string).trim()) ? null : 'Please enter a valid email address.';
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'Please enter a number.';
      if (q.integer && !Number.isInteger(n)) return 'Please enter a whole number.';
      if (q.min !== undefined && n < q.min) return `Please enter ${q.min} or more.`;
      if (q.max !== undefined && n > q.max) return `Please enter ${q.max} or less.`;
      return null;
    }
    case 'date': {
      const s = value as string;
      if (!isRealDate(s)) return 'Please enter a valid date.';
      if (q.min && s < q.min) return `Please choose a date on or after ${q.min}.`;
      if (q.max && s > q.max) return `Please choose a date on or before ${q.max}.`;
      return null;
    }
    case 'rating': {
      const n = Number(value);
      const max = q.max ?? 5;
      return Number.isInteger(n) && n >= 1 && n <= max ? null : 'Please choose a rating.';
    }
    case 'nps': {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 10 ? null : 'Please choose a score from 0 to 10.';
    }
    case 'slider': {
      const n = Number(value);
      const lo = q.min ?? 0;
      const hi = q.max ?? 100;
      return Number.isFinite(n) && n >= lo && n <= hi ? null : 'Please choose a value on the scale.';
    }
    case 'yesno':
      return value === 'Yes' || value === 'No' ? null : 'Please choose Yes or No.';
    case 'checkbox': {
      const count = (value as string[]).length;
      if (q.minSelections && count < q.minSelections) return `Please choose at least ${q.minSelections}.`;
      if (q.maxSelections && count > q.maxSelections) return `Please choose no more than ${q.maxSelections}.`;
      return null;
    }
    case 'ranking': {
      const given = value as string[];
      const complete = given.length === q.options.length && q.options.every(o => given.includes(o));
      return complete ? null : 'Please rank every option.';
    }
    case 'matrix':
    case 'select':
    case 'radio':
      return null;
  }
}

/**
 * Every problem on a page, keyed by question id. Hidden questions are never
 * checked, so a follow-up that has since been hidden cannot trap anyone. Also
 * catches a matrix that is only partly answered when it is not required.
 */
export function validateSection(section: Section, answers: Answers): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const q of visibleQuestions(section, answers)) {
    const msg = validateAnswer(q, answers[q.id], answers);
    if (msg) { problems[q.id] = msg; continue; }
    if (q.type === 'matrix' && !q.required) {
      const given = (answers[q.id] as Record<string, string>) || {};
      const rows = matrixRows(q, answers);
      const some = rows.some(r => given[r]);
      if (some && rows.some(r => !given[r])) problems[q.id] = 'Please answer every row, or clear the grid.';
    }
  }
  return problems;
}
