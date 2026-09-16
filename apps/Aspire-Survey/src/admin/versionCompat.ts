/**
 * Part 13: "if question structure changed between versions, do not silently
 * combine incompatible questions." Reuses engine/definition.ts's columnsFor -
 * the same function that decides what a version actually wrote to the
 * database - rather than inventing a second notion of "the same question".
 */
import { columnsFor } from '../engine/definition.ts';
import type { SurveyDefinition } from '../engine/types.ts';

export interface VersionDef {
  version_number: number;
  definition: SurveyDefinition;
}

/**
 * Which versions wrote a given column with the same storage shape a current
 * definition does. A version that never had the column, or had it as a
 * different type (text vs text[] - a checkbox question replacing a radio
 * one, say), is excluded: combining them would silently mix an "options
 * chosen" array with a single free value.
 */
export function compatibleVersions(versions: VersionDef[], columnName: string, columnType: 'text' | 'text[]'): number[] {
  return versions
    .filter(v => {
      const col = columnsFor(v.definition).find(c => c.name === columnName);
      return col !== undefined && col.type === columnType;
    })
    .map(v => v.version_number);
}

/** True when every version in the set (that has the column at all) agrees on its type. */
export function isColumnCompatibleAcrossAllVersions(versions: VersionDef[], columnName: string): boolean {
  const types = new Set(
    versions
      .map(v => columnsFor(v.definition).find(c => c.name === columnName)?.type)
      .filter((t): t is 'text' | 'text[]' => t !== undefined),
  );
  return types.size <= 1;
}
