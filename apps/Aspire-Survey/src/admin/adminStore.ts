import { supabase } from '../lib/supabase';
import { tableNameFor } from '../engine/definition';
import type { SurveyDefinition } from '../engine/types';

export type Role = 'viewer' | 'analyst' | 'editor' | 'owner';

/** Ranking mirrors survey_role_rank() in the database. Keep the two in step. */
const RANK: Record<Role, number> = { viewer: 1, analyst: 2, editor: 3, owner: 4 };

export function atLeast(role: Role | null, minimum: Role): boolean {
  return role !== null && RANK[role] >= RANK[minimum];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

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
  'id, slug, title, definition, table_name, published, organization_id, current_version, closed_at, updated_at';

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code === '42501') {
    throw new Error(`You do not have permission to ${action}.`);
  }
  throw new Error(error.message);
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
