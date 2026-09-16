/**
 * Flattens a survey definition into "one entry per analyzable column", with
 * the human label and enough type information for Analytics/Response Centre
 * to decide how to render each one (Part 6). A matrix question becomes one
 * entry per row, since each row is its own database column.
 */
import { defaultColumn, matrixColumn } from '../engine/definition.ts';
import type { Question, SurveyDefinition } from '../engine/types.ts';

export type AnalysisKind = 'choice' | 'multiselect' | 'matrix-row' | 'text';

export interface ColumnMeta {
  column: string;
  label: string;
  kind: AnalysisKind;
  questionId: string;
  sectionTitle: string;
  options?: string[];
  scale?: string[]; // matrix-row only
}

export function questionColumns(def: SurveyDefinition): ColumnMeta[] {
  const out: ColumnMeta[] = [];
  for (const section of def.sections) {
    for (const q of section.questions) {
      out.push(...columnsForQuestion(q, section.title));
    }
  }
  return out;
}

function columnsForQuestion(q: Question, sectionTitle: string): ColumnMeta[] {
  switch (q.type) {
    case 'radio':
    case 'select':
      return [{ column: q.column || defaultColumn(q.id), label: q.label, kind: 'choice', questionId: q.id, sectionTitle, options: q.options }];
    case 'checkbox':
      return [{ column: q.column || defaultColumn(q.id), label: q.label, kind: 'multiselect', questionId: q.id, sectionTitle, options: q.options }];
    case 'text':
    case 'textarea':
      return [{ column: q.column || defaultColumn(q.id), label: q.label, kind: 'text', questionId: q.id, sectionTitle }];
    case 'matrix': {
      // Every rowsByAnswer variant can appear in real data (different
      // respondents saw different rows), so the label list is the union -
      // duplicates by row text collapse to one label per column position,
      // matching how buildRow() itself is positional. The variants are
      // checked before the bare `rows` fallback: per the engine's own type
      // comment, `rows` is only used "for an answer with no entry" in the
      // map, so it is the least representative label for what most
      // respondents at that position actually answered against.
      const variants = [...Object.values(q.rowsByAnswer?.map ?? {}), q.rows];
      const width = Math.max(...variants.map(v => v.length));
      const rowLabelAt = (i: number): string => {
        for (const variant of variants) {
          if (variant[i]) return variant[i];
        }
        return `Row ${i + 1}`;
      };
      return Array.from({ length: width }, (_, i) => ({
        column: matrixColumn(q.columnPrefix, i),
        label: rowLabelAt(i),
        kind: 'matrix-row' as const,
        questionId: q.id,
        sectionTitle,
        scale: q.scale,
      }));
    }
  }
}

/** Groups matrix-row columns back under their parent question, for display as one grid rather than N separate bars. */
export function groupMatrixRows(columns: ColumnMeta[]): Map<string, ColumnMeta[]> {
  const map = new Map<string, ColumnMeta[]>();
  for (const c of columns) {
    if (c.kind !== 'matrix-row') continue;
    const list = map.get(c.questionId) ?? [];
    list.push(c);
    map.set(c.questionId, list);
  }
  return map;
}
