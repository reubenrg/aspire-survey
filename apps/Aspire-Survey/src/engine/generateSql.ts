import { columnsFor, defaultColumn, tableNameFor } from './definition.ts';
import type { SurveyDefinition } from './types';

export type PrivacyMode = 'ANONYMOUS' | 'ANONYMOUS_TRACKED' | 'CONFIDENTIAL';

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
 *
 * `privacyMode` defaults to ANONYMOUS, which reproduces exactly what this
 * function has always emitted - existing callers (the original /admin/:slug
 * editor) are unaffected. For ANONYMOUS_TRACKED and CONFIDENTIAL surveys,
 * three additional columns are emitted - resp_department, resp_location,
 * resp_designation - written at submission time from the respondent's
 * employee record (never from a client-supplied value), so Sprint 4's
 * segmentation can aggregate by department/location/designation without ever
 * joining a response row back to an employee. CONFIDENTIAL additionally gets
 * an employee_id column, since identity linkage is that mode's whole point -
 * but analyst-tier access is granted only on the non-identity columns; a
 * dedicated security-definer function (survey_response_page/_one) is the only
 * path to employee_id, and it checks can_view_identity() itself.
 */
export function generateCreateTableSql(def: SurveyDefinition, privacyMode: PrivacyMode = 'ANONYMOUS'): string {
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

  // Reserved system columns must never collide with a question's own column.
  // This is a real trap: a self-reported "Employee ID" question naturally
  // derives the column employee_id - exactly the name CONFIDENTIAL mode's
  // identity column needs. Invitation-based (TRACKED/CONFIDENTIAL) surveys
  // shouldn't ask respondents to self-report identity at all (the invitation
  // already carries it), but this checks for it regardless of whether that
  // convention was followed, the same way the duplicate-column check above
  // does not just trust the definition to be well-formed.
  const reserved = ['id', 'submitted_at', 'definition_version']
    .concat(privacyMode !== 'ANONYMOUS' ? ['resp_department', 'resp_location', 'resp_designation'] : [])
    .concat(privacyMode === 'CONFIDENTIAL' ? ['employee_id'] : []);
  for (const name of reserved) {
    if (seen.has(name)) {
      throw new Error(
        `A question writes to "${name}", which is reserved for ${privacyMode === 'CONFIDENTIAL' && name === 'employee_id' ? 'the respondent\'s identity' : 'Sprint 4 segmentation'} in ${privacyMode} mode. ` +
        `Invitation-based surveys should not ask respondents to self-report identity as a question - give it a different answer key.`,
      );
    }
  }

  const uniqueColumn = def.uniqueBy ? defaultColumn(def.uniqueBy) : null;
  // Whether anything (the segmentation/identity columns below) follows the
  // question-derived columns - if so, the last one of those still needs its
  // trailing comma, or the generated SQL is simply invalid.
  const moreColumnsFollow = privacyMode !== 'ANONYMOUS';
  // The identity column is the one thing that must always be present, since a
  // null there would defeat the unique constraint that enforces one response
  // per person. Everything else stays nullable: a required question can still
  // be legitimately empty when its showIf condition hid it.
  const body = columns.map((c, i) => {
    const last = !moreColumnsFollow && i === columns.length - 1;
    const comma = last ? '' : ',';
    const decl = c.type === 'text[]'
      ? `${c.name} text[] not null default '{}'`
      : `${c.name} text${c.name === uniqueColumn ? ' not null unique' : ''}`;
    return `  ${decl}${comma}`;
  });

  const tracked = privacyMode === 'ANONYMOUS_TRACKED' || privacyMode === 'CONFIDENTIAL';
  const confidential = privacyMode === 'CONFIDENTIAL';

  const identityLines = tracked ? [
    ``,
    `  -- Segmentation columns for Sprint 4 analytics. Written once, at`,
    `  -- submission time, from the respondent's employee record - never`,
    `  -- client-supplied, and never a join key back to that record.`,
    `  resp_department text,`,
    `  resp_location text,`,
    `  resp_designation text${confidential ? ',' : ''}`,
    ...(confidential ? [`  -- CONFIDENTIAL only: identity is the point of this mode. Direct`, `  -- analyst-tier access is still restricted to the columns above; see`, `  -- the grant below.`, `  employee_id uuid references public.employees(id)`] : []),
  ] : [];

  // Deliberately EXCLUDES resp_department/resp_location/resp_designation as
  // well as employee_id: none of the four should ever be reachable by a raw
  // REST/SQL SELECT, in ANONYMOUS_TRACKED as much as CONFIDENTIAL. Their only
  // legitimate path is through survey_segment_summary() (threshold-protected
  // aggregates) and, for identity, survey_response_page()/_one() gated on
  // can_view_identity(). A blanket grant here would let any analyst read a
  // one-person department straight off a response row - the exact indirect
  // re-identification Part 10 exists to prevent.
  const grantableColumns = ['id', 'submitted_at', 'definition_version', ...columns.map(c => c.name)];

  const lines = [
    `-- ${def.title}`,
    `-- Responses for the survey published at /s/${def.slug}`,
    `create table if not exists public.${table} (`,
    `  id uuid primary key default gen_random_uuid(),`,
    `  submitted_at timestamptz not null default now(),`,
    `  definition_version int,`,
    ...body,
    ...identityLines,
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
    ``,
    `-- Analysts and above may read responses. anon still cannot: there is no`,
    `-- select policy for it, so a respondent cannot read anybody's answers`,
    `-- including their own.`,
    `drop policy if exists "Analysts read responses" on public.${table};`,
    `create policy "Analysts read responses"`,
    `  on public.${table}`,
    `  for select`,
    `  to authenticated`,
    `  using (public.has_survey_role(`,
    `    (select s.organization_id from public.surveys s where s.table_name = '${table}'),`,
    `    'analyst'));`,
    ``,
    `-- A policy alone is not enough. PostgREST builds its schema cache from the`,
    `-- relations a role has privileges on, so without this grant the table is`,
    `-- invisible over the API and every request fails with PGRST205. Insert only:`,
    `-- no select grant, so responses stay unreadable even if a policy were added`,
    `-- by mistake later.`,
    `-- Supabase's default privileges grant ALL on a new public table to anon,`,
    `-- which would let the public key attempt update, delete and truncate.`,
    `-- Truncate in particular is not filtered by row level security at all.`,
    `-- Revoke first, then grant only what each role needs.`,
    `revoke all on public.${table} from anon;`,
    `grant insert on public.${table} to anon;`,
    `revoke all on public.${table} from authenticated;`,
    tracked
      ? `grant select (${grantableColumns.join(', ')}), insert on public.${table} to authenticated;`
      : `grant select, insert on public.${table} to authenticated;`,
    ...(tracked ? [
      ``,
      `-- resp_department/resp_location/resp_designation${confidential ? ' and employee_id are' : ' are'} deliberately NOT`,
      `-- granted to authenticated above: an analyst must not be able to pull`,
      `-- them with a raw REST query and re-identify a small group by reading`,
      `-- rows directly. Segment aggregates go through survey_segment_summary()`,
      `-- (threshold-protected)${confidential ? ', and identity through survey_response_page()/survey_response_one() (can_view_identity()-gated)' : ''}.`,
    ] : []),
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

export function generateFullSql(def: SurveyDefinition, privacyMode: PrivacyMode = 'ANONYMOUS'): string {
  return `${generateCreateTableSql(def, privacyMode)}\n${generateUpsertSql(def)}`;
}
