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
  | 'matrix'
  | 'rating'
  | 'nps'
  | 'yesno'
  | 'number'
  | 'date'
  | 'email'
  | 'slider'
  | 'ranking';

/**
 * How one answer is compared. `equals`/`notEquals` match any of `value`;
 * `contains` matches a selected option (multi-choice, ranking) or a substring
 * (free text); the four comparisons read the first value as a number (or an
 * ISO date); `answered`/`notAnswered` ignore `value`.
 */
export type RuleOperator =
  | 'equals' | 'notEquals'
  | 'contains' | 'notContains'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'answered' | 'notAnswered';

export interface Rule {
  /** id of the question this depends on. */
  questionId: string;
  op: RuleOperator;
  value?: string[];
}

/**
 * The original, single-rule shape: visible when the other answer is one of
 * `equals`. Still valid everywhere - every definition already stored uses it -
 * and read as one `equals` rule.
 */
export interface Condition {
  questionId: string;
  equals: string[];
}

/** Several rules combined: every one (`all`, AND) or at least one (`any`, OR). */
export interface ConditionGroup {
  match: 'all' | 'any';
  rules: Rule[];
}

export type Logic = Condition | ConditionGroup;

/** After the section is answered, go to `to` (a later section id) or finish with 'end'. First matching jump wins. */
export interface SectionJump {
  when: Logic;
  to: string;
}

interface BaseQuestion {
  /** Stable, unique within the survey. Used as the answer key. Never reuse an id. */
  id: string;
  type: QuestionType;
  /** May pipe an earlier answer in with {{answer:question_id}} or {{answer:question_id|fallback}}. */
  label: string;
  hint?: string;
  required?: boolean;
  showIf?: Logic;
  /**
   * Column this answer is written to. Defaults to a snake_case form of `id`.
   * Matrix questions ignore this and use `columnPrefix` instead.
   */
  column?: string;
}

export interface TextQuestion extends BaseQuestion {
  type: 'text';
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  /** A regular expression the whole answer must match. */
  pattern?: string;
  /** Shown when `pattern` does not match. */
  patternMessage?: string;
}

export interface TextAreaQuestion extends BaseQuestion {
  type: 'textarea';
  minLength?: number;
  maxLength?: number;
}

export interface SelectQuestion extends BaseQuestion {
  type: 'select';
  options: string[];
  placeholder?: string;
  /** Show the options in a different random order to each respondent. */
  randomize?: boolean;
}

export interface RadioQuestion extends BaseQuestion {
  type: 'radio';
  options: string[];
  /** When 'Other' is chosen, capture free text into this extra column. */
  otherColumn?: string;
  randomize?: boolean;
}

export interface CheckboxQuestion extends BaseQuestion {
  type: 'checkbox';
  options: string[];
  /** Floor on selections. Omit for none. */
  minSelections?: number;
  /** Cap on selections. Omit for unlimited. */
  maxSelections?: number;
  otherColumn?: string;
  randomize?: boolean;
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

/** 1..max stars (or numbers). Stored as the number, as text. */
export interface RatingQuestion extends BaseQuestion {
  type: 'rating';
  /** Highest rating, 3 to 10. Defaults to 5. */
  max?: number;
  shape?: 'star' | 'number';
  lowLabel?: string;
  highLabel?: string;
}

/** Net Promoter Score: 0..10. Stored as the number, as text. */
export interface NpsQuestion extends BaseQuestion {
  type: 'nps';
  lowLabel?: string;
  highLabel?: string;
}

/** Stored as 'Yes' or 'No' whatever the labels say, so data stays comparable. */
export interface YesNoQuestion extends BaseQuestion {
  type: 'yesno';
  yesLabel?: string;
  noLabel?: string;
}

export interface NumberQuestion extends BaseQuestion {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  /** Whole numbers only. */
  integer?: boolean;
  /** Shown after the box, e.g. "years" or "%". */
  unit?: string;
  placeholder?: string;
}

/** A calendar date, stored as an ISO YYYY-MM-DD string. */
export interface DateQuestion extends BaseQuestion {
  type: 'date';
  /** Earliest / latest acceptable date, ISO YYYY-MM-DD. */
  min?: string;
  max?: string;
}

export interface EmailQuestion extends BaseQuestion {
  type: 'email';
  placeholder?: string;
}

export interface SliderQuestion extends BaseQuestion {
  type: 'slider';
  /** Defaults 0..100, step 1. */
  min?: number;
  max?: number;
  step?: number;
  lowLabel?: string;
  highLabel?: string;
  unit?: string;
}

/** Respondents put every option in order of preference. Stored as an ordered text[]. */
export interface RankingQuestion extends BaseQuestion {
  type: 'ranking';
  options: string[];
  /** Show the options in a different random order to each respondent. */
  randomize?: boolean;
}

export type Question =
  | TextQuestion
  | TextAreaQuestion
  | SelectQuestion
  | RadioQuestion
  | CheckboxQuestion
  | MatrixQuestion
  | RatingQuestion
  | NpsQuestion
  | YesNoQuestion
  | NumberQuestion
  | DateQuestion
  | EmailQuestion
  | SliderQuestion
  | RankingQuestion;

export interface Section {
  id: string;
  title: string;
  /** Optional paragraph under the heading. */
  intro?: string;
  /** Optional bordered callout, for scope notes and constraints. */
  note?: string;
  /** Skip the whole section unless this holds (display logic for a page). */
  showIf?: Logic;
  /** Skip logic: evaluated in order once the section is answered. Forward jumps only. */
  jumps?: SectionJump[];
  /** Show this section's questions in a different random order to each respondent. */
  randomizeQuestions?: boolean;
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
  /** `body` may pipe an answer in with {{answer:question_id}}. */
  thankYou: { heading: string; body: string };
  sections: Section[];
  /**
   * Translations for this survey's own strings, keyed by the English text, the
   * same shape the hand-written survey uses. Anything missing falls back to
   * English rather than showing a key.
   */
  i18n?: Record<string, { ta?: string; hi?: string }>;
  /**
   * Answer used to enforce one response per person. Its column gets a unique
   * constraint, and a repeat submission is reported back as a duplicate.
   */
  uniqueBy?: string;
}

/** Everything a respondent has answered so far, keyed by question id. */
export type Answers = Record<string, AnswerValue>;

export type AnswerValue = string | string[] | Record<string, string> | undefined;
