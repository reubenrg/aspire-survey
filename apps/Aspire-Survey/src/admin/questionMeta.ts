/**
 * Flattens a survey definition into "one entry per analyzable column", with
 * the human label and enough type information for Analytics/Response Centre
 * to decide how to render each one (Part 6). A matrix question becomes one
 * entry per row, since each row is its own database column.
 */
import { defaultColumn, matrixColumn } from '../engine/definition.ts';
import { stripPipes } from '../engine/logic.ts';
import type { Question, SurveyDefinition } from '../engine/types.ts';

export type AnalysisKind =
  | 'choice'
  | 'multiselect'
  | 'matrix-row'
  | 'text'
  /** number, slider: a distribution and summary statistics. */
  | 'numeric'
  /** 1..max rating: mean plus a distribution over the scale. */
  | 'rating'
  /** 0..10 Net Promoter Score: promoters, passives, detractors. */
  | 'nps'
  /** Ordered text[]: average position per option. */
  | 'ranking'
  /** Answers that identify a person (email). Never aggregated or listed. */
  | 'identifier';

export interface ColumnMeta {
  column: string;
  label: string;
  kind: AnalysisKind;
  questionId: string;
  sectionTitle: string;
  options?: string[];
  scale?: string[]; // matrix-row only
  /** rating: the top of the scale. */
  max?: number;
  /** The question type, for anything that needs more than `kind`. */
  type?: Question['type'];
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
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'choice', questionId: q.id, sectionTitle, options: q.options }];
    case 'checkbox':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'multiselect', questionId: q.id, sectionTitle, options: q.options }];
    case 'yesno':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'choice', questionId: q.id, sectionTitle, options: ['Yes', 'No'], type: q.type }];
    case 'ranking':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'ranking', questionId: q.id, sectionTitle, options: q.options, type: q.type }];
    case 'rating':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'rating', questionId: q.id, sectionTitle, max: q.max ?? 5, type: q.type }];
    case 'nps':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'nps', questionId: q.id, sectionTitle, type: q.type }];
    case 'number':
    case 'slider':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'numeric', questionId: q.id, sectionTitle, type: q.type }];
    case 'email':
    case 'phone':
    case 'fullname':
    case 'file':
    case 'signature':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'identifier', questionId: q.id, sectionTitle, type: q.type }];
    case 'heading':
      return [];
    case 'image':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: q.multiple ? 'multiselect' : 'choice', questionId: q.id, sectionTitle, options: q.options, type: q.type }];
    case 'sum':
      return q.rows.map((row, i) => ({
        column: matrixColumn(q.columnPrefix, i), label: `${stripPipes(q.label)} - ${row}`, kind: 'numeric' as const, questionId: q.id, sectionTitle, type: q.type,
      }));
    case 'multitext':
      return q.rows.map((row, i) => ({
        column: matrixColumn(q.columnPrefix, i), label: `${stripPipes(q.label)} - ${row}`, kind: 'identifier' as const, questionId: q.id, sectionTitle, type: q.type,
      }));
    case 'date':
    case 'text':
    case 'textarea':
      return [{ column: q.column || defaultColumn(q.id), label: stripPipes(q.label), kind: 'text', questionId: q.id, sectionTitle, type: q.type }];
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
