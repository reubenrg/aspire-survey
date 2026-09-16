/**
 * Pure validation for the confidentiality-threshold setting (Part 20),
 * factored out of settingsStore.ts so the "never below the floor" rule can
 * be unit tested without a Supabase connection. The database enforces the
 * same floor independently inside survey_segment_summary() - this is the
 * UI-side half of the same rule, not the only place it is enforced.
 */
export function validateConfidentialityThreshold(value: number, floor: number): void {
  if (!Number.isFinite(value) || value < floor) {
    throw new Error(`The confidentiality threshold cannot go below ${floor} — that floor is enforced by the database regardless of this setting.`);
  }
}
