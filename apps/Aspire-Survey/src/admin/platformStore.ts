import { supabase } from '../lib/supabase';
import { slugify, type Organization } from './adminStore';

export type SurveyStatus = 'DRAFT' | 'LIVE' | 'CLOSED' | 'ARCHIVED';

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
  responses: number;
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

export class NotAuthorised extends Error {
  constructor(what: string) {
    super(`You do not have permission to ${what}.`);
    this.name = 'NotAuthorised';
  }
}

/** Postgres speaks in codes; an admin screen should not. */
function translate(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501') return new NotAuthorised(action);
  if (error.code === '23505') return new Error('That name is already taken.');
  if (error.code === 'PGRST301' || error.code === '401') {
    return new Error('Your sign-in has expired. Reload the page to sign in again.');
  }
  if (error.code === 'PGRST205') {
    return new Error('That table is not available yet. Its setup SQL may not have been run.');
  }
  return new Error(error.message || `Could not ${action}.`);
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
  const { error } = await supabase
    .from('organizations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw translate(error, 'update this customer');
}

/**
 * Deactivating is the lifecycle action, not deleting. A customer with surveys
 * cannot be removed without destroying the link to responses already collected,
 * so the destructive path is deliberately not offered.
 */
export async function setCustomerActive(id: string, active: boolean): Promise<void> {
  return updateCustomer(id, { is_active: active });
}
