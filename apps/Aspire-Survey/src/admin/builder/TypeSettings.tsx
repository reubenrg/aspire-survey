import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { Question } from '../../engine/types';
import { defaultColumn } from '../../engine/definition';
import { canRandomize } from '../../engine/questionFactory';
import InlineListEditor from './InlineListEditor';

/** One-click starting scales for a matrix, in the wording this product uses elsewhere (see the seeded Template Library). Applying one replaces the current scale outright - it is a starting point, not a merge. */
const SCALE_PRESETS: Record<string, string[]> = {
  Agreement: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  Frequency: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
  Confidence: ['Not at all confident', 'Slightly confident', 'Moderately confident', 'Very confident', 'Extremely confident'],
  Satisfaction: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
  Extent: ['Not at all', 'To a small extent', 'To a moderate extent', 'To a large extent', 'To a very large extent'],
};

interface Props {
  question: Question;
  readOnly: boolean;
  onChange: (q: Question) => void;
}

const num = (v: string): number | undefined => (v === '' ? undefined : Number(v));

/**
 * Everything specific to the selected question's type: options, limits,
 * formats, scales. Shared by the Builder's properties panel and the older
 * /admin/:slug editor so both offer exactly what the engine supports.
 */
export default function TypeSettings({ question: q, readOnly, onChange }: Props) {
  const set = (patch: Record<string, unknown>) => onChange({ ...q, ...patch } as Question);
  const numberInput = (key: string, value: number | undefined, extra?: { min?: number; max?: number; step?: number }) => (
    <input
      disabled={readOnly} type="number" value={value ?? ''} {...extra}
      onChange={e => set({ [key]: num(e.target.value) })}
      className={inputCls}
    />
  );
  const textInput = (key: string, value: string | undefined, placeholder?: string) => (
    <input
      disabled={readOnly} value={value ?? ''} placeholder={placeholder}
      onChange={e => set({ [key]: e.target.value || undefined })}
      className={inputCls}
    />
  );
  const lowHigh = (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Low end label">{textInput('lowLabel', 'lowLabel' in q ? q.lowLabel : undefined, 'e.g. Not at all')}</Field>
      <Field label="High end label">{textInput('highLabel', 'highLabel' in q ? q.highLabel : undefined, 'e.g. Extremely')}</Field>
    </div>
  );

  switch (q.type) {
    case 'text':
      return (
        <>
          <Field label="Placeholder">{textInput('placeholder', q.placeholder)}</Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min length">{numberInput('minLength', q.minLength, { min: 0 })}</Field>
            <Field label="Max length">{numberInput('maxLength', q.maxLength, { min: 1 })}</Field>
          </div>
          <Field label="Format (regular expression)" hint="Optional. The whole answer must match, e.g. [0-9]{6} for a six-digit code.">
            <input
              disabled={readOnly} value={q.pattern ?? ''}
              onChange={e => set({ pattern: e.target.value || undefined })}
              className={cn(inputCls, 'font-mono text-xs')}
            />
          </Field>
          {q.pattern && (
            <Field label="Message when the format does not match">{textInput('patternMessage', q.patternMessage)}</Field>
          )}
        </>
      );

    case 'textarea':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min length">{numberInput('minLength', q.minLength, { min: 0 })}</Field>
          <Field label="Max length">{numberInput('maxLength', q.maxLength, { min: 1 })}</Field>
        </div>
      );

    case 'email':
      return (
        <>
          <Field label="Placeholder">{textInput('placeholder', q.placeholder, 'name@company.com')}</Field>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            An email address identifies a person, so it is never shown in Analytics or counted in
            summaries. Do not add one to an anonymous survey.
          </p>
        </>
      );

    case 'number':
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Minimum">{numberInput('min', q.min)}</Field>
            <Field label="Maximum">{numberInput('max', q.max)}</Field>
            <Field label="Step">{numberInput('step', q.step, { min: 0 })}</Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Unit shown after the box">{textInput('unit', q.unit, 'years, %, …')}</Field>
            <Field label="Placeholder">{textInput('placeholder', q.placeholder)}</Field>
          </div>
          <Toggle label="Whole numbers only" checked={!!q.integer} disabled={readOnly} onChange={integer => set({ integer: integer || undefined })} />
        </>
      );

    case 'date':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Earliest date">
            <input type="date" disabled={readOnly} value={q.min ?? ''} onChange={e => set({ min: e.target.value || undefined })} className={inputCls} />
          </Field>
          <Field label="Latest date">
            <input type="date" disabled={readOnly} value={q.max ?? ''} onChange={e => set({ max: e.target.value || undefined })} className={inputCls} />
          </Field>
        </div>
      );

    case 'select':
    case 'radio':
    case 'checkbox':
    case 'ranking':
      return (
        <>
          <Field label="Options" hint="Press Enter to add the next one. Pasting several lines at once adds them all.">
            <InlineListEditor
              readOnly={readOnly}
              items={q.options}
              onChange={options => set({ options })}
              addLabel="+ Add option"
              placeholder="Option text"
            />
          </Field>

          {(q.type === 'radio' || q.type === 'checkbox') && q.options.includes('Other') && (
            <Field label="Column for the “Other” free text" hint="Needed for the box that appears when someone picks Other.">
              <input
                disabled={readOnly}
                value={q.otherColumn ?? ''}
                placeholder={`${defaultColumn(q.id)}_other`}
                onChange={e => set({ otherColumn: e.target.value || undefined })}
                className={cn(inputCls, 'font-mono text-xs')}
              />
            </Field>
          )}

          {q.type === 'select' && <Field label="Placeholder">{textInput('placeholder', q.placeholder, 'Choose…')}</Field>}

          {q.type === 'checkbox' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Minimum selections" hint="Leave empty for none.">
                {numberInput('minSelections', q.minSelections, { min: 0, max: q.options.length || undefined })}
              </Field>
              <Field label="Maximum selections" hint="Leave empty for no limit.">
                {numberInput('maxSelections', q.maxSelections, { min: 1, max: q.options.length || undefined })}
              </Field>
            </div>
          )}

          {canRandomize(q.type) && (
            <Toggle
              label="Show options in a random order"
              hint={'Each respondent sees a different order, which removes order bias. "Other", "None of the above" and "Not applicable" stay last.'}
              checked={!!(q as { randomize?: boolean }).randomize} disabled={readOnly}
              onChange={randomize => set({ randomize: randomize || undefined })}
            />
          )}
        </>
      );

    case 'yesno':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="“Yes” label" hint="Answers are always stored as Yes / No.">{textInput('yesLabel', q.yesLabel, 'Yes')}</Field>
          <Field label="“No” label">{textInput('noLabel', q.noLabel, 'No')}</Field>
        </div>
      );

    case 'rating':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Top rating" hint="3 to 10.">
              <input
                disabled={readOnly} type="number" min={3} max={10} value={q.max ?? 5}
                onChange={e => set({ max: num(e.target.value) })} className={inputCls}
              />
            </Field>
            <Field label="Shown as">
              <select disabled={readOnly} value={q.shape ?? 'star'} onChange={e => set({ shape: e.target.value })} className={inputCls}>
                <option value="star">Stars</option>
                <option value="number">Numbers</option>
              </select>
            </Field>
          </div>
          {lowHigh}
        </>
      );

    case 'nps':
      return (
        <>
          {lowHigh}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Scored 0-10. 9-10 are promoters, 7-8 passives, 0-6 detractors; NPS is promoters minus detractors.
          </p>
        </>
      );

    case 'slider':
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Minimum">{numberInput('min', q.min ?? 0)}</Field>
            <Field label="Maximum">{numberInput('max', q.max ?? 100)}</Field>
            <Field label="Step">{numberInput('step', q.step ?? 1, { min: 0 })}</Field>
          </div>
          <Field label="Unit">{textInput('unit', q.unit, '%, …')}</Field>
          {lowHigh}
        </>
      );

    case 'matrix':
      return (
        <>
          <Field
            label="Statements"
            hint="Order matters: each becomes a numbered column. Adding to the end is safe; reordering after responses exist changes what existing columns mean. Paste several lines at once to add them all."
          >
            <InlineListEditor
              readOnly={readOnly}
              items={q.rows}
              onChange={rows => set({ rows })}
              addLabel="+ Add statement"
              placeholder="Statement"
            />
          </Field>
          <Field label="Scale" hint="Left to right across the grid.">
            {!readOnly && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {Object.entries(SCALE_PRESETS).map(([name, preset]) => (
                  <button
                    key={name} type="button"
                    onClick={() => set({ scale: preset })}
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <InlineListEditor
              readOnly={readOnly}
              items={q.scale}
              onChange={scale => set({ scale })}
              addLabel="+ Add scale point"
              placeholder="Scale point"
            />
          </Field>
          <Field label="Column prefix">
            <input disabled={readOnly} value={q.columnPrefix}
              onChange={e => set({ columnPrefix: e.target.value })}
              className={cn(inputCls, 'font-mono text-xs')} />
          </Field>
        </>
      );
  }
}

function Toggle({ label, hint, checked, disabled, onChange }: {
  label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox" disabled={disabled} checked={checked}
          onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-primary"
        />
        {label}
      </label>
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30 disabled:opacity-60';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
