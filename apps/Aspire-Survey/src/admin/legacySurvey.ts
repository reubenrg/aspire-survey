/**
 * Marks a `surveys` row as a read-only administrative reference to a survey
 * that lives outside the dynamic engine entirely (the frozen legacy S2M
 * app, or any future one registered the same way) - never a real,
 * publishable draft. The prefix is permanent, unlike the "zz-" convention
 * used elsewhere for throwaway synthetic test fixtures.
 */
export const LEGACY_REFERENCE_SLUG_PREFIX = 'legacy-';

export function isLegacyReferenceSurvey(slug: string): boolean {
  return slug.startsWith(LEGACY_REFERENCE_SLUG_PREFIX);
}

export function assertNotLegacyReference(slug: string): void {
  if (isLegacyReferenceSurvey(slug)) {
    throw new Error(
      'This is a frozen legacy survey record, kept for administrative visibility only. ' +
      'It cannot be edited, published, or have its response schema regenerated through the Builder.',
    );
  }
}
