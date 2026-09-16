import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useAdminSession } from '../AdminGate';
import { countResponses, listOrganizations, type Organization } from '../adminStore';
import {
  autosaveDraft, discardDraft, editingDefinition, hasUnpublishedChanges, loadBuilderSurvey,
  publishSurvey, StaleWriteError, type BuilderSurvey,
} from '../builderStore';
import { validateAdditive } from '../../engine/additive.ts';
import { validateSurveyStructure, type BuilderIssue } from '../builderValidation';
import { PRIVACY_MODE_LABEL, genericLinkWarning, usesInvitationLinks } from '../labels';
import { createTemplate } from '../templateStore';
import { LIBRARY_CATEGORIES } from './QuestionLibrary';
import { ErrorNote, PrivacyModePill } from '../ui';
import type { Question, Section, SurveyDefinition } from '../../engine/types';
import StructurePanel, { type Selection } from '../builder/StructurePanel';
import QuestionCanvas from '../builder/QuestionCanvas';
import PropertiesPanel from '../builder/PropertiesPanel';
import PreviewDialog from '../builder/PreviewDialog';
import PublishDialog from '../builder/PublishDialog';
import VersionHistoryPanel from '../builder/VersionHistoryPanel';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
const AUTOSAVE_DEBOUNCE_MS = 1200;

/**
 * Builder V2 - /admin/surveys/:slug/builder. Owns the draft definition
 * locally, autosaves it to surveys.draft_definition (never to the live
 * `definition` a respondent could be reading right now), and only Publish
 * moves it across that line. The original /admin/:slug builder is untouched
 * and still works; this is additive, not a replacement of it yet.
 */
export default function SurveyBuilder() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const session = useAdminSession();

  const [survey, setSurvey] = useState<BuilderSurvey | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [responseCount, setResponseCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [def, setDef] = useState<SurveyDefinition | null>(null);
  const lastSavedDef = useRef<SurveyDefinition | null>(null);
  const draftUpdatedAt = useRef<string | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>({ sectionIndex: 0, questionId: null });
  const [mobileTab, setMobileTab] = useState<'structure' | 'canvas' | 'properties'>('canvas');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ version: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await loadBuilderSurvey(slug);
      if (!found) { setLoadError(`No survey called "${slug}".`); return; }
      setSurvey(found);
      const initial = editingDefinition(found);
      setDef(initial);
      lastSavedDef.current = initial;
      draftUpdatedAt.current = found.draft_updated_at;
      if (found.organization_id) {
        await session.refreshRole(found.organization_id);
        const orgs = await listOrganizations();
        setOrg(orgs.find(o => o.id === found.organization_id) ?? null);
      }
      setResponseCount(await countResponses(found.slug));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const canEdit = survey ? session.can(survey.organization_id, 'editor') : false;
  const readOnly = !canEdit;

  const isDirty = def !== null && lastSavedDef.current !== null && JSON.stringify(def) !== JSON.stringify(lastSavedDef.current);

  // ── Autosave: debounced, single-flight, optimistic-concurrency guarded ──
  const runSave = useCallback(async () => {
    if (!survey || !def || readOnly) return;
    if (savingRef.current) { pendingRef.current = true; return; }
    savingRef.current = true;
    setSaveState('saving');
    setSaveError(null);
    try {
      const result = await autosaveDraft(survey.id, def, draftUpdatedAt.current);
      draftUpdatedAt.current = result.draftUpdatedAt;
      lastSavedDef.current = def;
      setSaveState('saved');
    } catch (e) {
      setSaveState('failed');
      setSaveError(e instanceof StaleWriteError ? e.message : (e instanceof Error ? e.message : String(e)));
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void runSave();
      }
    }
  }, [survey, def, readOnly]);

  useEffect(() => {
    if (!isDirty || readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void runSave(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, readOnly]);

  // Leaving with something not yet on the server (still debouncing, or a save
  // in flight) warns; once autosave has actually landed, it does not.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty || savingRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const flushAndGo = async (to: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (isDirty) await runSave();
    navigate(to);
  };

  // ── Validation ──
  const structuralIssues: BuilderIssue[] = useMemo(() => (def ? validateSurveyStructure(def) : []), [def]);
  const additiveIssues: BuilderIssue[] = useMemo(() => {
    if (!survey || !def || !responseCount) return [];
    return validateAdditive(survey.definition, def, responseCount > 0);
  }, [survey, def, responseCount]);
  const allIssues = [...structuralIssues, ...additiveIssues];
  const blockingIssues = allIssues.filter(i => i.severity === 'error');
  const issueSubjects = useMemo(() => new Set(allIssues.filter(i => i.severity === 'error').map(i => i.subject)), [allIssues]);

  const doPublish = async () => {
    if (!survey || !def) return;
    setPublishing(true);
    try {
      const result = await publishSurvey(survey, def, (responseCount ?? 0) > 0);
      setPublishOpen(false);
      setPublishResult({ version: result.version });
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  };

  const doDiscardDraft = async () => {
    if (!survey) return;
    if (!confirm('Discard the unpublished draft and go back to the currently published version? This cannot be undone.')) return;
    await discardDraft(survey.id);
    await load();
  };

  if (loadError && !survey) {
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <ErrorNote>{loadError}</ErrorNote>
        <Link to="/admin/surveys" className="text-sm text-primary hover:underline">Back to surveys</Link>
      </div>
    );
  }
  if (!survey || !def) {
    return <div className="grid h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  const section = def.sections[Math.min(selection?.sectionIndex ?? 0, def.sections.length - 1)] as Section | undefined;
  const question: Question | null = section && selection?.questionId
    ? section.questions.find(q => q.id === selection.questionId) ?? null
    : null;
  const earlierQuestions = section
    ? def.sections.slice(0, selection?.sectionIndex ?? 0).flatMap(s => s.questions).concat(section.questions.slice(0, section.questions.findIndex(q => q.id === question?.id)))
    : [];

  const unpublished = hasUnpublishedChanges(survey) || isDirty;
  const generic = genericLinkWarning(survey.privacy_mode);

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => void flushAndGo(`/admin/surveys/${survey.slug}`)} className="text-sm text-muted-foreground hover:text-foreground" aria-label="Back to survey overview">
            ←
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{def.title || 'Untitled survey'}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <PrivacyModePill mode={survey.privacy_mode} />
              <span>Published: v{survey.current_version}{survey.published ? '' : ' (unpublished)'}</span>
              {unpublished && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-primary">
                  Unpublished changes
                </span>
              )}
              <SaveIndicator state={saveState} error={saveError} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!readOnly && unpublished && (
            <Button variant="ghost" size="sm" onClick={doDiscardDraft}>Discard draft</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setVersionsOpen(true)}>History</Button>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>Preview</Button>
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={() => setTemplateDialogOpen(true)}>Save as template</Button>
          )}
          {!readOnly && (
            <Button size="sm" onClick={() => setPublishOpen(true)}>Publish</Button>
          )}
          <Link to={`/admin/${survey.slug}`} className="ml-1 text-[11px] text-muted-foreground hover:text-foreground" title="The original question-by-question editor, including SQL and translations">
            Original editor →
          </Link>
        </div>
      </header>

      {readOnly && (
        <div className="border-b border-border bg-muted/40 px-4 py-1.5 text-center text-xs text-muted-foreground">
          You have read-only access to this customer. Changes cannot be saved.
        </div>
      )}
      {generic && (
        <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-center text-xs text-amber-700 dark:text-amber-500">
          {generic}
        </div>
      )}

      {/* Mobile tab switcher */}
      <div className="flex shrink-0 border-b border-border md:hidden">
        {(['structure', 'canvas', 'properties'] as const).map(t => (
          <button
            key={t} type="button" onClick={() => setMobileTab(t)}
            className={cn(
              'flex-1 py-2 text-xs font-medium capitalize transition-colors',
              mobileTab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground',
            )}
          >
            {t === 'structure' ? 'Sections' : t === 'canvas' ? 'Question' : 'Properties'}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="min-h-0 flex-1 md:grid md:grid-cols-[240px_1fr_300px]">
        <div className={cn('min-h-0 border-r border-border md:block', mobileTab === 'structure' ? 'block' : 'hidden')}>
          <StructurePanel
            def={def} selection={selection} readOnly={readOnly} issueSubjects={issueSubjects}
            onSelect={s => { setSelection(s); setMobileTab('canvas'); }}
            onChange={setDef}
          />
        </div>

        <div className={cn('min-h-0 overflow-y-auto md:block', mobileTab === 'canvas' ? 'block' : 'hidden')}>
          {section ? (
            <QuestionCanvas
              section={section} question={question} readOnly={readOnly} issues={allIssues}
              onChangeQuestion={nq => setDef({
                ...def,
                sections: def.sections.map((s, i) => (i === selection!.sectionIndex ? { ...s, questions: s.questions.map(q => (q.id === question!.id ? nq : q)) } : s)),
              })}
              onChangeSection={patch => setDef({
                ...def,
                sections: def.sections.map((s, i) => (i === selection!.sectionIndex ? { ...s, ...patch } : s)),
              })}
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
              Add a section to get started.
            </div>
          )}
        </div>

        <div className={cn('min-h-0 border-l border-border md:block', mobileTab === 'properties' ? 'block' : 'hidden')}>
          {question ? (
            <PropertiesPanel
              question={question} earlier={earlierQuestions} readOnly={readOnly}
              hasResponses={(responseCount ?? 0) > 0}
              organizationId={survey.organization_id}
              onChange={nq => setDef({
                ...def,
                sections: def.sections.map((s, i) => (i === selection!.sectionIndex ? { ...s, questions: s.questions.map(q => (q.id === question.id ? nq : q)) } : s)),
              })}
              onDelete={() => setDef({
                ...def,
                sections: def.sections.map((s, i) => (i === selection!.sectionIndex ? { ...s, questions: s.questions.filter(q => q.id !== question.id) } : s)),
              })}
            />
          ) : (
            <div className="p-4 text-xs text-muted-foreground">Select a question to see its properties.</div>
          )}
        </div>
      </div>

      {previewOpen && (
        <PreviewDialog definition={def} privacyMode={survey.privacy_mode} onClose={() => setPreviewOpen(false)} />
      )}

      {versionsOpen && (
        <VersionHistoryPanel survey={survey} hasUnpublishedChanges={unpublished} onClose={() => setVersionsOpen(false)} />
      )}

      {publishOpen && (
        <PublishDialog
          surveyId={survey.id} surveyTitle={def.title} customerName={org?.name ?? 'Unfiled'}
          privacyMode={survey.privacy_mode} nextVersion={survey.current_version + 1} definition={def}
          blockingIssues={blockingIssues} busy={publishing}
          onCancel={() => setPublishOpen(false)} onPublish={doPublish}
        />
      )}

      {publishResult && (
        <PublishResultDialog
          survey={survey} version={publishResult.version}
          onClose={() => setPublishResult(null)}
        />
      )}

      {templateDialogOpen && (
        <SaveAsTemplateDialog survey={survey} definition={def} onClose={() => setTemplateDialogOpen(false)} />
      )}
    </div>
  );
}

function SaveAsTemplateDialog({
  survey, definition, onClose,
}: { survey: BuilderSurvey; definition: SurveyDefinition; onClose: () => void }) {
  const [name, setName] = useState(definition.title);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(LIBRARY_CATEGORIES[0]);
  const [scope, setScope] = useState<'shared' | 'workspace'>('shared');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setError('Give the template a name.'); return; }
    setBusy(true); setError(null);
    try {
      await createTemplate({
        organizationId: scope === 'workspace' ? survey.organization_id : null,
        name: name.trim(), description: description.trim() || undefined, category,
        definition: { ...definition, slug: 'template' }, // the slug is meaningless on a template; replaced when a survey is created from it
        defaultPrivacyMode: survey.privacy_mode,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Save as template</h2>
        {done ? (
          <>
            <p className="my-3 text-sm text-primary">Saved as a template. It's an independent copy — editing this survey later never changes it.</p>
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">Copies the current draft's structure — sections, questions and logic. No responses, invitations or customer data.</p>
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-foreground">Name
                <input value={name} onChange={e => setName(e.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60" />
              </label>
              <label className="block text-xs font-medium text-foreground">Description (optional)
                <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60" />
              </label>
              <label className="block text-xs font-medium text-foreground">Category
                <select value={category} onChange={e => setCategory(e.target.value)} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60">
                  {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              {survey.organization_id && (
                <label className="block text-xs font-medium text-foreground">Visibility
                  <select value={scope} onChange={e => setScope(e.target.value as 'shared' | 'workspace')} className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60">
                    <option value="shared">Shared library (any workspace)</option>
                    <option value="workspace">This workspace only</option>
                  </select>
                </label>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save template'}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span>Saving…</span>;
  if (state === 'saved') return <span className="text-primary">Saved</span>;
  return <span className="text-destructive" title={error ?? undefined}>Save failed{error ? ` — ${error}` : ''}</span>;
}

function PublishResultDialog({
  survey, version, onClose,
}: { survey: BuilderSurvey; version: number; onClose: () => void }) {
  const url = `${window.location.origin}/s/${survey.slug}`;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Survey published</h2>
        <p className="mb-4 text-sm text-muted-foreground">v{version} is now what respondents see.</p>

        {usesInvitationLinks(survey.privacy_mode) ? (
          <>
            <div className="mb-4 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-500">
                This survey uses employee-specific invitation links.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Link to={`/admin/surveys/${survey.slug}/audience`}><Button>Manage Audience</Button></Link>
            </div>
          </>
        ) : (
          <>
            <p className="mb-1.5 text-xs font-medium text-foreground">{PRIVACY_MODE_LABEL[survey.privacy_mode]} — public link</p>
            <div className="mb-4 flex items-center gap-2">
              <input readOnly value={url} className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs" />
              <Button size="sm" onClick={() => navigator.clipboard.writeText(url)}>Copy</Button>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
