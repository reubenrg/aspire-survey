import { supabase } from '../lib/supabase';
import { tableNameFor } from '../engine/definition';
import type { SurveyDefinition } from '../engine/types';
import { atLeast, type PrivacyMode, type Role } from './labels';
import { duplicateSlug, duplicateTitle } from './duplication';
import { toDomainError } from './domainError';

// Role and atLeast are pure (no Supabase dependency) and live in labels.ts so
// they can be unit tested without a database; re-exported here since this is
// where the rest of the app has always imported them from.
export { atLeast, type Role };

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export const SURVEY_CATEGORIES = [
  'Employee Feedback',
  'Engagement',
  'Performance Assessment',
  'Training Effectiveness',
  'Habit Formation Impact',
  'Behaviour Change',
  'Manager Feedback',
  'Custom',
] as const;

export interface SurveyRow {
  id: string;
  slug: string;
  title: string;
  definition: SurveyDefinition;
  table_name: string;
  published: boolean;
  organization_id: string | null;
  current_version: number;
  closed_at: string | null;
  archived_at: string | null;
  privacy_mode: PrivacyMode;
  category: string | null;
  purpose: string | null;
  created_by: string | null;
  updated_at: string;
}

export interface SurveyVersion {
  version_number: number;
  definition: SurveyDefinition;
  created_by: string | null;
  created_at: string;
}

export interface OrganizationGroup {
  organization: Organization | null;
  surveys: SurveyRow[];
}

const SURVEY_COLUMNS =
  'id, slug, title, definition, table_name, published, organization_id, current_version, closed_at, archived_at, privacy_mode, category, purpose, created_by, updated_at';

function fail(error: { code?: string; message: string }, action: string): never {
  throw toDomainError(error, action);
}

// ── roles ──────────────────────────────────────────────────────────────────

/**
 * The signed-in user's role for one organization, or their global role when
 * given null. Resolved in the database, because survey_members has no read
 * policy: the roster stays private and only the definer function can see it.
 */
export async function fetchRole(organizationId: string | null): Promise<Role | null> {
  const { data, error } = await supabase.rpc('get_user_role', { target_org_id: organizationId });
  if (error) throw new Error(error.message);
  return (data as Role | null) ?? null;
}

/** Roles for every organization at once, so the dashboard can render in one pass. */
export async function fetchRoleMap(orgIds: string[]): Promise<Record<string, Role | null>> {
  const entries = await Promise.all(
    orgIds.map(async id => [id, await fetchRole(id)] as const),
  );
  return Object.fromEntries(entries);
}

// ── organizations ──────────────────────────────────────────────────────────

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, created_at')
    .order('name');
  if (error) fail(error, 'view organizations');
  return (data ?? []) as Organization[];
}

export function slugify(value: string): string {
  return value
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export async function createOrganization(name: string): Promise<Organization> {
  const slug = slugify(name);
  if (!slug) throw new Error('Give the organization a name using letters or numbers.');

  const { data, error } = await supabase
    .from('organizations')
    .insert({ name: name.trim(), slug })
    .select('id, name, slug, created_at')
    .single();

  if (error) {
    if (error.code === '23505') throw new Error(`An organization called "${name}" already exists.`);
    fail(error, 'create an organization');
  }
  return data as Organization;
}

// ── surveys ────────────────────────────────────────────────────────────────

export async function listSurveys(): Promise<SurveyRow[]> {
  const { data, error } = await supabase
    .from('surveys')
    .select(SURVEY_COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) fail(error, 'view surveys');
  return (data ?? []) as SurveyRow[];
}

/**
 * Surveys arranged into their organization folders. Organizations with no
 * surveys still appear, so a newly created folder is visible rather than
 * silently absent, and anything unfiled collects in a trailing group.
 */
export function groupByOrganization(
  surveys: SurveyRow[],
  organizations: Organization[],
): OrganizationGroup[] {
  const groups: OrganizationGroup[] = organizations.map(organization => ({
    organization,
    surveys: surveys.filter(s => s.organization_id === organization.id),
  }));

  const unfiled = surveys.filter(
    s => !s.organization_id || !organizations.some(o => o.id === s.organization_id),
  );
  if (unfiled.length > 0) groups.push({ organization: null, surveys: unfiled });

  return groups;
}

export async function getSurvey(slug: string): Promise<SurveyRow | null> {
  const { data, error } = await supabase
    .from('surveys')
    .select(SURVEY_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) fail(error, 'open this survey');
  return (data as SurveyRow) ?? null;
}

/**
 * Creates the survey row the Create Survey wizard produces: a draft with no
 * questions of its own yet beyond the blank starting point, filed under a
 * customer, with the category and privacy mode decided up front because both
 * are awkward to change honestly once responses exist.
 */
export async function createSurveyDraft(input: {
  definition: SurveyDefinition;
  organizationId: string;
  privacyMode: PrivacyMode;
  category: string;
  purpose: string;
}): Promise<SurveyRow> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('surveys')
    .insert({
      slug: input.definition.slug,
      title: input.definition.title,
      definition: input.definition,
      table_name: tableNameFor(input.definition),
      published: false,
      organization_id: input.organizationId,
      current_version: 1,
      privacy_mode: input.privacyMode,
      category: input.category || null,
      purpose: input.purpose || null,
      created_by: user?.email ?? null,
    })
    .select(SURVEY_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') throw new Error(`A survey already exists at "/s/${input.definition.slug}".`);
    fail(error, 'create this survey');
  }

  await supabase.from('survey_versions').insert({
    survey_id: (data as SurveyRow).id,
    version_number: 1,
    definition: input.definition,
    created_by: user?.email ?? null,
  });

  return data as SurveyRow;
}

/**
 * Copies a survey's definition, questions and settings into a fresh draft.
 * Never copies responses, invitations or the audience: a duplicate is a new
 * survey that happens to start from the same shape, not a clone of live data.
 */
export async function duplicateSurvey(row: SurveyRow): Promise<SurveyRow> {
  const organizationId = row.organization_id;
  if (!organizationId) throw new Error('This survey has no customer to duplicate it into.');
  const title = duplicateTitle(row.title);
  let slug = duplicateSlug(row.title, row.slug, slugify);
  // A slug collision is likely for a straight duplicate; fall back to one
  // that is certain to be free rather than asking the admin to retype it.
  const { data: clash } = await supabase.from('surveys').select('id').eq('slug', slug).maybeSingle();
  if (clash) slug = `${slug}-${Date.now().toString(36)}`;

  const definition: SurveyDefinition = { ...row.definition, slug, title };
  return createSurveyDraft({
    definition,
    organizationId,
    privacyMode: row.privacy_mode,
    category: row.category ?? '',
    purpose: row.purpose ?? '',
  });
}

/** Flips published on its own, without touching the definition or bumping its version. */
export async function setPublished(slug: string, published: boolean): Promise<void> {
  // Publishing from here skips the Builder entirely, so it needs the same
  // response-table provisioning the Builder's Publish does - and, like there,
  // it has to happen BEFORE the survey goes live, so a failure can never
  // leave a published survey with nowhere to store answers.
  if (published) {
    const { data } = await supabase.from('surveys').select('id').eq('slug', slug).maybeSingle();
    if (!data) throw new Error(`No survey called "${slug}".`);
    const { error: tableError } = await supabase.rpc('ensure_survey_response_table', {
      p_survey_id: data.id, p_definition: null,
    });
    if (tableError) {
      throw new Error(
        `This survey's response table could not be set up: ${tableError.message}. ` +
        'Nothing was published, because a live survey with nowhere to store answers would silently lose every response.',
      );
    }
  }

  const { error } = await supabase
    .from('surveys')
    .update({ published, updated_at: new Date().toISOString() })
    .eq('slug', slug);
  if (error) fail(error, published ? 'publish this survey' : 'unpublish this survey');
}

/** Archiving is the end of a survey's lifecycle; the row and its responses stay. */
export async function setArchived(slug: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('surveys')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('slug', slug);
  if (error) fail(error, 'archive this survey');
}

/**
 * Save a survey, snapshotting the definition as a new version when it changed.
 *
 * The snapshot is written first. If it fails, nothing has moved; if the survey
 * update then fails, there is a spare snapshot rather than a version number
 * pointing at a definition nobody kept. Erring towards a harmless extra row is
 * the right way round when the alternative is losing history.
 */
export async function saveSurvey(
  def: SurveyDefinition,
  published: boolean,
  organizationId: string | null,
  options: { surveyId?: string; previous?: SurveyDefinition; currentVersion?: number } = {},
): Promise<number> {
  const changed =
    options.previous === undefined ||
    JSON.stringify(options.previous) !== JSON.stringify(def);
  const version = changed ? (options.currentVersion ?? 0) + 1 : (options.currentVersion ?? 1);

  if (changed && options.surveyId) {
    const { error: vErr } = await supabase.from('survey_versions').insert({
      survey_id: options.surveyId,
      version_number: version,
      definition: def,
      created_by: (await supabase.auth.getUser()).data.user?.email ?? null,
    });
    if (vErr && vErr.code !== '23505') fail(vErr, 'record a new version of this survey');
  }

  const { error } = await supabase.from('surveys').upsert(
    {
      slug: def.slug,
      title: def.title,
      definition: def,
      table_name: tableNameFor(def),
      published,
      organization_id: organizationId,
      current_version: version,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'slug' },
  );
  if (error) fail(error, 'save surveys in this organization');
  return version;
}

export async function listVersions(surveyId: string): Promise<SurveyVersion[]> {
  const { data, error } = await supabase
    .from('survey_versions')
    .select('version_number, definition, created_by, created_at')
    .eq('survey_id', surveyId)
    .order('version_number', { ascending: false });
  if (error) fail(error, 'view the version history');
  return (data ?? []) as SurveyVersion[];
}

export async function deleteSurvey(slug: string): Promise<void> {
  const { error } = await supabase.from('surveys').delete().eq('slug', slug);
  if (error) fail(error, 'delete this survey');
}

/**
 * How many responses a survey has.
 *
 * Goes through a security definer function rather than a select, because
 * response tables deliberately have no read policy. A count is not a response,
 * so this is the one thing about collected answers a non-analyst may learn.
 * Null means the survey has no table yet, or the caller has no role on it.
 */
export async function countResponses(slug: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('survey_response_count', { p_slug: slug });
  if (error) return null;
  return data === null ? null : Number(data);
}
