import { supabase } from '../lib/supabase';
import { slugify, type Organization } from './adminStore';
import type { PrivacyMode, SurveyStatus } from './labels';
import { recordAudit } from './reportStore';
import { isValidHexColor, isValidLogoUrl } from './brandingValidation';
import { toDomainError, NotAuthorised } from './domainError';

export { NotAuthorised };

export type { SurveyStatus };

export interface OverviewStats {
  customers: number;
  surveys: number;
  live: number;
  draft: number;
  closed: number;
  archived: number;
  responses: number;
  responses_this_month: number;
  error?: string;
}

export interface SurveySummary {
  slug: string;
  title: string;
  organization_id: string | null;
  organization_name: string | null;
  status: SurveyStatus;
  privacy_mode: PrivacyMode;
  category: string | null;
  responses: number;
  audience: number;
  completed: number;
  current_version: number;
  created_by: string | null;
  updated_at: string;
}

export interface Customer extends Organization {
  logo_url: string | null;
  brand_color: string | null;
  is_active: boolean;
  updated_at: string;
}

/** Postgres speaks in codes; an admin screen should not. */
function translate(error: { code?: string; message: string }, action: string): Error {
  return toDomainError(error, action, { '23505': 'That name is already taken.' });
}

// ── Overview ───────────────────────────────────────────────────────────────

export async function fetchOverview(): Promise<OverviewStats> {
  const { data, error } = await supabase.rpc('admin_overview_stats');
  if (error) throw translate(error, 'view the dashboard');
  const stats = data as OverviewStats;
  if (stats?.error === 'not_authorised') throw new NotAuthorised('view this workspace');
  return stats;
}

/**
 * Every survey the caller may see, with its response count already counted in
 * the database. One round trip, and no response row ever reaches the browser
 * just to be counted.
 */
export async function fetchSurveySummaries(): Promise<SurveySummary[]> {
  const { data, error } = await supabase.rpc('admin_survey_summaries');
  if (error) throw translate(error, 'view surveys');
  return (data ?? []) as SurveySummary[];
}

export async function fetchResponseTrend(days = 30): Promise<{ day: string; n: number }[]> {
  const { data, error } = await supabase.rpc('admin_response_trend', { p_days: days });
  if (error) throw translate(error, 'view the response trend');
  return (data ?? []) as { day: string; n: number }[];
}

// ── Customers ──────────────────────────────────────────────────────────────

const CUSTOMER_COLUMNS = 'id, name, slug, logo_url, brand_color, is_active, created_at, updated_at';

export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select(CUSTOMER_COLUMNS)
    .order('name');
  if (error) throw translate(error, 'view customers');
  return (data ?? []) as Customer[];
}

export async function createCustomer(input: {
  name: string; brandColor?: string; logoUrl?: string;
}): Promise<Customer> {
  const name = input.name.trim();
  const slug = slugify(name);
  if (!slug) throw new Error('Give the customer a name using letters or numbers.');
  if (input.brandColor && !isValidHexColor(input.brandColor)) {
    throw new Error('Brand colour must be a hex colour like #2961B6.');
  }
  if (input.logoUrl && !isValidLogoUrl(input.logoUrl)) {
    throw new Error('Logo URL must be a valid http:// or https:// address.');
  }

  const { data, error } = await supabase
    .from('organizations')
    .insert({
      name, slug,
      brand_color: input.brandColor || null,
      logo_url: input.logoUrl || null,
      is_active: true,
    })
    .select(CUSTOMER_COLUMNS)
    .single();
  if (error) throw translate(error, 'create a customer');
  return data as Customer;
}

export async function updateCustomer(id: string, patch: Partial<{
  name: string; brand_color: string | null; logo_url: string | null; is_active: boolean;
}>): Promise<void> {
  if (patch.brand_color && !isValidHexColor(patch.brand_color)) {
    throw new Error('Brand colour must be a hex colour like #2961B6.');
  }
  if (patch.logo_url && !isValidLogoUrl(patch.logo_url)) {
    throw new Error('Logo URL must be a valid http:// or https:// address.');
  }
  const { error } = await supabase
    .from('organizations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw translate(error, 'update this customer');
  if ('brand_color' in patch || 'logo_url' in patch) {
    await recordAudit(id, 'CUSTOMER_BRANDING_CHANGED', { customer_id: id });
  }
}

/**
 * Deactivating is the lifecycle action, not deleting. A customer with surveys
 * cannot be removed without destroying the link to responses already collected,
 * so the destructive path is deliberately not offered.
 */
export async function setCustomerActive(id: string, active: boolean): Promise<void> {
  return updateCustomer(id, { is_active: active });
}
