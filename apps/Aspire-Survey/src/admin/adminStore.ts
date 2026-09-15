import { supabase } from '../lib/supabase';
import { tableNameFor } from '../engine/definition';
import type { SurveyDefinition } from '../engine/types';

export interface SurveyRow {
  id: string;
  slug: string;
  title: string;
  definition: SurveyDefinition;
  table_name: string;
  published: boolean;
  updated_at: string;
}

/** Signed-in admins see every survey; anon sees only published ones. */
export async function listSurveys(): Promise<SurveyRow[]> {
  const { data, error } = await supabase
    .from('surveys')
    .select('id, slug, title, definition, table_name, published, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SurveyRow[];
}

export async function getSurvey(slug: string): Promise<SurveyRow | null> {
  const { data, error } = await supabase
    .from('surveys')
    .select('id, slug, title, definition, table_name, published, updated_at')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SurveyRow) ?? null;
}

export async function saveSurvey(def: SurveyDefinition, published: boolean): Promise<void> {
  const { error } = await supabase.from('surveys').upsert(
    {
      slug: def.slug,
      title: def.title,
      definition: def,
      table_name: tableNameFor(def),
      published,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'slug' },
  );
  if (error) {
    if (error.code === '42501') {
      throw new Error('Your account is not on the admin allowlist, so this survey was not saved.');
    }
    throw new Error(error.message);
  }
}

export async function deleteSurvey(slug: string): Promise<void> {
  const { error } = await supabase.from('surveys').delete().eq('slug', slug);
  if (error) throw new Error(error.message);
}

/**
 * How many responses a survey has. Returns null when the response table does
 * not exist yet, which is the normal state for a survey whose generated SQL
 * has not been run, and is worth showing rather than treating as an error.
 */
export async function countResponses(tableName: string): Promise<number | null> {
  const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
  if (error) return null;
  return count ?? 0;
}
