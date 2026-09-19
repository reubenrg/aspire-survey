import { columnsFor, defaultColumn, matrixColumn } from './definition.ts';
import type { Question, SurveyDefinition } from './types';

export interface AdditiveIssue {
  /** Blocking issues make the survey unsaveable; warnings are advisory. */
  severity: 'error' | 'warning';
  /** What the person should look at, e.g. a question id or a matrix row. */
  subject: string;
  message: string;
}

/** Every question in the survey, flattened across sections, in reading order. */
export function allQuestions(def: SurveyDefinition): Question[] {
  return def.sections.flatMap(s => s.questions);
}

function columnOf(q: Question): string {
  return q.type === 'matrix' || q.type === 'sum' || q.type === 'multitext' ? q.columnPrefix : (q.column || defaultColumn(q.id));
}

/** text[] for multi-select, text for everything else. Changing this breaks the column. */
function storageOf(q: Question): 'text' | 'text[]' {
  return q.type === 'checkbox' || q.type === 'ranking' || (q.type === 'image' && !!q.multiple) ? 'text[]' : 'text';
}

const SHAPE_LABEL = { text: 'a text column', list: 'a text[] column', rows: 'one column per row', none: 'no column' } as const;

/** How a question's answer is laid out in the table: one text column, one list column, one column per row, or nothing. */
function shapeOf(q: Question): 'text' | 'list' | 'rows' | 'none' {
  if (q.type === 'heading') return 'none';
  if (q.type === 'matrix' || q.type === 'sum' || q.type === 'multitext') return 'rows';
  return storageOf(q) === 'text[]' ? 'list' : 'text';
}

/**
 * Compare a proposed definition against the one responses were collected under.
 *
 * The rule is additive-only, and it exists because of how matrix answers are
 * stored: each row writes to a column numbered by its POSITION, so
 * `prefix_02` means "whatever the second row happened to be". Deleting or
 * reordering a row silently reassigns what an existing column holds. Nothing
 * errors, and the damage is invisible until someone reads the data months
 * later. The same logic applies to a question's id, which determines its
 * column name.
 *
 * Adding is always safe: new questions and new matrix rows take new columns,
 * and new options are just new values in an existing one.
 */
export function validateAdditive(
  previous: SurveyDefinition,
  next: SurveyDefinition,
  hasResponses: boolean,
): AdditiveIssue[] {
  if (!hasResponses) return [];

  const issues: AdditiveIssue[] = [];
  const before = allQuestions(previous);
  const after = allQuestions(next);
  const afterById = new Map(after.map(q => [q.id, q]));

  for (const old of before) {
    const now = afterById.get(old.id);

    if (!now) {
      issues.push({
        severity: 'error',
        subject: old.id,
        message: `Question "${old.label || old.id}" was removed, but answers are already stored in ${columnOf(old)}. Existing responses would lose their meaning.`,
      });
      continue;
    }

    if (now.type !== old.type && old.type !== 'heading' && shapeOf(now) !== shapeOf(old)) {
      issues.push({
        severity: 'error',
        subject: old.id,
        message: `"${old.label || old.id}" changed from ${old.type} to ${now.type}, which stores its answer differently (${SHAPE_LABEL[shapeOf(old)]} instead of ${SHAPE_LABEL[shapeOf(now)]}). Answers already collected would be stranded. Add a new question instead.`,
      });
    }

    if (columnOf(now) !== columnOf(old)) {
      issues.push({
        severity: 'error',
        subject: old.id,
        message: `"${old.label || old.id}" now writes to ${columnOf(now)} instead of ${columnOf(old)}. Answers already in the old column would be stranded.`,
      });
    }

    if ((old.type === 'matrix' || old.type === 'sum' || old.type === 'multitext') && now.type === old.type) {
      // Position is the whole contract here, so compare index by index.
      old.rows.forEach((row, i) => {
        if (now.rows[i] === row) return;
        const where = matrixColumn(old.columnPrefix, i);
        if (!now.rows.includes(row)) {
          issues.push({
            severity: 'error',
            subject: `${old.id} · ${row}`,
            message: `Statement "${row}" was removed. Answers to it are in ${where}, which would now be read as "${now.rows[i] ?? 'nothing'}".`,
          });
        } else {
          issues.push({
            severity: 'error',
            subject: `${old.id} · ${row}`,
            message: `Statement "${row}" moved from position ${i + 1} to ${now.rows.indexOf(row) + 1}. ${where} already holds answers to it and would silently start meaning a different statement.`,
          });
        }
      });

      // Compared as JSON so ['ab','c'] and ['a','bc'] cannot look identical.
      if (old.type === 'matrix' && now.type === 'matrix' && JSON.stringify(old.scale) !== JSON.stringify(now.scale)) {
        issues.push({
          severity: 'warning',
          subject: old.id,
          message: `The scale for "${old.label || old.id}" changed. Existing rows keep the old labels, so this question will have mixed values across versions.`,
        });
      }
    }

    if ('options' in old && 'options' in now) {
      const dropped = old.options.filter(o => !now.options.includes(o));
      if (dropped.length > 0) {
        issues.push({
          severity: 'warning',
          subject: old.id,
          message: `Removed ${dropped.length === 1 ? 'the option' : 'options'} ${dropped.map(o => `"${o}"`).join(', ')} from "${old.label || old.id}". Responses already holding ${dropped.length === 1 ? 'that value' : 'those values'} are kept, so the data will contain values no longer offered.`,
        });
      }
    }
  }

  if (previous.uniqueBy !== next.uniqueBy) {
    issues.push({
      severity: 'error',
      subject: 'uniqueBy',
      message: 'The question used to enforce one response per person changed. That column carries a unique constraint that would have to be rebuilt against data already collected.',
    });
  }

  return issues;
}

/**
 * Columns a new version needs that the table does not have yet, as ALTER
 * statements. The additive rule means this is the only schema change a version
 * bump can require.
 */
export function migrationForNewColumns(
  previous: SurveyDefinition,
  next: SurveyDefinition,
  tableName: string,
): string {
  const had = new Set(columnsFor(previous).map(c => c.name));
  const added = columnsFor(next).filter(c => !had.has(c.name));
  if (added.length === 0) return '';

  const lines = added.map(c =>
    c.type === 'text[]'
      ? `alter table public.${tableName} add column if not exists ${c.name} text[] not null default '{}';`
      : `alter table public.${tableName} add column if not exists ${c.name} text;`,
  );

  return [
    `-- New columns for "${next.title}". Existing rows keep null for these,`,
    `-- which correctly says the question was not asked when they answered.`,
    ...lines,
    ``,
    `notify pgrst, 'reload schema';`,
  ].join('\n');
}
