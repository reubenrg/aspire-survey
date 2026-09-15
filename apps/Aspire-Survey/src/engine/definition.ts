import type {
  Answers,
  AnswerValue,
  MatrixQuestion,
  Question,
  Section,
  SurveyDefinition,
} from './types';

/** snake_case column name derived from a question id, when none is given. */
export function defaultColumn(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function tableNameFor(def: SurveyDefinition): string {
  return def.tableName || `survey_${def.slug.replace(/-/g, '_')}`;
}

export function matrixColumn(prefix: string, index: number): string {
  return `${prefix}_${String(index + 1).padStart(2, '0')}`;
}

/** The rows a matrix should show, honouring a `rowsByAnswer` switch. */
export function matrixRows(q: MatrixQuestion, answers: Answers): string[] {
  if (!q.rowsByAnswer) return q.rows;
  const key = answers[q.rowsByAnswer.questionId];
  if (typeof key === 'string' && q.rowsByAnswer.map[key]) return q.rowsByAnswer.map[key];
  return q.rows;
}

export function matrixTitle(q: MatrixQuestion, answers: Answers): string | undefined {
  if (!q.titleByAnswer) return undefined;
  const key = answers[q.rowsByAnswer?.questionId ?? ''];
  return typeof key === 'string' ? q.titleByAnswer[key] : undefined;
}

/** Whether a question's `showIf` condition is currently satisfied. */
export function isVisible(q: Question, answers: Answers): boolean {
  if (!q.showIf) return true;
  const other = answers[q.showIf.questionId];
  return typeof other === 'string' && q.showIf.equals.includes(other);
}

export function visibleQuestions(section: Section, answers: Answers): Question[] {
  return section.questions.filter(q => isVisible(q, answers));
}

function isBlank(q: Question, value: AnswerValue, answers: Answers): boolean {
  if (q.type === 'matrix') {
    const rows = matrixRows(q, answers);
    const given = (value as Record<string, string>) || {};
    return rows.some(row => !given[row]);
  }
  if (q.type === 'checkbox') return !Array.isArray(value) || value.length === 0;
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Ids of the questions in this section that are required, visible and unanswered.
 * A hidden question never blocks, so a conditional follow-up cannot trap someone
 * who changed their mind about the answer that revealed it.
 */
export function missingAnswers(section: Section, answers: Answers): string[] {
  return visibleQuestions(section, answers)
    .filter(q => q.required && isBlank(q, answers[q.id], answers))
    .map(q => q.id);
}

/** Free-text companion for an 'Other' choice, kept under a derived key. */
export function otherKey(questionId: string): string {
  return `${questionId}__other`;
}

/**
 * Flatten answers into the row written to the survey's table. Questions that
 * are not visible contribute null, so an abandoned conditional branch does not
 * leave a stale value behind.
 */
export function buildRow(def: SurveyDefinition, answers: Answers): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const section of def.sections) {
    for (const q of section.questions) {
      const visible = isVisible(q, answers);
      const value = visible ? answers[q.id] : undefined;

      if (q.type === 'matrix') {
        const rows = matrixRows(q, answers);
        const given = (value as Record<string, string>) || {};
        rows.forEach((rowLabel, i) => {
          row[matrixColumn(q.columnPrefix, i)] = given[rowLabel] ?? null;
        });
        continue;
      }

      const column = q.column || defaultColumn(q.id);
      if (q.type === 'checkbox') {
        row[column] = Array.isArray(value) ? value : [];
      } else {
        row[column] = typeof value === 'string' && value.trim() !== '' ? value : null;
      }

      if ((q.type === 'radio' || q.type === 'checkbox') && q.otherColumn) {
        const chose = q.type === 'checkbox'
          ? Array.isArray(value) && value.includes('Other')
          : value === 'Other';
        const text = answers[otherKey(q.id)];
        row[q.otherColumn] = visible && chose && typeof text === 'string' && text.trim() !== '' ? text : null;
      }
    }
  }

  return row;
}

/** Every column the definition writes, in order. Used by the SQL generator. */
export function columnsFor(def: SurveyDefinition): { name: string; type: 'text' | 'text[]' }[] {
  const cols: { name: string; type: 'text' | 'text[]' }[] = [];
  for (const section of def.sections) {
    for (const q of section.questions) {
      if (q.type === 'matrix') {
        const width = Math.max(
          q.rows.length,
          ...Object.values(q.rowsByAnswer?.map ?? {}).map(r => r.length),
        );
        for (let i = 0; i < width; i++) cols.push({ name: matrixColumn(q.columnPrefix, i), type: 'text' });
        continue;
      }
      cols.push({ name: q.column || defaultColumn(q.id), type: q.type === 'checkbox' ? 'text[]' : 'text' });
      if ((q.type === 'radio' || q.type === 'checkbox') && q.otherColumn) {
        cols.push({ name: q.otherColumn, type: 'text' });
      }
    }
  }
  return cols;
}
