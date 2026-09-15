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
  updated_at: string;
}

export interface OrganizationGroup {
  organization: Organization | null;
  surveys: SurveyRow[];
}

const SURVEY_COLUMNS =
  'id, slug, title, definition, table_name, published, organization_id, updated_at';

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

export async function saveSurvey(
  def: SurveyDefinition,
  published: boolean,
  organizationId: string | null,
): Promise<void> {
  const { error } = await supabase.from('surveys').upsert(
    {
      slug: def.slug,
      title: def.title,
      definition: def,
      table_name: tableNameFor(def),
      published,
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'slug' },
  );
  if (error) fail(error, 'save surveys in this organization');
}

export async function deleteSurvey(slug: string): Promise<void> {
  const { error } = await supabase.from('surveys').delete().eq('slug', slug);
  if (error) fail(error, 'delete this survey');
}

/**
 * How many responses a survey has. Null when the response table does not exist
 * yet, which is the normal state before its generated SQL has been run, or when
 * the role cannot read it.
 */
export async function countResponses(tableName: string): Promise<number | null> {
  const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
  if (error) return null;
  return count ?? 0;
}
