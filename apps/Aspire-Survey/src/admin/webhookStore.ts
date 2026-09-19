import { supabase } from '../lib/supabase';
import { toDomainError } from './domainError';

export interface Webhook {
  id: string; survey_id: string; url: string; format: 'json' | 'text'; is_active: boolean; created_by: string | null; created_at: string;
}

export interface Delivery { at: string; is_test: boolean; status: number | null; error: string | null }

// The secret column is never selectable through the API; only these are.
const COLUMNS = 'id, survey_id, url, format, is_active, created_by, created_at';

export async function listWebhooks(surveyId: string): Promise<Webhook[]> {
  const { data, error } = await supabase.from('survey_webhooks').select(COLUMNS).eq('survey_id', surveyId).order('created_at');
  if (error) throw toDomainError(error, 'view webhooks');
  return (data ?? []) as Webhook[];
}

/** Returns the new webhook's signing secret. It is shown once and cannot be read again. */
export async function createWebhook(slug: string, url: string, format: 'json' | 'text'): Promise<{ id: string; secret: string }> {
  const { data, error } = await supabase.rpc('create_survey_webhook', { p_slug: slug, p_url: url.trim(), p_format: format });
  if (error) {
    if (error.code === '22023' || error.code === '54000') throw new Error(error.message);
    throw toDomainError(error, 'add a webhook');
  }
  return data as { id: string; secret: string };
}

export async function setWebhookActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('survey_webhooks').update({ is_active: active }).eq('id', id);
  if (error) throw toDomainError(error, 'change a webhook');
}

export async function deleteWebhook(id: string): Promise<void> {
  const { error } = await supabase.from('survey_webhooks').delete().eq('id', id);
  if (error) throw toDomainError(error, 'remove a webhook');
}

export async function testWebhook(id: string): Promise<void> {
  const { error } = await supabase.rpc('test_survey_webhook', { p_webhook_id: id });
  if (error) throw toDomainError(error, 'test a webhook');
}

export async function fetchDeliveries(id: string): Promise<Delivery[]> {
  const { data, error } = await supabase.rpc('survey_webhook_deliveries', { p_webhook_id: id, p_limit: 8 });
  if (error) throw toDomainError(error, 'view deliveries');
  return (data ?? []) as Delivery[];
}
