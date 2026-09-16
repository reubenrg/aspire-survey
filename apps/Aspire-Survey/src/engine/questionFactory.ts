/**
 * The single source of truth for "what does a question of type X look like,
 * and what happens when it becomes type Y". Both the original /admin/:slug
 * editor and the Builder V2 question picker/properties panel import from
 * here, so the two editors can never quietly diverge on what a question type
 * actually supports — there is exactly one engine, per the Sprint 3 brief.
 *
 * These are the ONLY question types the engine can render and submit
 * end-to-end (engine/types.ts QuestionType, engine/QuestionField.tsx,
 * engine/definition.ts buildRow/columnsFor). Nothing is exposed in any
 * picker that isn't in this map.
 */
import type { Question, QuestionType, Section } from './types.ts';
import { defaultColumn } from './definition.ts';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  select: 'Dropdown',
  radio: 'Single choice',
  checkbox: 'Multiple choice',
  matrix: 'Matrix / rating grid',
};

export const QUESTION_TYPE_DESCRIPTIONS: Record<QuestionType, string> = {
  text: 'One line of free text.',
  textarea: 'A paragraph of free text.',
  select: 'One answer, chosen from a dropdown list.',
  radio: 'One answer, chosen from visible options.',
  checkbox: 'Any number of answers, chosen from a list.',
  matrix: 'A grid of statements rated on a shared scale (e.g. a Likert scale).',
};

export const QUESTION_TYPES: QuestionType[] = ['text', 'textarea', 'select', 'radio', 'checkbox', 'matrix'];

/** True for types whose answer is a single string — the only types a `showIf` condition can safely target. */
export function hasStringAnswer(type: QuestionType): boolean {
  return type === 'text' || type === 'textarea' || type === 'select' || type === 'radio';
}

export function hasOptions(q: Question): q is Question & { type: 'select' | 'radio' | 'checkbox'; options: string[] } {
  return q.type === 'select' || q.type === 'radio' || q.type === 'checkbox';
}

export function newQuestion(section: Section, type: QuestionType = 'text'): Question {
  const n = section.questions.length + 1;
  const id = `${section.id}_q${n}`;
  return blankOfType(id, type);
}

function blankOfType(id: string, type: QuestionType): Question {
  switch (type) {
    case 'text': return { id, type, label: '', required: false };
    case 'textarea': return { id, type, label: '', required: false };
    case 'select': return { id, type, label: '', required: false, options: ['Option one', 'Option two'] };
    case 'radio': return { id, type, label: '', required: false, options: ['Option one', 'Option two'] };
    case 'checkbox': return { id, type, label: '', required: false, options: ['Option one', 'Option two'] };
    case 'matrix': return {
      id, type, label: '', required: false,
      rows: ['First statement'],
      scale: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
      columnPrefix: defaultColumn(id),
    };
  }
}

/** Keeps what still applies when a question's type changes, and fills in what the new type needs. */
export function convertQuestion(q: Question, type: QuestionType): Question {
  if (q.type === type) return q;
  const base = { id: q.id, label: q.label, hint: q.hint, required: q.required, showIf: q.showIf, column: q.column };
  const options = 'options' in q ? q.options : ['Option one', 'Option two'];
  switch (type) {
    case 'text': return { ...base, type };
    case 'textarea': return { ...base, type };
    case 'select': return { ...base, type, options };
    case 'radio': return { ...base, type, options };
    case 'checkbox': return { ...base, type, options };
    case 'matrix': return {
      ...base, type,
      rows: 'rows' in q ? q.rows : ['First statement'],
      scale: 'scale' in q ? q.scale : ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
      columnPrefix: 'columnPrefix' in q ? q.columnPrefix : defaultColumn(q.id),
    };
  }
}
