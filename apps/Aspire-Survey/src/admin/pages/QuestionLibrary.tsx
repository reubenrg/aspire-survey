import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import {
  addLibraryQuestionToSurvey, duplicateLibraryQuestion, fetchLibrary, saveQuestionToLibrary,
  setLibraryQuestionActive, updateLibraryQuestion, type LibraryQuestion,
} from '../libraryStore';
import { listOrganizations, listSurveys, type Organization, type SurveyRow } from '../adminStore';
import { newQuestion, QUESTION_TYPE_LABELS, QUESTION_TYPES } from '../../engine/questionFactory';
import type { Question, QuestionType } from '../../engine/types';
import {
  DataTable, EmptyState, ErrorNote, FilterSelect, PageHeader, RowMenu, SearchInput, SkeletonRows, Td,
} from '../ui';

export const LIBRARY_CATEGORIES = [
  'Habit Formation', 'Behaviour Change', 'Engagement', 'Manager Effectiveness',
  'Performance', 'Training', 'Workplace Culture', 'Customer Experience', 'Other',
];
const LANGUAGES = [{ value: 'en', label: 'English' }, { value: 'ta', label: 'Tamil' }, { value: 'hi', label: 'Hindi' }];

/**
 * A reusable bank of questions, stored in exactly the engine's own Question
 * shape (Part 1) - never a second format. "Add to survey" copies the
 * definition into a draft once; nothing here stays linked afterward
 * (Part 4/24), so editing a library entry never reaches back into a survey
 * that already used it.
 */
export default function QuestionLibrary() {
  const session = useAdminSession();
  const [rows, setRows] = useState<LibraryQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [language, setLanguage] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<LibraryQuestion | null>(null);
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<LibraryQuestion | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchLibrary({ search, category, type, language, activeOnly: !showInactive }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [search, category, type, language, showInactive]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader
        title="Question Library"
        subtitle={rows === null ? 'Loading…' : `${rows.length} question${rows.length === 1 ? '' : 's'}`}
        actions={<Button onClick={() => setCreating(true)}>New question</Button>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search questions, tags…" className="w-56" />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={LIBRARY_CATEGORIES.map(c => ({ value: c, label: c }))} />
        <FilterSelect label="Type" value={type} onChange={setType} options={QUESTION_TYPES.map(t => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))} />
        <FilterSelect label="Language" value={language} onChange={setLanguage} options={LANGUAGES} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Show inactive
        </label>
      </div>

      {rows === null ? <SkeletonRows rows={5} /> : rows.length === 0 ? (
        <EmptyState
          title="No questions in the library yet"
          body="Save a question from a survey Builder, or add one directly here, to start building a reusable bank."
          action={<Button size="sm" onClick={() => setCreating(true)}>New question</Button>}
        />
      ) : (
        <DataTable head={['Question', 'Type', 'Category', 'Tags', 'Language', 'Status', '']}>
          {rows.map(r => (
            <tr key={r.id} className={`transition-colors hover:bg-muted/40 ${r.is_active ? '' : 'opacity-60'}`}>
              <Td className="max-w-xs truncate font-medium text-foreground">{r.definition.label || <em className="text-muted-foreground">Untitled</em>}</Td>
              <Td className="text-muted-foreground">{QUESTION_TYPE_LABELS[r.definition.type]}</Td>
              <Td className="text-muted-foreground">{r.category ?? '—'}</Td>
              <Td className="text-muted-foreground">{r.tags?.length ? r.tags.join(', ') : '—'}</Td>
              <Td className="text-muted-foreground">{LANGUAGES.find(l => l.value === r.language)?.label ?? r.language}</Td>
              <Td>
                <span className={r.is_active
                  ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400'
                  : 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'}>
                  {r.is_active ? 'Active' : 'Inactive'}
                </span>
              </Td>
              <Td>
                <div className="flex justify-end">
                  <RowMenu items={[
                    { label: 'View / Edit', onSelect: () => setEditing(r) },
                    { label: 'Duplicate', onSelect: async () => { try { await duplicateLibraryQuestion(r); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } } },
                    { label: 'Add to survey', onSelect: () => setAddingTo(r) },
                    {
                      label: r.is_active ? 'Deactivate' : 'Reactivate', destructive: r.is_active,
                      onSelect: async () => { try { await setLibraryQuestionActive(r.id, r.organization_id, !r.is_active); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } },
                    },
                  ]} />
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      {(creating || editing) && (
        <LibraryQuestionDialog
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}
      {addingTo && (
        <AddToSurveyDialog question={addingTo} onClose={() => setAddingTo(null)} />
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">Signed in as {session.email}.</p>
    </>
  );
}

function LibraryQuestionDialog({
  existing, onClose, onSaved,
}: { existing: LibraryQuestion | null; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<QuestionType>(existing?.definition.type ?? 'text');
  const [question, setQuestion] = useState<Question>(existing?.definition ?? newQuestion({ id: 'q', title: '', questions: [] }, 'text'));
  const [category, setCategory] = useState(existing?.category ?? LIBRARY_CATEGORIES[0]);
  const [tags, setTags] = useState((existing?.tags ?? []).join(', '));
  const [language, setLanguage] = useState(existing?.language ?? 'en');
  const [helpText, setHelpText] = useState(existing?.help_text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.label.trim()) { setError('The question needs some text.'); return; }
    setBusy(true); setError(null);
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (existing) {
        await updateLibraryQuestion(existing.id, existing.organization_id, {
          definition: question, category, tags: tagList, language, help_text: helpText || null,
        });
      } else {
        await saveQuestionToLibrary({ question, organizationId: null, category, tags: tagList, language, helpText });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/30 px-6 py-8" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-4 font-display text-lg text-foreground">{existing ? 'Edit library question' : 'New library question'}</h2>

        <div className="space-y-3">
          <Field label="Type">
            <select value={type} onChange={e => { const t = e.target.value as QuestionType; setType(t); setQuestion(newQuestion({ id: question.id.replace(/_\d+$/, ''), title: '', questions: [] }, t)); }} className={inputCls}>
              {QUESTION_TYPES.map(t => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Question text">
            <textarea rows={2} value={question.label} onChange={e => setQuestion({ ...question, label: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Help text (optional)">
            <input value={helpText} onChange={e => setHelpText(e.target.value)} className={inputCls} />
          </Field>
          {(question.type === 'radio' || question.type === 'select' || question.type === 'checkbox') && (
            <Field label="Options, one per line">
              <textarea rows={4} value={question.options.join('\n')} onChange={e => setQuestion({ ...question, options: e.target.value.split('\n') } as Question)} className={inputCls + ' font-mono text-xs'} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls}>
                {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Language">
              <select value={language} onChange={e => setLanguage(e.target.value)} className={inputCls}>
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Tags, comma separated">
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="pulse, quarterly" className={inputCls} />
          </Field>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </div>
  );
}

/** Part 4's flow: customer -> draft survey -> section -> add. */
function AddToSurveyDialog({ question, onClose }: { question: LibraryQuestion; onClose: () => void }) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgId, setOrgId] = useState('');
  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [slug, setSlug] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { void listOrganizations().then(setOrgs); }, []);
  useEffect(() => {
    if (!orgId) { setSurveys([]); return; }
    void listSurveys().then(all => setSurveys(all.filter(s => s.organization_id === orgId && !s.published)));
  }, [orgId]);

  const survey = surveys.find(s => s.slug === slug);

  const submit = async () => {
    if (!survey || !sectionId) return;
    setBusy(true); setError(null);
    try {
      await addLibraryQuestionToSurvey(question, survey.slug, sectionId);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Add to survey</h2>
        <p className="mb-4 text-sm text-muted-foreground">“{question.definition.label}”</p>

        {done ? (
          <>
            <p className="mb-4 rounded-md border border-border border-l-4 border-l-primary bg-primary/5 px-3 py-2 text-sm text-primary">
              Added to the draft. Open the survey in the Builder to see it.
            </p>
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </>
        ) : (
          <>
            {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
            <div className="space-y-3">
              <Field label="Customer">
                <select value={orgId} onChange={e => { setOrgId(e.target.value); setSlug(''); setSectionId(''); }} className={inputCls}>
                  <option value="">Choose a customer…</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
              <Field label="Draft survey" hint="Only unpublished (draft) surveys are shown.">
                <select value={slug} onChange={e => { setSlug(e.target.value); setSectionId(''); }} disabled={!orgId} className={inputCls}>
                  <option value="">Choose a survey…</option>
                  {surveys.map(s => <option key={s.slug} value={s.slug}>{s.title}</option>)}
                </select>
              </Field>
              {survey && (
                <Field label="Section">
                  <select value={sectionId} onChange={e => setSectionId(e.target.value)} className={inputCls}>
                    <option value="">Choose a section…</option>
                    {survey.definition.sections.map(s => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={!sectionId || busy} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
