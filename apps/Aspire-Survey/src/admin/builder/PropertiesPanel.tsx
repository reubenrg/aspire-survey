import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import type { Question, QuestionType } from '../../engine/types';
import { QUESTION_TYPE_LABELS, convertQuestion } from '../../engine/questionFactory';
import { saveQuestionToLibrary } from '../libraryStore';
import { LIBRARY_CATEGORIES } from '../pages/QuestionLibrary';
import ConditionEditor from './ConditionEditor';
import TypeSettings from './TypeSettings';

interface Props {
  question: Question;
  earlier: Question[];
  readOnly: boolean;
  hasResponses: boolean;
  organizationId: string | null;
  onChange: (q: Question) => void;
  onDelete: () => void;
}

/**
 * The right pane: everything about the selected question that isn't "what
 * respondents read", which the center canvas already owns. No raw definition
 * JSON in the normal flow - the Advanced section at the bottom is read-only
 * and collapsed by default, for the rare person who wants to see the exact
 * shape being saved.
 */
export default function PropertiesPanel({ question: q, earlier, readOnly, hasResponses, organizationId, onChange, onDelete }: Props) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch } as Question);
  const [savingToLibrary, setSavingToLibrary] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-sm font-medium text-foreground">Properties</p>
      </div>

      <div className="space-y-4 p-3">
        <Field label="Type">
          <select
            disabled={readOnly}
            value={q.type}
            onChange={e => onChange(convertQuestion(q, e.target.value as QuestionType))}
            className={inputCls}
          >
            {Object.entries(QUESTION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {hasResponses && (
            <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-500">
              This survey has responses. Changing the type here is fine to try, but Publish will
              refuse it if it would need a different column.
            </p>
          )}
        </Field>

        <Field
          label="Internal ID (answer key)"
          hint="Becomes the response column name. Changing it after this survey has responses orphans the old column — Publish will block that."
        >
          <input
            disabled={readOnly}
            value={q.id}
            onChange={e => set({ id: e.target.value })}
            className={cn(inputCls, 'font-mono text-xs')}
          />
        </Field>

        <TypeSettings question={q} readOnly={readOnly} onChange={onChange} earlier={earlier} />

        <ConditionEditor
          question={q} earlier={earlier} readOnly={readOnly}
          onChange={showIf => set({ showIf })}
        />

        <AdvancedInspector question={q} />

        {!readOnly && (
          <div className="space-y-2 border-t border-border pt-3">
            <Button variant="outline" size="sm" className="w-full" disabled={!q.label.trim()} onClick={() => setSavingToLibrary(true)}>
              Save to Question Library
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
              Delete question
            </Button>
          </div>
        )}
      </div>

      {savingToLibrary && (
        <SaveToLibraryDialog question={q} organizationId={organizationId} onClose={() => setSavingToLibrary(false)} />
      )}
    </div>
  );
}

function SaveToLibraryDialog({
  question, organizationId, onClose,
}: { question: Question; organizationId: string | null; onClose: () => void }) {
  const [category, setCategory] = useState(LIBRARY_CATEGORIES[0]);
  const [tags, setTags] = useState('');
  const [language, setLanguage] = useState('en');
  const [scope, setScope] = useState<'shared' | 'workspace'>('shared');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await saveQuestionToLibrary({
        question, organizationId: scope === 'workspace' ? organizationId : null,
        category, tags: tags.split(',').map(t => t.trim()).filter(Boolean), language,
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
        <h2 className="mb-1 font-display text-lg text-foreground">Save to Question Library</h2>
        {done ? (
          <>
            <p className="my-3 text-sm text-primary">Saved. This copy is independent — editing it later will never change this survey.</p>
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </>
        ) : (
          <>
            <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">“{question.label}”</p>
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-foreground">Category
                <select value={category} onChange={e => setCategory(e.target.value)} className={cn(inputCls, 'mt-1.5')}>
                  {LIBRARY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-foreground">Tags, comma separated
                <input value={tags} onChange={e => setTags(e.target.value)} placeholder="pulse, quarterly" className={cn(inputCls, 'mt-1.5')} />
              </label>
              <label className="block text-xs font-medium text-foreground">Language
                <select value={language} onChange={e => setLanguage(e.target.value)} className={cn(inputCls, 'mt-1.5')}>
                  <option value="en">English</option><option value="ta">Tamil</option><option value="hi">Hindi</option>
                </select>
              </label>
              {organizationId && (
                <label className="block text-xs font-medium text-foreground">Visibility
                  <select value={scope} onChange={e => setScope(e.target.value as 'shared' | 'workspace')} className={cn(inputCls, 'mt-1.5')}>
                    <option value="shared">Shared library (any workspace)</option>
                    <option value="workspace">This workspace only</option>
                  </select>
                </label>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AdvancedInspector({ question }: { question: Question }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border pt-3">
      <button type="button" onClick={() => setOpen(o => !o)} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
        {open ? '▾' : '▸'} Advanced (read-only)
      </button>
      {open && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] leading-relaxed text-foreground">
          {JSON.stringify(question, null, 2)}
        </pre>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30 disabled:opacity-60';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
