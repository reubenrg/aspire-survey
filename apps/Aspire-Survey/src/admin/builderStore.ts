import { supabase } from '../lib/supabase';
import { tableNameFor } from '../engine/definition';
import { validateAdditive, migrationForNewColumns, type AdditiveIssue } from '../engine/additive';
import type { SurveyDefinition } from '../engine/types';
import type { PrivacyMode } from './labels';
import { assertNotLegacyReference } from './legacySurvey';

export interface BuilderSurvey {
  id: string;
  slug: string;
  title: string;
  organization_id: string | null;
  privacy_mode: PrivacyMode;
  category: string | null;
  published: boolean;
  closed_at: string | null;
  archived_at: string | null;
  current_version: number;
  /** The live respondent-facing definition. Never written by autosave. */
  definition: SurveyDefinition;
  /** Null when there is no unpublished divergence from `definition`. */
  draft_definition: SurveyDefinition | null;
  draft_updated_at: string | null;
  draft_updated_by: string | null;
  updated_at: string;
}

const COLUMNS =
  'id, slug, title, organization_id, privacy_mode, category, published, closed_at, archived_at, current_version, definition, draft_definition, draft_updated_at, draft_updated_by, updated_at';

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code === '42501') throw new Error(`You do not have permission to ${action}.`);
  throw new Error(error.message || `Could not ${action}.`);
}

export async function loadBuilderSurvey(slug: string): Promise<BuilderSurvey | null> {
  const { data, error } = await supabase
    .from('surveys')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) fail(error, 'open this survey');
  return (data as BuilderSurvey) ?? null;
}

/** The definition the Builder should show: the draft if one exists, otherwise the published definition. */
export function editingDefinition(survey: BuilderSurvey): SurveyDefinition {
  return survey.draft_definition ?? survey.definition;
}

export function hasUnpublishedChanges(survey: BuilderSurvey): boolean {
  if (!survey.draft_definition) return false;
  return JSON.stringify(survey.draft_definition) !== JSON.stringify(survey.definition);
}

export class StaleWriteError extends Error {
  constructor() {
    super('This survey was changed elsewhere since you opened it. Reload to see the latest version before saving again.');
    this.name = 'StaleWriteError';
  }
}

/**
 * Writes the draft, guarded by an optimistic-concurrency check on
 * draft_updated_at: the update only applies if the row's draft_updated_at
 * still matches what this editor last saw. Two overlapping autosaves (two
 * tabs, or a slow request landing after a faster later one) cannot silently
 * clobber each other - the loser gets a StaleWriteError instead of a
 * successful write that quietly discarded someone else's change.
 */
export async function autosaveDraft(
  surveyId: string, slug: string, definition: SurveyDefinition, expectedDraftUpdatedAt: string | null,
): Promise<{ draftUpdatedAt: string; draftUpdatedBy: string | null }> {
  assertNotLegacyReference(slug);
  const { data: { user } } = await supabase.auth.getUser();
  const nowIso = new Date().toISOString();

  let q = supabase
    .from('surveys')
    .update({ draft_definition: definition, draft_updated_at: nowIso, draft_updated_by: user?.email ?? null })
    .eq('id', surveyId);
  q = expectedDraftUpdatedAt === null ? q.is('draft_updated_at', null) : q.eq('draft_updated_at', expectedDraftUpdatedAt);

  const { data, error } = await q.select('draft_updated_at, draft_updated_by').maybeSingle();
  if (error) fail(error, 'save this draft');
  if (!data) throw new StaleWriteError();
  return { draftUpdatedAt: data.draft_updated_at as string, draftUpdatedBy: data.draft_updated_by as string | null };
}

/** Reverts the draft back to the published definition, discarding unpublished edits. */
export async function discardDraft(surveyId: string): Promise<void> {
  const { error } = await supabase
    .from('surveys')
    .update({ draft_definition: null, draft_updated_at: null, draft_updated_by: null })
    .eq('id', surveyId);
  if (error) fail(error, 'discard this draft');
}

export interface PublishResult {
  version: number;
  additiveWarnings: AdditiveIssue[];
}

/**
 * Creates (or extends) the survey's own response table from its stored
 * definition, server-side. Safe to call repeatedly; never drops or retypes a
 * column, matching the additive-only guarantee the builder already enforces.
 */
export async function ensureResponseTable(surveyId: string): Promise<void> {
  const { error } = await supabase.rpc('ensure_survey_response_table', { p_survey_id: surveyId });
  if (error) {
    throw new Error(
      `The survey was saved, but its response table could not be set up: ${error.message}. ` +
      'Responses cannot be collected until this succeeds - try publishing again.',
    );
  }
}

/**
 * Publishes the draft: runs the existing additive-only guard against the
 * currently-live definition (skipped entirely when there are no responses,
 * exactly as the original editor does), snapshots the new definition into
 * survey_versions, and only then flips it live. Blocking additive issues
 * throw rather than publish, so a destructive change can never reach
 * respondents "successfully" with a warning attached after the fact.
 */
export async function publishSurvey(
  survey: BuilderSurvey, draft: SurveyDefinition, hasResponses: boolean,
): Promise<PublishResult> {
  assertNotLegacyReference(survey.slug);
  const additiveIssues = validateAdditive(survey.definition, draft, hasResponses);
  const blocking = additiveIssues.filter(i => i.severity === 'error');
  if (blocking.length > 0) {
    throw new Error(
      `This can't be published: ${blocking[0].message}` + (blocking.length > 1 ? ` (and ${blocking.length - 1} more issue${blocking.length - 1 === 1 ? '' : 's'}.)` : ''),
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  const nextVersion = survey.current_version + 1;

  const { error: vErr } = await supabase.from('survey_versions').insert({
    survey_id: survey.id,
    version_number: nextVersion,
    definition: draft,
    created_by: user?.email ?? null,
  });
  if (vErr && vErr.code !== '23505') fail(vErr, 'record this version');

  const { error } = await supabase
    .from('surveys')
    .update({
      definition: draft,
      table_name: tableNameFor(draft),
      current_version: nextVersion,
      published: true,
      draft_definition: null,
      draft_updated_at: null,
      draft_updated_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', survey.id);
  if (error) fail(error, 'publish this survey');

  // The response table is derived from the definition that was just written,
  // so this has to run after the update above, not before. Without it a
  // survey published through this flow has nowhere to store answers and every
  // respondent hits NO_TABLE - the table used to be created only by pasting
  // the old editor's generated SQL in by hand, which nothing here surfaced.
  // Idempotent: creates the table once, then only ever adds missing columns.
  await ensureResponseTable(survey.id);

  return { version: nextVersion, additiveWarnings: additiveIssues.filter(i => i.severity === 'warning') };
}

/** The ALTER statements (if any) a publish will need run before it, exactly as the original editor's SQL tab computes. */
export function publishMigrationSql(survey: BuilderSurvey, draft: SurveyDefinition): string {
  return migrationForNewColumns(survey.definition, draft, tableNameFor(survey.definition));
}

export interface VersionHistoryEntry {
  version_number: number;
  created_by: string | null;
  created_at: string;
  isCurrentlyPublished: boolean;
}

export async function fetchVersionHistory(surveyId: string, currentVersion: number, published: boolean): Promise<VersionHistoryEntry[]> {
  const { data, error } = await supabase
    .from('survey_versions')
    .select('version_number, created_by, created_at')
    .eq('survey_id', surveyId)
    .order('version_number', { ascending: false });
  if (error) fail(error, 'view the version history');
  return ((data ?? []) as { version_number: number; created_by: string | null; created_at: string }[]).map(v => ({
    ...v,
    isCurrentlyPublished: published && v.version_number === currentVersion,
  }));
}
