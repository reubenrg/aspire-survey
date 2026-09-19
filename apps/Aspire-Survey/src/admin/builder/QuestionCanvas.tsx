import { useState } from 'react';
import QuestionField from '../../engine/QuestionField';
import type { Answers, AnswerValue, Question, Section, SectionJump, SurveyDefinition } from '../../engine/types';
import { QUESTION_TYPE_LABELS } from '../../engine/questionFactory';
import type { BuilderIssue } from '../builderValidation';
import { LogicEditor } from './ConditionEditor';

interface Props {
  def: SurveyDefinition;
  sectionIndex: number;
  section: Section;
  question: Question | null; // null = the section itself is selected
  readOnly: boolean;
  issues: BuilderIssue[];
  onChangeQuestion: (q: Question) => void;
  onChangeSection: (patch: Partial<Section>) => void;
}

/**
 * The center pane: editing a question feels like looking at the question
 * itself, not a technical form of property names. Text, help text and
 * required are edited inline, directly on what is effectively the same
 * QuestionField a respondent would see - so there is no separate "preview
 * mirror" that could quietly drift from the real render.
 */
export default function QuestionCanvas({ def, sectionIndex, section, question, readOnly, issues, onChangeQuestion, onChangeSection }: Props) {
  // Ephemeral only: lets the widget itself be interacted with (click a radio,
  // type in the box) so the canvas feels alive, without ever touching the
  // survey definition or being persisted anywhere.
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const setPreview = (key: string, value: AnswerValue) => setPreviewAnswers(a => ({ ...a, [key]: value }));

  if (!question) {
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Section {section.title ? `— ${section.title}` : ''}</p>
        <h2 className="mb-4 font-display text-lg text-foreground">Section introduction</h2>
        <Field label="Intro paragraph shown under the section title (optional)">
          <textarea
            rows={3} disabled={readOnly}
            value={section.intro ?? ''}
            onChange={e => onChangeSection({ intro: e.target.value || undefined })}
            placeholder="Shown once, under the section heading."
            className={inputCls}
          />
        </Field>
        <div className="mt-3">
          <Field label="Callout note (optional)" hint="Shown in a bordered box, for scope notes or constraints.">
            <textarea
              rows={2} disabled={readOnly}
              value={section.note ?? ''}
              onChange={e => onChangeSection({ note: e.target.value || undefined })}
              className={inputCls}
            />
          </Field>
        </div>
        {section.questions.length === 0 && (
          <p className="mt-6 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No questions in this section yet. Add one from the left panel.
          </p>
        )}

        <PageLogic
          def={def} sectionIndex={sectionIndex} section={section} readOnly={readOnly}
          issues={issues} onChangeSection={onChangeSection}
        />
      </div>
    );
  }

  const q = question;
  const errors = issues.filter(i => i.subject === q.id && i.severity === 'error');
  const warnings = issues.filter(i => i.subject === q.id && i.severity === 'warning');

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{QUESTION_TYPE_LABELS[q.type]}</p>

      <textarea
        rows={2}
        disabled={readOnly}
        value={q.label}
        onChange={e => onChangeQuestion({ ...q, label: e.target.value })}
        placeholder="Type the question exactly as respondents will read it…"
        className="mb-2 w-full resize-none border-0 bg-transparent p-0 text-xl font-medium leading-snug text-foreground outline-none placeholder:text-muted-foreground/60"
      />

      <input
        disabled={readOnly}
        value={q.hint ?? ''}
        onChange={e => onChangeQuestion({ ...q, hint: e.target.value || undefined })}
        placeholder="Help text shown under the question (optional)"
        className="mb-3 w-full border-0 bg-transparent p-0 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50"
      />

      <label className="mb-6 flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox" disabled={readOnly}
          checked={!!q.required}
          onChange={e => onChangeQuestion({ ...q, required: e.target.checked })}
          className="h-4 w-4 accent-primary"
        />
        Required
      </label>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="mb-5 space-y-1.5">
          {errors.map((e, n) => (
            <p key={`e${n}`} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{e.message}</p>
          ))}
          {warnings.map((w, n) => (
            <p key={`w${n}`} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{w.message}</p>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">How respondents will see it</p>
        <QuestionField
          question={q}
          answers={previewAnswers}
          onChange={setPreview}
          seed={0}
          lang="en"
        />
      </div>
    </div>
  );
}

/**
 * Page-level behaviour: when the page shows, where it sends the respondent
 * next, and whether its questions are shuffled. All of it is evaluated by the
 * same engine functions the respondent renderer uses.
 */
function PageLogic({ def, sectionIndex, section, readOnly, issues, onChangeSection }: {
  def: SurveyDefinition; sectionIndex: number; section: Section; readOnly: boolean;
  issues: BuilderIssue[]; onChangeSection: (patch: Partial<Section>) => void;
}) {
  const before = def.sections.slice(0, sectionIndex).flatMap(s => s.questions);
  const includingThis = [...before, ...section.questions];
  const later = def.sections.slice(sectionIndex + 1);
  const jumps = section.jumps ?? [];
  const setJump = (i: number, patch: Partial<SectionJump>) =>
    onChangeSection({ jumps: jumps.map((j, n) => (n === i ? { ...j, ...patch } : j)) });
  const problems = issues.filter(i => i.subject === section.id && i.severity === 'error');

  return (
    <div className="mt-8 space-y-4 border-t border-border pt-6">
      <h3 className="font-display text-base text-foreground">Page logic</h3>

      {problems.map((p, n) => (
        <p key={n} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{p.message}</p>
      ))}

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox" disabled={readOnly}
          checked={!!section.randomizeQuestions}
          onChange={e => onChangeSection({ randomizeQuestions: e.target.checked || undefined })}
          className="h-4 w-4 accent-primary"
        />
        Show this page's questions in a random order
      </label>

      <LogicEditor
        heading="Show this page when…"
        emptyLabel="Always show"
        logic={section.showIf}
        sources={before}
        readOnly={readOnly}
        onChange={showIf => onChangeSection({ showIf })}
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Skip rules</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Checked in order once this page is answered; the first one that matches decides where the
          respondent goes next. With none matching they simply continue to the next page.
        </p>
        {jumps.map((jump, i) => (
          <div key={i} className="space-y-2 rounded-md border border-border p-2.5">
            <LogicEditor
              heading={`Rule ${i + 1}: if…`}
              emptyLabel="Add at least one condition"
              logic={jump.when}
              sources={includingThis}
              readOnly={readOnly}
              onChange={when => setJump(i, { when: when ?? { match: 'all', rules: [] } })}
            />
            <div className="flex items-center gap-2">
              <select
                disabled={readOnly} value={jump.to}
                onChange={e => setJump(i, { to: e.target.value })}
                className={inputCls}
              >
                {later.map(l => <option key={l.id} value={l.id}>Go to: {l.title || l.id}</option>)}
                <option value="end">End the survey (submit)</option>
                {jump.to !== 'end' && !later.some(l => l.id === jump.to) && <option value={jump.to}>(page no longer available)</option>}
              </select>
              {!readOnly && (
                <button
                  type="button" aria-label="Remove skip rule"
                  onClick={() => onChangeSection({ jumps: jumps.filter((_, n) => n !== i) })}
                  className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() => onChangeSection({ jumps: [...jumps, { when: { match: 'all', rules: [] }, to: later[0]?.id ?? 'end' }] })}
            className="rounded border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
          >
            + Add a skip rule
          </button>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30 disabled:opacity-60';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
