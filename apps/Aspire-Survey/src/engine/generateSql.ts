import { columnsFor, defaultColumn, tableNameFor } from './definition.ts';
import type { SurveyDefinition } from './types';

/** Postgres identifiers we generate must be safe to interpolate. */
function assertIdentifier(name: string, what: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`${what} "${name}" is not a valid lowercase identifier.`);
  }
}

/**
 * The `create table` statement for one survey's responses, plus the row level
 * security policy that lets anonymous respondents insert and nobody read.
 *
 * Deliberately no SELECT policy: responses must not be readable with the
 * browser key. That is also why the client inserts without asking for the row
 * back, since a returning clause would need SELECT permission and would fail.
 */
export function generateCreateTableSql(def: SurveyDefinition): string {
  const table = tableNameFor(def);
  assertIdentifier(table, 'Table name');

  const columns = columnsFor(def);
  const seen = new Set<string>();
  for (const c of columns) {
    assertIdentifier(c.name, 'Column name');
    if (seen.has(c.name)) {
      throw new Error(`Two questions both write to the column "${c.name}". Give one a different id.`);
    }
    seen.add(c.name);
  }

  const uniqueColumn = def.uniqueBy ? defaultColumn(def.uniqueBy) : null;
  // The identity column is the one thing that must always be present, since a
  // null there would defeat the unique constraint that enforces one response
  // per person. Everything else stays nullable: a required question can still
  // be legitimately empty when its showIf condition hid it.
  const body = columns.map((c, i) => {
    const last = i === columns.length - 1;
    const comma = last ? '' : ',';
    const decl = c.type === 'text[]'
      ? `${c.name} text[] not null default '{}'`
      : `${c.name} text${c.name === uniqueColumn ? ' not null unique' : ''}`;
    return `  ${decl}${comma}`;
  });

  const lines = [
    `-- ${def.title}`,
    `-- Responses for the survey published at /s/${def.slug}`,
    `create table if not exists public.${table} (`,
    `  id uuid primary key default gen_random_uuid(),`,
    `  submitted_at timestamptz not null default now(),`,
    `  definition_version int,`,
    ...body,
    `);`,
    ``,
    `alter table public.${table} enable row level security;`,
    ``,
    `-- Respondents may add a response and nothing else. There is no select`,
    `-- policy on purpose, so answers cannot be read back with the public key.`,
    `drop policy if exists "Public can submit responses" on public.${table};`,
    `create policy "Public can submit responses"`,
    `  on public.${table}`,
    `  for insert`,
    `  to anon`,
    `  with check (true);`,
    ``,
    `-- A policy alone is not enough. PostgREST builds its schema cache from the`,
    `-- relations a role has privileges on, so without this grant the table is`,
    `-- invisible over the API and every request fails with PGRST205. Insert only:`,
    `-- no select grant, so responses stay unreadable even if a policy were added`,
    `-- by mistake later.`,
    `grant insert on public.${table} to anon, authenticated;`,
  ];

  if (uniqueColumn) {
    lines.splice(1, 0, `-- One response per ${uniqueColumn}.`);
  }

  return lines.join('\n') + '\n';
}

/** Statement that registers (or updates) the survey so /s/<slug> can find it. */
export function generateUpsertSql(def: SurveyDefinition): string {
  const table = tableNameFor(def);
  const json = JSON.stringify(def).replace(/'/g, "''");
  return [
    `insert into public.surveys (slug, title, definition, table_name, published)`,
    `values ('${def.slug}', '${def.title.replace(/'/g, "''")}', '${json}'::jsonb, '${table}', true)`,
    `on conflict (slug) do update set`,
    `  title = excluded.title,`,
    `  definition = excluded.definition,`,
    `  table_name = excluded.table_name,`,
    `  published = excluded.published,`,
    `  updated_at = now();`,
  ].join('\n') + '\n';
}

export function generateFullSql(def: SurveyDefinition): string {
  return `${generateCreateTableSql(def)}\n${generateUpsertSql(def)}`;
}
