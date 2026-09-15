/**
 * A survey definition. One of these describes a whole survey: its sections, its
 * questions, and how each answer maps to a column in that survey's own table.
 *
 * Definitions are data, not code. They are authored in the admin builder, stored
 * as JSON in the `surveys` table, and rendered by the engine. Nothing here may
 * reference a React component or a function, or it will not survive the round
 * trip through the database.
 */

export type QuestionType =
  | 'text'
  | 'select'
  | 'textarea'
  | 'radio'
  | 'checkbox'
  | 'matrix';

/** Show a question only when another answer matches. */
export interface Condition {
  /** id of the question this depends on. */
  questionId: string;
  /** Visible when the other answer is one of these values. */
  equals: string[];
}

interface BaseQuestion {
  /** Stable, unique within the survey. Used as the answer key. Never reuse an id. */
  id: string;
  type: QuestionType;
  label: string;
  hint?: string;
  required?: boolean;
  showIf?: Condition;
  /**
   * Column this answer is written to. Defaults to a snake_case form of `id`.
   * Matrix questions ignore this and use `columnPrefix` instead.
   */
  column?: string;
}

export interface TextQuestion extends BaseQuestion {
  type: 'text';
  placeholder?: string;
}

export interface TextAreaQuestion extends BaseQuestion {
  type: 'textarea';
}

export interface SelectQuestion extends BaseQuestion {
  type: 'select';
  options: string[];
  placeholder?: string;
}

export interface RadioQuestion extends BaseQuestion {
  type: 'radio';
  options: string[];
  /** When 'Other' is chosen, capture free text into this extra column. */
  otherColumn?: string;
}

export interface CheckboxQuestion extends BaseQuestion {
  type: 'checkbox';
  options: string[];
  /** Cap on selections. Omit for unlimited. */
  maxSelections?: number;
  otherColumn?: string;
}

/**
 * A grid of statements scored on a shared scale. Each row becomes its own
 * column, numbered by position: `${columnPrefix}_01`, `_02`, and so on.
 *
 * Row order is therefore load-bearing. Reordering or deleting a row silently
 * reassigns what an existing column means, so treat the list as append-only
 * once a survey has collected responses.
 */
export interface MatrixQuestion extends BaseQuestion {
  type: 'matrix';
  rows: string[];
  scale: string[];
  columnPrefix: string;
  /**
   * Swap the row list based on another answer, for role-specific modules.
   * The key is that question's answer; the value is the rows to show.
   * When set, `rows` is the fallback for an answer with no entry.
   */
  rowsByAnswer?: { questionId: string; map: Record<string, string[]> };
  /** Title shown above the grid, also switched by `rowsByAnswer`. */
  titleByAnswer?: Record<string, string>;
}

export type Question =
  | TextQuestion
  | TextAreaQuestion
  | SelectQuestion
  | RadioQuestion
  | CheckboxQuestion
  | MatrixQuestion;

export interface Section {
  id: string;
  title: string;
  /** Optional paragraph under the heading. */
  intro?: string;
  /** Optional bordered callout, for scope notes and constraints. */
  note?: string;
  questions: Question[];
}

export interface SurveyDefinition {
  /** URL segment, and the suffix of the response table name. */
  slug: string;
  title: string;
  /** Shown in the header. Falls back to `title`. */
  brand?: string;
  /** Table answers are written to. Defaults to `survey_${slug}` with dashes as underscores. */
  tableName?: string;
  /** Shown before the first section. */
  welcome: { heading: string; body: string[]; note?: string; startLabel?: string };
  thankYou: { heading: string; body: string };
  sections: Section[];
  /**
   * Answer used to enforce one response per person. Its column gets a unique
   * constraint, and a repeat submission is reported back as a duplicate.
   */
  uniqueBy?: string;
}

/** Everything a respondent has answered so far, keyed by question id. */
export type Answers = Record<string, AnswerValue>;

export type AnswerValue = string | string[] | Record<string, string> | undefined;
