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
  email: 'Email address',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  radio: 'Single choice',
  checkbox: 'Multiple choice',
  yesno: 'Yes / No',
  rating: 'Rating (stars)',
  nps: 'Net Promoter Score (0-10)',
  slider: 'Slider',
  ranking: 'Ranking',
  matrix: 'Matrix / rating grid',
  sum: 'Constant sum',
  multitext: 'Multiple text boxes',
  heading: 'Heading / description',
  fullname: 'Full name',
  phone: 'Phone number',
  image: 'Image choice',
  file: 'File upload',
  signature: 'Signature',
};

export const QUESTION_TYPE_DESCRIPTIONS: Record<QuestionType, string> = {
  text: 'One line of free text, with optional length and format limits.',
  textarea: 'A paragraph of free text.',
  email: 'An email address, checked for a valid format.',
  number: 'A number, with optional minimum, maximum and whole-number limits.',
  date: 'A calendar date, with optional earliest and latest dates.',
  select: 'One answer, chosen from a dropdown list.',
  radio: 'One answer, chosen from visible options.',
  checkbox: 'Any number of answers, chosen from a list.',
  yesno: 'A simple Yes or No.',
  rating: 'A star (or numbered) rating from 1 up to 3-10.',
  nps: '"How likely are you to recommend...?" on a 0-10 scale, reported as promoters, passives and detractors.',
  slider: 'A value picked by dragging along a scale.',
  ranking: 'Respondents put every option in order of preference.',
  matrix: 'A grid of statements rated on a shared scale (e.g. a Likert scale).',
  sum: 'Respondents split a fixed total (such as 100 points) across several items.',
  multitext: 'Several short labelled text boxes in one question, e.g. address lines.',
  heading: 'A title and paragraph of text between questions. Collects no answer.',
  fullname: 'First and last name boxes.',
  phone: 'A phone number, checked for a plausible format.',
  image: 'Choose one or several pictures.',
  file: 'The respondent uploads a file (image, PDF or document).',
  signature: 'The respondent draws their signature.',
};

/** Picker order, grouped the way people think about them: text, choice, scale, layout. */
export const QUESTION_TYPES: QuestionType[] = [
  'text', 'textarea', 'email', 'number', 'date',
  'radio', 'checkbox', 'select', 'yesno', 'ranking',
  'rating', 'nps', 'slider', 'matrix', 'sum',
  'fullname', 'phone', 'multitext', 'image', 'file', 'signature', 'heading',
];

/** Types whose answer is a single, comparable value - what a `showIf` rule or a skip jump can read. */
export function hasStringAnswer(type: QuestionType): boolean {
  return !NO_SINGLE_ANSWER.has(type);
}

/** Types with no single comparable answer (a grid of values, a file, or no answer at all). */
const NO_SINGLE_ANSWER = new Set<QuestionType>(['matrix', 'sum', 'multitext', 'heading', 'file', 'signature']);

/** Types stored one column per row, numbered by position: matrix, sum and multitext. */
export function isRowType(type: QuestionType): type is 'matrix' | 'sum' | 'multitext' {
  return type === 'matrix' || type === 'sum' || type === 'multitext';
}

/** Types that draw from a fixed list of options. */
export function hasOptions(q: Question): q is Question & { type: 'select' | 'radio' | 'checkbox' | 'ranking' | 'image'; options: string[] } {
  return q.type === 'select' || q.type === 'radio' || q.type === 'checkbox' || q.type === 'ranking' || q.type === 'image';
}

/** Types that can carry `randomize`. */
export function canRandomize(type: QuestionType): boolean {
  return type === 'select' || type === 'radio' || type === 'checkbox' || type === 'ranking' || type === 'image';
}

export function newQuestion(section: Section, type: QuestionType = 'text'): Question {
  const n = section.questions.length + 1;
  const id = `${section.id}_q${n}`;
  return blankOfType(id, type);
}

const DEFAULT_SCALE = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];

function blankOfType(id: string, type: QuestionType): Question {
  const b = { id, label: '', required: false };
  switch (type) {
    case 'text': return { ...b, type };
    case 'textarea': return { ...b, type };
    case 'email': return { ...b, type };
    case 'number': return { ...b, type };
    case 'date': return { ...b, type };
    case 'yesno': return { ...b, type };
    case 'select': return { ...b, type, options: ['Option one', 'Option two'] };
    case 'radio': return { ...b, type, options: ['Option one', 'Option two'] };
    case 'checkbox': return { ...b, type, options: ['Option one', 'Option two'] };
    case 'ranking': return { ...b, type, options: ['Option one', 'Option two', 'Option three'] };
    case 'sum': return { ...b, type, rows: ['First item', 'Second item'], total: 100, columnPrefix: defaultColumn(id) };
    case 'multitext': return { ...b, type, rows: ['Line one', 'Line two'], columnPrefix: defaultColumn(id) };
    case 'heading': return { id, type, label: 'Section heading' };
    case 'fullname': return { ...b, type };
    case 'phone': return { ...b, type };
    case 'image': return { ...b, type, options: ['Option one', 'Option two'], images: ['', ''] };
    case 'file': return { ...b, type, maxSizeMb: 5, accept: 'any' };
    case 'signature': return { ...b, type };
    case 'rating': return { ...b, type, max: 5, shape: 'star' };
    case 'nps': return { ...b, type, lowLabel: 'Not at all likely', highLabel: 'Extremely likely' };
    case 'slider': return { ...b, type, min: 0, max: 100, step: 1 };
    case 'matrix': return {
      ...b, type,
      rows: ['First statement'],
      scale: DEFAULT_SCALE,
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
    case 'email': return { ...base, type };
    case 'number': return { ...base, type };
    case 'date': return { ...base, type };
    case 'yesno': return { ...base, type };
    case 'select': return { ...base, type, options };
    case 'radio': return { ...base, type, options };
    case 'checkbox': return { ...base, type, options };
    case 'ranking': return { ...base, type, options: options.length >= 2 ? options : [...options, 'Option two'] };
    case 'sum': return { ...base, type, rows: 'rows' in q ? q.rows : ['First item', 'Second item'], total: 100, columnPrefix: 'columnPrefix' in q ? q.columnPrefix : defaultColumn(q.id) };
    case 'multitext': return { ...base, type, rows: 'rows' in q ? q.rows : ['Line one', 'Line two'], columnPrefix: 'columnPrefix' in q ? q.columnPrefix : defaultColumn(q.id) };
    case 'heading': return { ...base, type, required: undefined };
    case 'fullname': return { ...base, type };
    case 'phone': return { ...base, type };
    case 'image': return { ...base, type, options, images: options.map(() => '') };
    case 'file': return { ...base, type, maxSizeMb: 5, accept: 'any' };
    case 'signature': return { ...base, type };
    case 'rating': return { ...base, type, max: 5, shape: 'star' };
    case 'nps': return { ...base, type, lowLabel: 'Not at all likely', highLabel: 'Extremely likely' };
    case 'slider': return { ...base, type, min: 0, max: 100, step: 1 };
    case 'matrix': return {
      ...base, type,
      rows: 'rows' in q ? q.rows : ['First statement'],
      scale: 'scale' in q ? q.scale : DEFAULT_SCALE,
      columnPrefix: 'columnPrefix' in q ? q.columnPrefix : defaultColumn(q.id),
    };
  }
}
