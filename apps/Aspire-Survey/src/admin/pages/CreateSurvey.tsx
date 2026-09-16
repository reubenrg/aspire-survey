import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useAdminSession } from '../AdminGate';
import {
  SURVEY_CATEGORIES, createSurveyDraft, listSurveys, slugify, type Organization, type SurveyRow,
} from '../adminStore';
import { fetchTemplates, createSurveyFromTemplate, type SurveyTemplate } from '../templateStore';
import { useOrganizations } from '../useOrganizations';
import { PRIVACY_MODE_DESCRIPTION, PRIVACY_MODE_LABEL, type PrivacyMode } from '../labels';
import { ErrorNote, PageHeader, SearchInput } from '../ui';
import type { SurveyDefinition } from '../../engine/types';

type StartingPoint = 'blank' | 'template' | 'duplicate';
const STEPS = ['Starting point', 'Customer', 'Basics', 'Privacy mode'] as const;

function blankDefinition(title: string): SurveyDefinition {
  return {
    slug: slugify(title) || 'untitled-survey',
    title,
    welcome: { heading: title, body: ['Thank you for taking part.'], startLabel: 'Begin Survey' },
    thankYou: { heading: 'Thank You!', body: 'Your response has been recorded.' },
    uniqueBy: 'employeeId',
    sections: [{
      id: 'about',
      title: 'About You',
      questions: [{ id: 'employeeId', type: 'text', label: 'Employee ID', required: true }],
    }],
  };
}

/**
 * Part 8: three starting points, one shared Customer/Basics/Privacy flow
 * after that so template and duplicate surveys get the same deliberate
 * privacy-mode step a blank one does - a template's suggested privacy mode
 * pre-fills the choice, it does not skip it. Nothing here creates an
 * audience or invitations; that stays a separate, later step either way.
 */
export default function CreateSurvey() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { organizations, loading: orgsLoading, error: orgsError } = useOrganizations();
  const [step, setStep] = useState(0);

  const [startingPoint, setStartingPoint] = useState<StartingPoint>((params.get('start') as StartingPoint) || 'blank');
  const [templates, setTemplates] = useState<SurveyTemplate[] | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<SurveyTemplate | null>(null);
  const [existingSurveys, setExistingSurveys] = useState<SurveyRow[] | null>(null);
  const [selectedExisting, setSelectedExisting] = useState<SurveyRow | null>(null);

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [category, setCategory] = useState<string>('');
  const [customCategory, setCustomCategory] = useState('');
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode | null>(null);
  const [ack, setAck] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startingPoint !== 'template' || templates !== null) return;
    void fetchTemplates(true).then(all => {
      setTemplates(all);
      const wanted = params.get('template');
      if (wanted) {
        const found = all.find(t => t.id === wanted);
        if (found) applyTemplate(found);
      }
    }).catch(e => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingPoint]);

  useEffect(() => {
    if (startingPoint !== 'duplicate' || existingSurveys !== null) return;
    void listSurveys().then(setExistingSurveys).catch(e => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingPoint]);

  const applyTemplate = (t: SurveyTemplate) => {
    setSelectedTemplate(t);
    setTitle(t.name);
    setCategory(SURVEY_CATEGORIES.includes(t.category as typeof SURVEY_CATEGORIES[number]) ? (t.category as string) : '');
    setPrivacyMode(t.default_privacy_mode);
  };

  const applyExisting = (s: SurveyRow) => {
    setSelectedExisting(s);
    setTitle(`${s.title} (copy)`);
    setOrganizationId(s.organization_id);
    setCategory(s.category ?? '');
    setPurpose(s.purpose ?? '');
    setPrivacyMode(s.privacy_mode);
  };

  // Only workspaces this person can actually create a survey in.
  const eligible = useMemo(
    () => organizations.filter(o => session.can(o.id, 'editor')),
    [organizations, session],
  );
  const duplicatable = useMemo(
    () => (existingSurveys ?? []).filter(s => session.can(s.organization_id, 'editor')),
    [existingSurveys, session],
  );

  const selectedOrg = eligible.find(o => o.id === organizationId) ?? null;
  const effectiveCategory = category === 'Custom' ? customCategory.trim() : category;

  const canProceedStep0 = startingPoint === 'blank' || (startingPoint === 'template' && selectedTemplate !== null) || (startingPoint === 'duplicate' && selectedExisting !== null);
  const canProceedStep1 = organizationId !== null;
  const canProceedStep2 = title.trim().length > 0 && (category !== 'Custom' || customCategory.trim().length > 0);
  const canSubmit = privacyMode !== null && (privacyMode !== 'CONFIDENTIAL' || ack);

  const create = async () => {
    if (!organizationId || !privacyMode) return;
    setBusy(true); setError(null);
    try {
      let row;
      if (startingPoint === 'template' && selectedTemplate) {
        row = await createSurveyFromTemplate(selectedTemplate, {
          organizationId, title: title.trim(), privacyMode, category: effectiveCategory, purpose: purpose.trim(),
        });
      } else if (startingPoint === 'duplicate' && selectedExisting) {
        const t = title.trim();
        let slug = slugify(t) || `${selectedExisting.slug}-copy`;
        const definition: SurveyDefinition = { ...selectedExisting.definition, slug, title: t };
        row = await createSurveyDraft({ definition, organizationId, privacyMode, category: effectiveCategory, purpose: purpose.trim() });
      } else {
        const definition = blankDefinition(title.trim());
        row = await createSurveyDraft({ definition, organizationId, privacyMode, category: effectiveCategory, purpose: purpose.trim() });
      }
      navigate(`/admin/surveys/${row.slug}/builder`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New survey" subtitle="A short, guided setup. Questions come next, once this is created." />

      <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full font-medium',
              i === step ? 'bg-primary text-primary-foreground'
                : i < step ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {i < step ? '✓' : i + 1}
            </span>
            <span className={i === step ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      {error && <ErrorNote>{error}</ErrorNote>}
      {orgsError && <ErrorNote>{orgsError}</ErrorNote>}

      {step === 0 && (
        <StartingPointStep
          value={startingPoint}
          onChange={sp => { setStartingPoint(sp); setSelectedTemplate(null); setSelectedExisting(null); }}
          templates={templates} onPickTemplate={applyTemplate} selectedTemplate={selectedTemplate}
          existingSurveys={duplicatable} onPickExisting={applyExisting} selectedExisting={selectedExisting}
        />
      )}

      {step === 1 && (
        <CustomerStep
          organizations={startingPoint === 'duplicate' && selectedExisting ? eligible.filter(o => o.id === selectedExisting.organization_id) : eligible}
          loading={orgsLoading}
          selectedId={organizationId} onSelect={setOrganizationId}
        />
      )}

      {step === 2 && selectedOrg && (
        <BasicsStep
          organization={selectedOrg}
          title={title} onTitle={setTitle}
          purpose={purpose} onPurpose={setPurpose}
          category={category} onCategory={setCategory}
          customCategory={customCategory} onCustomCategory={setCustomCategory}
        />
      )}

      {step === 3 && (
        <PrivacyStep mode={privacyMode} onMode={m => { setPrivacyMode(m); setAck(false); }} ack={ack} onAck={setAck} />
      )}

      <div className="mt-8 flex items-center justify-between">
        {step === 0 ? (
          <Link to="/admin/surveys" className="text-sm text-muted-foreground hover:text-foreground">Cancel</Link>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setStep(s => s - 1)}>Back</Button>
        )}
        {step < 3 ? (
          <Button
            type="button"
            disabled={step === 0 ? !canProceedStep0 : step === 1 ? !canProceedStep1 : !canProceedStep2}
            onClick={() => setStep(s => s + 1)}
          >
            Continue
          </Button>
        ) : (
          <Button type="button" disabled={!canSubmit || busy} onClick={create}>
            {busy ? 'Creating…' : 'Create survey'}
          </Button>
        )}
      </div>
    </div>
  );
}

function StartingPointStep({
  value, onChange, templates, onPickTemplate, selectedTemplate, existingSurveys, onPickExisting, selectedExisting,
}: {
  value: StartingPoint; onChange: (v: StartingPoint) => void;
  templates: SurveyTemplate[] | null; onPickTemplate: (t: SurveyTemplate) => void; selectedTemplate: SurveyTemplate | null;
  existingSurveys: SurveyRow[]; onPickExisting: (s: SurveyRow) => void; selectedExisting: SurveyRow | null;
}) {
  return (
    <div>
      <h2 className="mb-1 text-sm font-medium text-foreground">How do you want to start?</h2>
      <p className="mb-4 text-sm text-muted-foreground">You can add, remove or rewrite every question afterward, whichever you pick.</p>

      <div className="grid gap-2 sm:grid-cols-3">
        {(['blank', 'template', 'duplicate'] as StartingPoint[]).map(sp => (
          <button
            key={sp} type="button" onClick={() => onChange(sp)}
            className={cn('rounded-lg border p-3 text-left transition-colors', value === sp ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}
          >
            <span className="block text-sm font-medium text-foreground">{sp === 'blank' ? 'Blank' : sp === 'template' ? 'Template' : 'Duplicate existing survey'}</span>
            <span className="block text-xs text-muted-foreground">
              {sp === 'blank' ? 'Start from an empty survey.' : sp === 'template' ? 'Start from a reusable structure.' : 'Copy the structure of a survey you already have.'}
            </span>
          </button>
        ))}
      </div>

      {value === 'template' && (
        <div className="mt-4">
          {templates === null ? <p className="text-sm text-muted-foreground">Loading templates…</p> : templates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No templates yet. Save one from an existing survey's Builder first.
            </p>
          ) : (
            <div className="grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2">
              {templates.map(t => (
                <button key={t.id} type="button" onClick={() => onPickTemplate(t)}
                        className={cn('rounded-lg border p-3 text-left transition-colors', selectedTemplate?.id === t.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
                  <span className="block text-sm font-medium text-foreground">{t.name}</span>
                  {t.description && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t.description}</span>}
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    {t.category && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t.category}</span>
                    )}
                    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                      {PRIVACY_MODE_LABEL[t.default_privacy_mode]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t.definition.sections.length} sections · {t.definition.sections.reduce((n, s) => n + s.questions.length, 0)} questions
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {selectedTemplate && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-1.5 text-xs font-medium text-foreground">Preview — {selectedTemplate.name}</p>
              <ul className="space-y-0.5">
                {selectedTemplate.definition.sections.map(s => <li key={s.id} className="text-xs text-muted-foreground">• {s.title} ({s.questions.length} question{s.questions.length === 1 ? '' : 's'})</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {value === 'duplicate' && (
        <div className="mt-4">
          {existingSurveys.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No surveys available to duplicate yet.</p>
          ) : (
            <select value={selectedExisting?.slug ?? ''} onChange={e => { const s = existingSurveys.find(x => x.slug === e.target.value); if (s) onPickExisting(s); }}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60">
              <option value="">Choose a survey…</option>
              {existingSurveys.map(s => <option key={s.slug} value={s.slug}>{s.title}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerStep({
  organizations, loading, selectedId, onSelect,
}: { organizations: Organization[]; loading: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const filtered = organizations.filter(o => o.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div>
      <h2 className="mb-1 text-sm font-medium text-foreground">Which customer is this survey for?</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Every survey belongs to one customer. You can only create surveys for customers you have editor
        access to.
      </p>
      {organizations.length > 6 && <SearchInput value={search} onChange={setSearch} placeholder="Search customers…" className="mb-3 max-w-xs" />}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading customers…</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {organizations.length === 0
            ? 'You do not have editor access to any customer yet. Ask an owner to grant it.'
            : 'No customers match that search.'}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map(o => (
            <button
              key={o.id} type="button" onClick={() => onSelect(o.id)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                selectedId === o.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
              )}
            >
              <span className="block truncate text-sm font-medium text-foreground">{o.name}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">/{o.slug}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BasicsStep({
  organization, title, onTitle, purpose, onPurpose, category, onCategory, customCategory, onCustomCategory,
}: {
  organization: Organization;
  title: string; onTitle: (v: string) => void;
  purpose: string; onPurpose: (v: string) => void;
  category: string; onCategory: (v: string) => void;
  customCategory: string; onCustomCategory: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-foreground">Basics</h2>
      <p className="text-sm text-muted-foreground">For {organization.name}.</p>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="survey-title">Survey name</label>
        <input
          id="survey-title" autoFocus value={title} onChange={e => onTitle(e.target.value)}
          placeholder="Q3 Employee Engagement Survey"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
        {title.trim() && <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">/s/{slugify(title) || '—'}</p>}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="survey-purpose">
          Internal purpose / description <span className="font-normal text-muted-foreground">(optional, not shown to respondents)</span>
        </label>
        <textarea
          id="survey-purpose" value={purpose} onChange={e => onPurpose(e.target.value)} rows={2}
          placeholder="Why this survey is running and what it will be used for."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="survey-category">Category</label>
        <select
          id="survey-category" value={category} onChange={e => onCategory(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        >
          <option value="">Choose a category…</option>
          {SURVEY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {category === 'Custom' && (
          <input
            value={customCategory} onChange={e => onCustomCategory(e.target.value)}
            placeholder="Name this category"
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        )}
      </div>
    </div>
  );
}

const MODES: PrivacyMode[] = ['ANONYMOUS', 'ANONYMOUS_TRACKED', 'CONFIDENTIAL'];

function PrivacyStep({
  mode, onMode, ack, onAck,
}: { mode: PrivacyMode | null; onMode: (m: PrivacyMode) => void; ack: boolean; onAck: (v: boolean) => void }) {
  return (
    <div>
      <h2 className="mb-1 text-sm font-medium text-foreground">How should responses be handled?</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        This decides what Aspire is able to track and store. Choose carefully — it is the one setting
        respondents are trusting you to get right.
      </p>

      <div className="space-y-3">
        {MODES.map(m => (
          <button
            key={m} type="button" onClick={() => onMode(m)}
            className={cn(
              'block w-full rounded-lg border p-4 text-left transition-colors',
              mode === m ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{PRIVACY_MODE_LABEL[m]}</span>
              {m === 'ANONYMOUS_TRACKED' && (
                <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                  Recommended for sensitive employee surveys
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{PRIVACY_MODE_DESCRIPTION[m]}</p>
          </button>
        ))}
      </div>

      {mode === 'CONFIDENTIAL' && (
        <div className="mt-4 rounded-md border border-border border-l-4 border-l-violet-500 bg-violet-500/5 px-4 py-3">
          <p className="mb-2 text-xs leading-relaxed text-foreground">
            Responses in this survey can be associated with individual employees.
          </p>
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input type="checkbox" checked={ack} onChange={e => onAck(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
            I understand
          </label>
        </div>
      )}
    </div>
  );
}
