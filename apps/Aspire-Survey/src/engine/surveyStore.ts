import { supabase } from '../lib/supabase';
import { buildRow, tableNameFor } from './definition';
import type { EnginePrivacyMode } from './privacyNotices';
import type { Answers, SurveyDefinition } from './types';

export interface SurveyRecord {
  slug: string;
  title: string;
  definition: SurveyDefinition;
  tableName: string;
  published: boolean;
  currentVersion: number;
  privacyMode: EnginePrivacyMode;
}

export class SurveyNotFound extends Error {
  constructor(slug: string) {
    super(`No published survey found at "${slug}".`);
    this.name = 'SurveyNotFound';
  }
}

/**
 * Load a published survey by slug. Row level security means anon can only see
 * published rows, so an unpublished or missing survey is indistinguishable from
 * the outside, which is the behaviour we want: a draft must not be discoverable
 * by guessing URLs.
 */
export async function loadSurvey(slug: string): Promise<SurveyRecord> {
  const { data, error } = await supabase
    .from('surveys')
    .select('slug, title, definition, table_name, published, current_version, privacy_mode')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new SurveyNotFound(slug);

  return {
    slug: data.slug,
    title: data.title,
    definition: data.definition as SurveyDefinition,
    tableName: data.table_name,
    published: data.published,
    currentVersion: data.current_version ?? 1,
    privacyMode: data.privacy_mode as EnginePrivacyMode,
  };
}

/**
 * Write a response into the survey's own table.
 *
 * `Prefer: return=minimal` is implied by not selecting anything back: echoing
 * the row would need a SELECT policy, and responses must stay unreadable to the
 * anon key. A unique violation on the survey's `uniqueBy` column surfaces as a
 * duplicate rather than a generic failure.
 */
export async function submitResponse(record: SurveyRecord, answers: Answers): Promise<void> {
  // Stamp the version that produced these answers, so a row is always readable
  // against the definition that was actually on screen when it was filled in.
  const row = { ...buildRow(record.definition, answers), definition_version: record.currentVersion };
  const table = record.tableName || tableNameFor(record.definition);

  const { error } = await supabase.from(table).insert(row);
  if (!error) return;

  if (error.code === '23505') {
    throw new Error(
      'A response has already been submitted for this ID. Each person may submit only once.',
    );
  }
  if (error.code === '42P01') {
    throw new Error(
      `The response table "${table}" does not exist yet. Run the generated SQL for this survey first.`,
    );
  }
  throw new Error(error.message || 'Submission failed. Please try again.');
}
