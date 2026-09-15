/**
 * Emit the SQL for a survey definition.
 *
 *   npm run gen:sql -- demo
 *
 * Prints the create-table statement for that survey's responses plus the
 * insert that registers it in `surveys`. Run the output in the Supabase SQL
 * editor. Nothing here touches the database: generating and applying are kept
 * separate on purpose, so a schema change is always something a person read
 * first.
 */
import { readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { generateFullSql } from '../Aspire-Survey/src/engine/generateSql.ts';
import type { SurveyDefinition } from '../Aspire-Survey/src/engine/types';

const SURVEYS_DIR = join(import.meta.dirname, '../Aspire-Survey/src/surveys');

async function main() {
  const name = process.argv[2];
  if (!name) {
    const available = readdirSync(SURVEYS_DIR)
      .filter(f => f.endsWith('.ts'))
      .map(f => f.replace(/\.ts$/, ''));
    console.error('Usage: npm run gen:sql -- <survey>');
    console.error(`Available: ${available.join(', ') || '(none)'}`);
    process.exit(1);
  }

  const mod = await import(pathToFileURL(join(SURVEYS_DIR, `${name}.ts`)).href);
  const def = (Object.values(mod).find(
    v => v && typeof v === 'object' && 'slug' in (v as object) && 'sections' in (v as object),
  ) ?? null) as SurveyDefinition | null;

  if (!def) {
    console.error(`No survey definition exported from surveys/${name}.ts`);
    process.exit(1);
  }

  process.stdout.write(generateFullSql(def));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
