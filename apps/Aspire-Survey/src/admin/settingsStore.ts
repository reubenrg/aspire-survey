import { supabase } from '../lib/supabase';
import { recordAudit } from './reportStore';
import { validateConfidentialityThreshold } from './thresholdValidation';
import { toDomainError } from './domainError';

export interface PlatformSettings {
  platform_name: string;
  default_confidentiality_threshold: number;
  default_invitation_expiry_days: number;
  [key: string]: unknown;
}

const DEFAULTS: PlatformSettings = {
  platform_name: 'Aspire Surveys',
  default_confidentiality_threshold: 5,
  default_invitation_expiry_days: 14,
};

/** The hard floor every analytics function enforces server-side (see survey_segment_summary) - shown so Settings can warn honestly rather than imply a lower number would actually take effect. */
export const CONFIDENTIALITY_THRESHOLD_FLOOR = 5;

function translate(error: { code?: string; message: string }, action: string): Error {
  return toDomainError(error, action);
}

export async function fetchSettings(): Promise<PlatformSettings> {
  const { data, error } = await supabase.from('platform_settings').select('key, value');
  if (error) throw translate(error, 'view settings');
  const values = Object.fromEntries((data ?? []).map(r => [r.key as string, r.value]));
  return { ...DEFAULTS, ...values };
}

/**
 * Only ever RAISES the confidentiality floor in effect for future analytics
 * calls that don't specify their own value - it can never lower it below
 * CONFIDENTIALITY_THRESHOLD_FLOOR, which survey_segment_summary enforces
 * itself regardless of what this setting says (Part 20: do not silently
 * weaken privacy for existing surveys).
 */
export async function updateSetting(key: string, value: unknown, organizationId: string | null = null): Promise<void> {
  if (key === 'default_confidentiality_threshold') {
    validateConfidentialityThreshold(Number(value), CONFIDENTIALITY_THRESHOLD_FLOOR);
  }
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('platform_settings').upsert({
    key, value, updated_by: user?.email ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw translate(error, 'update this setting');
  await recordAudit(organizationId, 'SETTINGS_CHANGED', { key, value });
}
