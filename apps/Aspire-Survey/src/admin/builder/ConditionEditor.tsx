import type { Question } from '../../engine/types';
import { hasOptions, hasStringAnswer } from '../../engine/questionFactory';

interface Props {
  question: Question;
  /** Every question before this one, in reading order - the only valid targets. */
  earlier: Question[];
  readOnly: boolean;
  onChange: (showIf: Question['showIf']) => void;
}

/**
 * The visual editor over the engine's existing showIf: {questionId, equals}.
 * `equals` is the ONLY operator engine/definition.ts's isVisible() actually
 * implements - it tests "is the source answer one of these values". There is
 * no not-equals or contains in the render engine, and building a second
 * evaluator here that the respondent-facing renderer doesn't share would be
 * exactly the "second logic engine" the brief says not to build. So rather
 * than offer operators that would silently do nothing, this shows the one
 * that is real and says so.
 */
export default function ConditionEditor({ question: q, earlier, readOnly, onChange }: Props) {
  const compatible = earlier.filter(e => hasStringAnswer(e.type));
  const source = q.showIf ? earlier.find(e => e.id === q.showIf!.questionId) : undefined;
  const sourceIsBroken = !!q.showIf && !source;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium text-foreground">Show this question when…</p>

      {compatible.length === 0 && !q.showIf ? (
        <p className="text-xs text-muted-foreground">
          No earlier short text, long text, dropdown or single-choice question to depend on yet.
        </p>
      ) : (
        <div className="space-y-2">
          <select
            disabled={readOnly}
            value={q.showIf?.questionId ?? ''}
            onChange={e => onChange(e.target.value ? { questionId: e.target.value, equals: [] } : undefined)}
            className={selectCls}
          >
            <option value="">Always show</option>
            {compatible.map(e => <option key={e.id} value={e.id}>{e.label.slice(0, 60) || e.id}</option>)}
          </select>

          {sourceIsBroken && (
            <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
              This depends on a question that no longer exists or is no longer earlier in the survey.
              Pick a new one above, or choose "Always show" to clear it.
            </p>
          )}

          {q.showIf && source && (
            <>
              <p className="text-[11px] text-muted-foreground">
                equals <span className="text-foreground">(only operator the engine supports)</span>
              </p>
              {hasOptions(source) ? (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border bg-background p-2">
                  {source.options.map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox" disabled={readOnly}
                        checked={q.showIf!.equals.includes(opt)}
                        onChange={e => onChange({
                          questionId: q.showIf!.questionId,
                          equals: e.target.checked
                            ? [...q.showIf!.equals, opt]
                            : q.showIf!.equals.filter(v => v !== opt),
                        })}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              ) : (
                <div>
                  <textarea
                    rows={2} disabled={readOnly}
                    value={q.showIf.equals.join('\n')}
                    onChange={e => onChange({ questionId: q.showIf!.questionId, equals: e.target.value.split('\n').filter(v => v.trim() !== '') })}
                    placeholder="One accepted value per line — must match exactly what was typed."
                    className={`${selectCls} font-mono text-[11px]`}
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Free-text matching is exact, so this is fragile against typos and capitalisation.
                    A dropdown or single-choice source is more reliable.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const selectCls = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/60 disabled:opacity-60';
