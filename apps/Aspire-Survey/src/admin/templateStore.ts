import { supabase } from '../lib/supabase';
import { recordAudit } from './reportStore';
import { createSurveyDraft, slugify, type SurveyRow } from './adminStore';
import { duplicateTitle, duplicateSlug } from './duplication';
import type { PrivacyMode } from './labels';
import type { SurveyDefinition } from '../engine/types';
import { toDomainError } from './domainError';

export interface SurveyTemplate {
  id: string;
  organization_id: string | null; // null = shared Aspire template
  name: string;
  description: string | null;
  category: string | null;
  definition: SurveyDefinition;
  default_privacy_mode: PrivacyMode;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, organization_id, name, description, category, definition, default_privacy_mode, is_active, created_by, created_at, updated_at';

function fail(error: { code?: string; message: string }, action: string): never {
  throw toDomainError(error, action);
}

export async function fetchTemplates(activeOnly = true): Promise<SurveyTemplate[]> {
  let q = supabase.from('survey_templates').select(COLUMNS).order('name');
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) fail(error, 'view survey templates');
  return (data ?? []) as SurveyTemplate[];
}

export interface CreateTemplateInput {
  organizationId: string | null;
  name: string;
  description?: string;
  category?: string;
  definition: SurveyDefinition;
  defaultPrivacyMode: PrivacyMode;
}

export async function createTemplate(input: CreateTemplateInput): Promise<SurveyTemplate> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('survey_templates')
    .insert({
      organization_id: input.organizationId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category || null,
      definition: input.definition,
      default_privacy_mode: input.defaultPrivacyMode,
      created_by: user?.email ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error) fail(error, 'create this template');
  await recordAudit(input.organizationId, 'TEMPLATE_CREATED', { template_id: (data as SurveyTemplate).id, name: input.name });
  return data as SurveyTemplate;
}

export async function updateTemplate(id: string, organizationId: string | null, patch: Partial<{
  name: string; description: string | null; category: string | null; definition: SurveyDefinition; default_privacy_mode: PrivacyMode;
}>): Promise<void> {
  const { error } = await supabase.from('survey_templates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) fail(error, 'update this template');
  await recordAudit(organizationId, 'TEMPLATE_EDITED', { template_id: id });
}

export async function setTemplateActive(id: string, organizationId: string | null, active: boolean): Promise<void> {
  const { error } = await supabase.from('survey_templates').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) fail(error, active ? 'reactivate this template' : 'deactivate this template');
  await recordAudit(organizationId, 'TEMPLATE_DEACTIVATED', { template_id: id, active });
}

/** Part 9: an independent copy - no reference back to the original, so editing one never touches the other. */
export async function duplicateTemplate(t: SurveyTemplate): Promise<SurveyTemplate> {
  return createTemplate({
    organizationId: t.organization_id,
    name: duplicateTitle(t.name),
    description: t.description ?? undefined,
    category: t.category ?? undefined,
    definition: t.definition,
    defaultPrivacyMode: t.default_privacy_mode,
  });
}

/**
 * Part 8: creates a brand-new, independent survey draft from a template's
 * structure. The new survey has no reference to the template afterward -
 * editing the template later cannot change surveys already created from it
 * (Part 24), and no invitations or audience are created here (Part 8).
 */
export async function createSurveyFromTemplate(
  template: SurveyTemplate, opts: { organizationId: string; title: string; privacyMode: PrivacyMode; category?: string; purpose?: string },
): Promise<SurveyRow> {
  const title = opts.title.trim();
  let slug = slugify(title) || duplicateSlug(template.name, template.id.slice(0, 8), slugify);
  const { data: clash } = await supabase.from('surveys').select('id').eq('slug', slug).maybeSingle();
  if (clash) slug = `${slug}-${Date.now().toString(36)}`;

  const definition: SurveyDefinition = { ...template.definition, slug, title };
  return createSurveyDraft({
    definition, organizationId: opts.organizationId, privacyMode: opts.privacyMode,
    category: opts.category ?? template.category ?? '', purpose: opts.purpose ?? '',
  });
}
