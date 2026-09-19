import { supabase } from '../lib/supabase';
import { tableNameFor } from './definition';
import { buildSubmissionRow } from './submission';
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
  closedAt: string | null;
  opensAt: string | null;
  closesAt: string | null;
}

/**
 * Counts that someone opened the survey (step 0) or reached a page (step = page index + 1).
 * Fire and forget, and it carries nothing that identifies the visitor: the database keeps
 * only a daily counter per step. A failure here must never affect the respondent.
 */
export function recordSurveyStep(slug: string, step: number): void {
  void Promise.resolve(supabase.rpc('record_survey_step', { p_slug: slug, p_step: step })).catch(() => {});
}

/** Why a survey is or is not taking responses right now. The database decides; it never says how many. */
export type Availability = 'open' | 'not_open_yet' | 'ended' | 'full' | 'closed';

export async function fetchAvailability(slug: string): Promise<Availability> {
  const { data, error } = await supabase.rpc('survey_availability', { p_slug: slug });
  // If the check itself fails, do not block a respondent: the insert is still guarded by the database.
  if (error || typeof data !== 'string') return 'open';
  return data as Availability;
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
    .select('slug, title, definition, table_name, published, current_version, privacy_mode, closed_at, opens_at, closes_at')
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
    closedAt: data.closed_at,
    opensAt: data.opens_at ?? null,
    closesAt: data.closes_at ?? null,
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
  const row = { ...buildSubmissionRow(record.definition, answers), definition_version: record.currentVersion };
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
  if (error.code === '42501') {
    // The response table's own INSERT policy re-checks published/closed_at
    // at write time - this is the defense-in-depth path for a survey that
    // closed in the moments between loading the page and submitting it. The
    // proactive closedAt check in SurveyPage.tsx is what respondents
    // normally see; this is the backstop if that state went stale.
    throw new Error('This survey is not currently accepting responses. It may have closed, not opened yet, or reached its response limit.');
  }
  throw new Error(error.message || 'Submission failed. Please try again.');
}
