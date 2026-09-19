import { useState } from 'react';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import type { Question, QuestionType, Section } from '../engine/types';
import { defaultColumn } from '../engine/definition';
import { QUESTION_TYPE_LABELS as TYPE_LABELS, convertQuestion, newQuestion as newQuestionOfType } from '../engine/questionFactory';
import TypeSettings from './builder/TypeSettings';
import { LogicEditor } from './builder/ConditionEditor';

interface Props {
  question: Question;
  /** Questions before this one, which are the only valid targets for a condition. */
  earlier: Question[];
  onChange: (q: Question) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export default function QuestionEditor({
  question: q, earlier, onChange, onRemove, onMove, canMoveUp, canMoveDown,
}: Props) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch } as Question);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[q.type]}
            </span>
            {q.required && <span className="text-[10px] font-medium text-primary">Required</span>}
            {q.showIf && <span className="text-[10px] text-muted-foreground">conditional</span>}
          </div>
          <p className="mt-1 truncate text-sm text-foreground">{q.label || <em className="text-muted-foreground">Untitled question</em>}</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            → {q.type === 'matrix' ? `${q.columnPrefix}_01…` : (q.column || defaultColumn(q.id))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconBtn label="Move up" disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</IconBtn>
          <IconBtn label="Move down" disabled={!canMoveDown} onClick={() => onMove(1)}>↓</IconBtn>
          <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Edit'}</Button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-border p-3">
          <Field label="Question text">
            <textarea
              rows={2}
              value={q.label}
              onChange={e => set({ label: e.target.value })}
              className={inputCls}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select value={q.type} onChange={e => onChange(convert(q, e.target.value as QuestionType))} className={inputCls}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Answer key" hint="Becomes the column name. Changing it after responses exist orphans the old column.">
              <input value={q.id} onChange={e => set({ id: e.target.value })} className={cn(inputCls, 'font-mono text-xs')} />
            </Field>
          </div>

          <Field label="Hint shown under the question (optional)">
            <input value={q.hint ?? ''} onChange={e => set({ hint: e.target.value || undefined })} className={inputCls} />
          </Field>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={!!q.required} onChange={e => set({ required: e.target.checked })} className="h-4 w-4 accent-primary" />
            Required
          </label>

          <TypeSettings question={q} readOnly={false} onChange={onChange} />

          <LogicEditor
            heading="Show only when…"
            emptyLabel="Always show"
            logic={q.showIf}
            sources={earlier}
            readOnly={false}
            onChange={showIf => set({ showIf })}
          />

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onRemove} className="text-destructive hover:text-destructive">
              Delete question
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// convert() and newQuestion() now delegate to engine/questionFactory.ts, the
// shared source of truth also used by Builder V2 - behaviour is unchanged,
// only the implementation moved.
const convert = convertQuestion;

export function newQuestion(section: Section): Question {
  return newQuestionOfType(section, 'text');
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

function IconBtn({ children, label, disabled, onClick }: { children: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded border border-border text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
    >
      {children}
    </button>
  );
}
