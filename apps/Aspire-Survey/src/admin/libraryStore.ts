import { supabase } from '../lib/supabase';
import { recordAudit } from './reportStore';
import { loadBuilderSurvey, autosaveDraft, editingDefinition, StaleWriteError } from './builderStore';
import { matchesLibrarySearch } from './libraryFilters';
import type { Question } from '../engine/types';

export interface LibraryQuestion {
  id: string;
  organization_id: string | null; // null = shared Aspire library
  definition: Question;
  category: string | null;
  tags: string[];
  language: string;
  help_text: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, organization_id, definition, category, tags, language, help_text, is_active, created_by, created_at, updated_at';

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code === '42501') throw new Error(`You do not have permission to ${action}.`);
  throw new Error(error.message || `Could not ${action}.`);
}

export interface LibraryFilters {
  search?: string;
  category?: string;
  type?: string;
  language?: string;
  activeOnly?: boolean;
}

/**
 * RLS already decides which rows are visible (the shared library plus
 * whatever workspaces the caller belongs to) - this just filters within
 * that visible set, client-side, since a library is small enough that
 * search-as-you-type over the whole thing is simpler than round-tripping.
 */
export async function fetchLibrary(filters: LibraryFilters = {}): Promise<LibraryQuestion[]> {
  let q = supabase.from('question_library').select(COLUMNS).order('updated_at', { ascending: false });
  if (filters.activeOnly) q = q.eq('is_active', true);
  if (filters.language) q = q.eq('language', filters.language);
  if (filters.category) q = q.eq('category', filters.category);
  const { data, error } = await q;
  if (error) fail(error, 'view the question library');
  const rows = (data ?? []) as LibraryQuestion[];
  return rows.filter(r => matchesLibrarySearch(r, filters));
}

export interface SaveToLibraryInput {
  question: Question;
  organizationId: string | null;
  category: string;
  tags: string[];
  language: string;
  helpText?: string;
}

/**
 * Snapshots the question as it stands right now. There is deliberately no
 * link back to the survey it came from - a library row is a starting point
 * for future surveys, not a live mirror of this one (Part 5/24).
 */
export async function saveQuestionToLibrary(input: SaveToLibraryInput): Promise<LibraryQuestion> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('question_library')
    .insert({
      organization_id: input.organizationId,
      definition: input.question,
      category: input.category || null,
      tags: input.tags,
      language: input.language,
      help_text: input.helpText || null,
      created_by: user?.email ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error) fail(error, 'save this question to the library');
  await recordAudit(input.organizationId, 'LIBRARY_QUESTION_CREATED', { library_id: (data as LibraryQuestion).id, category: input.category });
  return data as LibraryQuestion;
}

export async function updateLibraryQuestion(id: string, organizationId: string | null, patch: Partial<{
  category: string | null; tags: string[]; language: string; help_text: string | null; definition: Question;
}>): Promise<void> {
  const { error } = await supabase.from('question_library').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) fail(error, 'update this library question');
  await recordAudit(organizationId, 'LIBRARY_QUESTION_EDITED', { library_id: id });
}

export async function setLibraryQuestionActive(id: string, organizationId: string | null, active: boolean): Promise<void> {
  const { error } = await supabase.from('question_library').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) fail(error, active ? 'reactivate this question' : 'deactivate this question');
  await recordAudit(organizationId, 'LIBRARY_QUESTION_DEACTIVATED', { library_id: id, active });
}

export async function duplicateLibraryQuestion(row: LibraryQuestion): Promise<LibraryQuestion> {
  return saveQuestionToLibrary({
    question: { ...row.definition, id: `${row.definition.id}_copy` },
    organizationId: row.organization_id, category: row.category ?? '', tags: row.tags, language: row.language,
    helpText: row.help_text ?? undefined,
  });
}

/**
 * Part 4: copies the library question's definition into a survey's DRAFT,
 * with a fresh answer key scoped to the target section so it can never
 * collide with a question already there. No reference to the library row
 * is stored - editing the library question later cannot change this survey
 * (Part 24).
 */
export async function addLibraryQuestionToSurvey(
  libraryQuestion: LibraryQuestion, surveySlug: string, sectionId: string,
): Promise<void> {
  const survey = await loadBuilderSurvey(surveySlug);
  if (!survey) throw new Error('That survey could not be found.');
  const def = editingDefinition(survey);
  const section = def.sections.find(s => s.id === sectionId);
  if (!section) throw new Error('That section could not be found.');

  const existingIds = new Set(def.sections.flatMap(s => s.questions.map(q => q.id)));
  let newId = `${sectionId}_${libraryQuestion.definition.id}`;
  let n = 1;
  while (existingIds.has(newId)) { newId = `${sectionId}_${libraryQuestion.definition.id}_${++n}`; }
  const cloned: Question = { ...libraryQuestion.definition, id: newId, showIf: undefined };

  const next = {
    ...def,
    sections: def.sections.map(s => (s.id === sectionId ? { ...s, questions: [...s.questions, cloned] } : s)),
  };

  try {
    await autosaveDraft(survey.id, surveySlug, next, survey.draft_updated_at);
  } catch (e) {
    if (e instanceof StaleWriteError) throw new Error('This survey was changed elsewhere just now. Open it in the Builder and try again.');
    throw e;
  }
  await recordAudit(survey.organization_id, 'LIBRARY_QUESTION_ADDED_TO_SURVEY', { library_id: libraryQuestion.id, survey: surveySlug, section: sectionId });
}
