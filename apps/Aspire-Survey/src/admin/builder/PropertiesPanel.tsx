import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import type { Question, QuestionType } from '../../engine/types';
import { defaultColumn } from '../../engine/definition';
import { QUESTION_TYPE_LABELS, convertQuestion } from '../../engine/questionFactory';
import ConditionEditor from './ConditionEditor';

interface Props {
  question: Question;
  earlier: Question[];
  readOnly: boolean;
  hasResponses: boolean;
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
export default function PropertiesPanel({ question: q, earlier, readOnly, hasResponses, onChange, onDelete }: Props) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch } as Question);

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

        {(q.type === 'select' || q.type === 'radio' || q.type === 'checkbox') && (
          <>
            <Field label="Options, one per line">
              <textarea
                disabled={readOnly}
                rows={Math.min(10, Math.max(3, q.options.length + 1))}
                value={q.options.join('\n')}
                onChange={e => set({ options: e.target.value.split('\n') } as Partial<Question>)}
                className={cn(inputCls, 'font-mono text-xs')}
              />
            </Field>

            {(q.type === 'radio' || q.type === 'checkbox') && q.options.includes('Other') && (
              <Field label="Column for the “Other” free text" hint="Needed for the box that appears when someone picks Other.">
                <input
                  disabled={readOnly}
                  value={q.otherColumn ?? ''}
                  placeholder={`${defaultColumn(q.id)}_other`}
                  onChange={e => set({ otherColumn: e.target.value || undefined } as Partial<Question>)}
                  className={cn(inputCls, 'font-mono text-xs')}
                />
              </Field>
            )}
          </>
        )}

        {q.type === 'checkbox' && (
          <Field label="Maximum selections" hint="Leave empty for no limit.">
            <input
              disabled={readOnly}
              type="number" min={1} max={q.options.length || undefined}
              value={q.maxSelections ?? ''}
              onChange={e => set({ maxSelections: e.target.value ? Number(e.target.value) : undefined } as Partial<Question>)}
              className={inputCls}
            />
          </Field>
        )}

        {q.type === 'matrix' && (
          <>
            <Field
              label="Statements, one per line"
              hint="Order matters: each becomes a numbered column. Adding to the end is safe; reordering after responses exist changes what existing columns mean."
            >
              <textarea disabled={readOnly} rows={6} value={q.rows.join('\n')}
                onChange={e => set({ rows: e.target.value.split('\n') } as Partial<Question>)}
                className={cn(inputCls, 'font-mono text-xs')} />
            </Field>
            <Field label="Scale, one per line" hint="Left to right across the grid.">
              <textarea disabled={readOnly} rows={5} value={q.scale.join('\n')}
                onChange={e => set({ scale: e.target.value.split('\n') } as Partial<Question>)}
                className={cn(inputCls, 'font-mono text-xs')} />
            </Field>
            <Field label="Column prefix">
              <input disabled={readOnly} value={q.columnPrefix}
                onChange={e => set({ columnPrefix: e.target.value } as Partial<Question>)}
                className={cn(inputCls, 'font-mono text-xs')} />
            </Field>
          </>
        )}

        <ConditionEditor
          question={q} earlier={earlier} readOnly={readOnly}
          onChange={showIf => set({ showIf })}
        />

        <AdvancedInspector question={q} />

        {!readOnly && (
          <div className="border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
              Delete question
            </Button>
          </div>
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
