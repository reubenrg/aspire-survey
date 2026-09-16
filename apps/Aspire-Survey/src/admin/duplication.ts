/**
 * Pure naming logic for "Duplicate survey", factored out of adminStore.ts so
 * it can be unit tested without a Supabase connection. The actual duplicate
 * (adminStore.duplicateSurvey -> createSurveyDraft) performs exactly one
 * INSERT into the surveys table with this title/slug and the source
 * definition's sections/questions/logic; it never reads or writes
 * survey_invitations or any response table, so responses, invitations and
 * participation state are excluded by construction, not by a filter that
 * could be gotten wrong.
 */
export function duplicateTitle(title: string): string {
  return `${title} (copy)`;
}

export function duplicateSlug(
  title: string, fallbackSlug: string, slugify: (s: string) => string,
): string {
  return slugify(duplicateTitle(title)) || `${fallbackSlug}-copy`;
}
