import type { Logic, Question, QuestionType, Rule, RuleOperator } from '../../engine/types';
import { hasOptions, hasStringAnswer } from '../../engine/questionFactory';
import { normalizeLogic } from '../../engine/logic';

interface Props {
  question: Question;
  /** Every question before this one, in reading order - the only valid targets. */
  earlier: Question[];
  readOnly: boolean;
  onChange: (showIf: Question['showIf']) => void;
}

/** "Show this question when…" - the question-level use of the shared logic editor. */
export default function ConditionEditor({ question: q, earlier, readOnly, onChange }: Props) {
  return (
    <LogicEditor
      heading="Show this question when…"
      emptyLabel="Always show"
      logic={q.showIf}
      sources={earlier}
      readOnly={readOnly}
      onChange={onChange}
    />
  );
}

const NUMERIC: QuestionType[] = ['number', 'rating', 'nps', 'slider'];
const TEXTUAL: QuestionType[] = ['text', 'textarea', 'email'];

const OP_LABEL: Record<RuleOperator, string> = {
  equals: 'is', notEquals: 'is not',
  contains: 'contains', notContains: 'does not contain',
  gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  answered: 'is answered', notAnswered: 'is not answered',
};

/** The operators that mean something for this kind of answer. Offering the rest would only invite rules that never match. */
function operatorsFor(source: Question): RuleOperator[] {
  if (source.type === 'checkbox' || source.type === 'ranking') return ['contains', 'notContains', 'answered', 'notAnswered'];
  if (source.type === 'radio' || source.type === 'select' || source.type === 'yesno') return ['equals', 'notEquals', 'answered', 'notAnswered'];
  if (NUMERIC.includes(source.type)) return ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'answered', 'notAnswered'];
  if (source.type === 'date') return ['equals', 'gt', 'lt', 'answered', 'notAnswered'];
  return ['equals', 'notEquals', 'contains', 'notContains', 'answered', 'notAnswered'];
}

function opLabel(op: RuleOperator, source: Question): string {
  if (source.type === 'checkbox' || source.type === 'ranking') {
    if (op === 'contains') return 'includes';
    if (op === 'notContains') return 'does not include';
  }
  if (source.type === 'date') {
    if (op === 'gt') return 'is after';
    if (op === 'lt') return 'is before';
  }
  return OP_LABEL[op];
}

/** One plain single-value `equals` rule is stored in the original compact shape, so existing surveys and older readers are untouched. */
function toLogic(match: 'all' | 'any', rules: Rule[]): Logic | undefined {
  if (rules.length === 0) return undefined;
  if (rules.length === 1 && match === 'all' && rules[0].op === 'equals') {
    return { questionId: rules[0].questionId, equals: rules[0].value ?? [] };
  }
  return { match, rules };
}

const NO_VALUE: RuleOperator[] = ['answered', 'notAnswered'];

export interface LogicEditorProps {
  heading: string;
  emptyLabel: string;
  logic: Logic | undefined;
  /** Questions the rules may read. */
  sources: Question[];
  readOnly: boolean;
  onChange: (logic: Logic | undefined) => void;
}

/**
 * The visual editor over the engine's shared rule evaluator (engine/logic.ts).
 * It offers exactly the operators that evaluator implements for the chosen
 * source, and writes the same Logic the respondent renderer reads. Used for a
 * question's display rule, a page's display rule and each skip jump.
 */
export function LogicEditor({ heading, emptyLabel, logic, sources, readOnly, onChange }: LogicEditorProps) {
  const compatible = sources.filter(e => hasStringAnswer(e.type));
  const { match, rules } = logic ? normalizeLogic(logic) : { match: 'all' as const, rules: [] as Rule[] };

  const commit = (nextMatch: 'all' | 'any', next: Rule[]) => onChange(toLogic(nextMatch, next));
  const setRule = (i: number, patch: Partial<Rule>) =>
    commit(match, rules.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const addRule = () => {
    const first = compatible[0];
    if (!first) return;
    commit(match, [...rules, { questionId: first.id, op: operatorsFor(first)[0], value: [] }]);
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium text-foreground">{heading}</p>

      {compatible.length === 0 && rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          There is no earlier question to base this on yet.
        </p>
      ) : (
        <div className="space-y-2">
          {rules.length === 0 && <p className="text-xs text-muted-foreground">{emptyLabel}</p>}

          {rules.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-foreground">
              Match
              <select
                disabled={readOnly} value={match}
                onChange={e => commit(e.target.value as 'all' | 'any', rules)}
                className={`${selectCls} w-auto`}
              >
                <option value="all">all of these rules</option>
                <option value="any">any of these rules</option>
              </select>
            </label>
          )}

          {rules.map((rule, i) => {
            const source = sources.find(e => e.id === rule.questionId);
            return (
              <div key={i} className="space-y-1.5 rounded border border-border bg-background p-2">
                <div className="flex gap-1.5">
                  <select
                    disabled={readOnly} value={rule.questionId}
                    onChange={e => {
                      const next = sources.find(x => x.id === e.target.value);
                      setRule(i, { questionId: e.target.value, op: next ? operatorsFor(next)[0] : 'equals', value: [] });
                    }}
                    className={selectCls}
                  >
                    {!source && <option value={rule.questionId}>(deleted question)</option>}
                    {compatible.map(e => <option key={e.id} value={e.id}>{e.label.slice(0, 60) || e.id}</option>)}
                  </select>
                  {!readOnly && (
                    <button
                      type="button" aria-label="Remove rule"
                      onClick={() => commit(match, rules.filter((_, n) => n !== i))}
                      className="rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {!source ? (
                  <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                    This depends on a question that no longer exists or is no longer earlier in the survey.
                    Pick another above, or remove the rule.
                  </p>
                ) : (
                  <>
                    <select
                      disabled={readOnly} value={rule.op}
                      onChange={e => setRule(i, { op: e.target.value as RuleOperator })}
                      className={selectCls}
                    >
                      {operatorsFor(source).map(op => <option key={op} value={op}>{opLabel(op, source)}</option>)}
                    </select>
                    {!NO_VALUE.includes(rule.op) && (
                      <ValueInput rule={rule} source={source} readOnly={readOnly} onChange={value => setRule(i, { value })} />
                    )}
                  </>
                )}
              </div>
            );
          })}

          {!readOnly && compatible.length > 0 && (
            <button
              type="button" onClick={addRule}
              className="rounded border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              {rules.length === 0 ? 'Add a condition' : '+ Add another rule'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ValueInput({ rule, source, readOnly, onChange }: {
  rule: Rule; source: Question; readOnly: boolean; onChange: (value: string[]) => void;
}) {
  const value = rule.value ?? [];
  const compareOp = rule.op === 'gt' || rule.op === 'gte' || rule.op === 'lt' || rule.op === 'lte';

  const optionList = hasOptions(source) ? source.options : source.type === 'yesno' ? ['Yes', 'No'] : null;
  if (optionList && !compareOp) {
    return (
      <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border bg-background p-2">
        {optionList.map(opt => (
          <label key={opt} className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox" disabled={readOnly}
              checked={value.includes(opt)}
              onChange={e => onChange(e.target.checked ? [...value, opt] : value.filter(v => v !== opt))}
              className="h-3.5 w-3.5 accent-primary"
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (NUMERIC.includes(source.type) || compareOp) {
    return (
      <input
        type="number" disabled={readOnly} value={value[0] ?? ''}
        onChange={e => onChange(e.target.value === '' ? [] : [e.target.value])}
        placeholder="Number" className={selectCls}
      />
    );
  }

  if (source.type === 'date') {
    return (
      <input
        type="date" disabled={readOnly} value={value[0] ?? ''}
        onChange={e => onChange(e.target.value === '' ? [] : [e.target.value])}
        className={selectCls}
      />
    );
  }

  return (
    <div>
      <textarea
        rows={2} disabled={readOnly}
        value={value.join('\n')}
        onChange={e => onChange(e.target.value.split('\n').filter(v => v.trim() !== ''))}
        placeholder="One accepted value per line"
        className={`${selectCls} font-mono text-[11px]`}
      />
      {TEXTUAL.includes(source.type) && (rule.op === 'equals' || rule.op === 'notEquals') && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          "is" matches the whole answer exactly. Use "contains" to match a word inside it, ignoring capitals.
        </p>
      )}
    </div>
  );
}

const selectCls = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/60 disabled:opacity-60';
