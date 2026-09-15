import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import SurveyRenderer from '../engine/SurveyRenderer';
import { generateFullSql } from '../engine/generateSql';
import { translatableStrings } from '../engine/translate';
import { tableNameFor } from '../engine/definition';
import type { Section, SurveyDefinition } from '../engine/types';
import { migrationForNewColumns, validateAdditive, type AdditiveIssue } from '../engine/additive';
import { tableNameFor as tableFor } from '../engine/definition';
import QuestionEditor, { newQuestion } from './QuestionEditor';

type Tab = 'build' | 'preview' | 'translate' | 'sql';

interface Props {
  definition: SurveyDefinition;
  published: boolean;
  saving: boolean;
  /** A viewer or analyst can look but not change anything. */
  readOnly?: boolean;
  /** The definition responses were collected under, for the additive-only guard. */
  baseline?: SurveyDefinition;
  /** Null when unknown or the table does not exist yet. */
  responseCount?: number | null;
  currentVersion?: number;
  onChange: (def: SurveyDefinition) => void;
  onPublishedChange: (p: boolean) => void;
  onSave: () => void;
}

export default function SurveyEditor({
  definition: def, published, saving, readOnly = false,
  baseline, responseCount = null, currentVersion,
  onChange, onPublishedChange, onSave,
}: Props) {
  const [tab, setTab] = useState<Tab>('build');

  // Once answers exist, the shape of this survey is load-bearing: matrix rows
  // map to columns by position, so a reorder silently rewrites what stored
  // answers mean. The guard blocks rather than warns for exactly that reason.
  const hasResponses = (responseCount ?? 0) > 0;
  const issues: AdditiveIssue[] = useMemo(
    () => (baseline ? validateAdditive(baseline, def, hasResponses) : []),
    [baseline, def, hasResponses],
  );
  const blocking = issues.filter(i => i.severity === 'error');
  const advisories = issues.filter(i => i.severity === 'warning');
  const newColumnSql = useMemo(
    () => (baseline ? migrationForNewColumns(baseline, def, tableFor(def)) : ''),
    [baseline, def],
  );

  // A survey with a broken definition should fail here, in the editor, rather
  // than as invalid SQL pasted into the database.
  const sqlResult = useMemo(() => {
    try { return { sql: generateFullSql(def), error: null as string | null }; }
    catch (e) { return { sql: '', error: e instanceof Error ? e.message : String(e) }; }
  }, [def]);

  const setSections = (sections: Section[]) => onChange({ ...def, sections });

  const addSection = () => setSections([
    ...def.sections,
    { id: `section_${def.sections.length + 1}`, title: `Section ${def.sections.length + 1}`, questions: [] },
  ]);

  const patchSection = (i: number, patch: Partial<Section>) =>
    setSections(def.sections.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  const moveSection = (i: number, delta: number) => {
    const next = [...def.sections];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    setSections(next);
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <input
            value={def.title}
            readOnly={readOnly}
            onChange={e => onChange({ ...def, title: e.target.value })}
            className="w-full border-0 bg-transparent p-0 font-display text-xl text-foreground outline-none"
            placeholder="Untitled survey"
          />
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            /s/{def.slug} → {tableNameFor(def)}
            {currentVersion !== undefined && ` · v${currentVersion}`}
            {responseCount !== null && ` · ${responseCount} response${responseCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={published} disabled={readOnly} onChange={e => onPublishedChange(e.target.checked)} className="h-4 w-4 accent-primary" />
            Published
          </label>
          <Button onClick={onSave} disabled={readOnly || saving || !!sqlResult.error || blocking.length > 0}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {blocking.length > 0 && (
        <div className="mb-4 rounded-md border border-border border-l-4 border-l-destructive bg-destructive/5 px-4 py-3">
          <p className="text-xs font-medium text-destructive">
            {blocking.length === 1 ? 'This change would' : `These ${blocking.length} changes would`} break
            answers already collected
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {responseCount} response{responseCount === 1 ? '' : 's'} exist. Questions can be added, but
            existing ones cannot be removed, renamed or reordered, because answers are stored in columns
            fixed by position.
          </p>
          <ul className="mt-2 space-y-1.5">
            {blocking.map((i, n) => (
              <li key={n} className="text-xs text-foreground">
                <span className="font-mono text-[11px] text-destructive">{i.subject}</span>
                <span className="block text-muted-foreground">{i.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {advisories.length > 0 && (
        <div className="mb-4 rounded-md border border-border border-l-4 border-l-muted-foreground bg-muted/40 px-4 py-3">
          <p className="text-xs font-medium text-foreground">Worth knowing before you save</p>
          <ul className="mt-2 space-y-1.5">
            {advisories.map((i, n) => (
              <li key={n} className="text-xs text-muted-foreground">{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {sqlResult.error && (
        <div className="mb-4 rounded-md border-l-4 border-l-destructive border border-border bg-destructive/5 px-4 py-3">
          <p className="text-xs font-medium text-destructive">This survey cannot be saved yet</p>
          <p className="mt-1 text-xs text-muted-foreground">{sqlResult.error}</p>
        </div>
      )}

      <div className="mb-5 flex gap-1 border-b border-border">
        {(['build', 'preview', 'translate', 'sql'] as Tab[]).map(t => (
          <button
            key={t} onClick={() => setTab(t)}
            className={cn(
              'px-3 py-2 text-sm capitalize transition-colors',
              tab === t ? 'border-b-2 border-primary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'sql' ? 'SQL' : t}
          </button>
        ))}
      </div>

      {tab === 'build' && (
        <div className="space-y-6">
          <WelcomeEditor def={def} onChange={onChange} />
          {def.sections.map((section, i) => (
            <div key={section.id} className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <input
                    value={section.title}
                    onChange={e => patchSection(i, { title: e.target.value })}
                    className="w-full border-0 bg-transparent p-0 text-base font-medium text-foreground outline-none"
                    placeholder="Section title"
                  />
                  <input
                    value={section.intro ?? ''}
                    onChange={e => patchSection(i, { intro: e.target.value || undefined })}
                    placeholder="Intro paragraph (optional)"
                    className="w-full border-0 bg-transparent p-0 text-xs text-muted-foreground outline-none"
                  />
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => moveSection(i, -1)}>↑</Button>
                  <Button variant="ghost" size="sm" disabled={i === def.sections.length - 1} onClick={() => moveSection(i, 1)}>↓</Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                    onClick={() => setSections(def.sections.filter((_, n) => n !== i))}>Remove</Button>
                </div>
              </div>

              <div className="space-y-2">
                {section.questions.map((q, qi) => (
                  <QuestionEditor
                    key={`${section.id}-${qi}`}
                    question={q}
                    earlier={def.sections.slice(0, i).flatMap(s => s.questions).concat(section.questions.slice(0, qi))}
                    canMoveUp={qi > 0}
                    canMoveDown={qi < section.questions.length - 1}
                    onMove={d => {
                      const next = [...section.questions];
                      const [item] = next.splice(qi, 1);
                      next.splice(qi + d, 0, item);
                      patchSection(i, { questions: next });
                    }}
                    onChange={nq => patchSection(i, { questions: section.questions.map((o, n) => (n === qi ? nq : o)) })}
                    onRemove={() => patchSection(i, { questions: section.questions.filter((_, n) => n !== qi) })}
                  />
                ))}
              </div>

              <Button variant="outline" size="sm" className="mt-3"
                onClick={() => patchSection(i, { questions: [...section.questions, newQuestion(section)] })}>
                Add question
              </Button>
            </div>
          ))}
          <Button variant="outline" onClick={addSection}>Add section</Button>
        </div>
      )}

      {tab === 'preview' && (
        <div className="overflow-hidden rounded-lg border border-border">
          {/* The real renderer, so the preview cannot drift from what respondents see. */}
          <SurveyRenderer
            key={JSON.stringify(def)}
            definition={def}
            onSubmit={async () => { alert('Preview only. Nothing was saved.'); }}
          />
        </div>
      )}

      {tab === 'translate' && <TranslationsPanel def={def} onChange={onChange} />}

      {tab === 'sql' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Run this in the Supabase SQL editor to create this survey's table. Select all before
            running: the editor executes only highlighted text when there is a selection.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigator.clipboard.writeText(sqlResult.sql)} disabled={!sqlResult.sql}>
              Copy SQL
            </Button>
          </div>
          {newColumnSql && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                This edit adds columns to an existing table
              </p>
              <p className="text-sm text-muted-foreground">
                Run this before publishing, or the new questions will have nowhere to write.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(newColumnSql)}>
                  Copy ALTER statements
                </Button>
              </div>
              <pre className="overflow-auto rounded-lg border border-border border-l-2 border-l-primary bg-muted/30 p-4 font-mono text-[11px] leading-relaxed text-foreground">
                {newColumnSql}
              </pre>
            </div>
          )}
          <pre className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-[11px] leading-relaxed text-foreground">
            {sqlResult.error ? `-- ${sqlResult.error}` : sqlResult.sql}
          </pre>
        </div>
      )}
    </div>
  );
}

function WelcomeEditor({ def, onChange }: { def: SurveyDefinition; onChange: (d: SurveyDefinition) => void }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="mb-3 text-base font-medium text-foreground">Welcome page</p>
      <div className="space-y-2">
        <input
          value={def.welcome.heading}
          onChange={e => onChange({ ...def, welcome: { ...def.welcome, heading: e.target.value } })}
          placeholder="Heading"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
        <textarea
          rows={3}
          value={def.welcome.body.join('\n')}
          onChange={e => onChange({ ...def, welcome: { ...def.welcome, body: e.target.value.split('\n') } })}
          placeholder="Intro paragraphs, one per line"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
      </div>
    </div>
  );
}

function TranslationsPanel({ def, onChange }: { def: SurveyDefinition; onChange: (d: SurveyDefinition) => void }) {
  const strings = useMemo(() => translatableStrings(def), [def]);
  const i18n = def.i18n ?? {};
  const done = strings.filter(s => i18n[s]?.ta && i18n[s]?.hi).length;

  const set = (text: string, lang: 'ta' | 'hi', value: string) =>
    onChange({ ...def, i18n: { ...i18n, [text]: { ...i18n[text], [lang]: value || undefined } } });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {done} of {strings.length} strings translated. Anything left blank shows the English text
        rather than a missing-key placeholder, so an untranslated survey still works.
      </p>
      <div className="space-y-3">
        {strings.map(text => (
          <div key={text} className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm text-foreground">{text}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['ta', 'hi'] as const).map(lang => (
                <input
                  key={lang}
                  value={i18n[text]?.[lang] ?? ''}
                  onChange={e => set(text, lang, e.target.value)}
                  placeholder={lang === 'ta' ? 'தமிழ்' : 'हिन्दी'}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
