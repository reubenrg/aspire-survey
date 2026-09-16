import { useState } from 'react';
import QuestionField from '../../engine/QuestionField';
import type { Answers, AnswerValue, Question, Section } from '../../engine/types';
import { QUESTION_TYPE_LABELS } from '../../engine/questionFactory';
import type { BuilderIssue } from '../builderValidation';

interface Props {
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
export default function QuestionCanvas({ section, question, readOnly, issues, onChangeQuestion, onChangeSection }: Props) {
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
          error={false}
          lang="en"
        />
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
