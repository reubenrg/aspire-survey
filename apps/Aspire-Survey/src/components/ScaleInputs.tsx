import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Respondent-facing inputs for the scale-style question types. Each is a real
 * radio group / range / list of buttons, so they work with a keyboard and a
 * screen reader, not just a mouse. They know nothing about surveys: they take a
 * value and report a new one, and the engine decides what to store.
 */

const chip = 'rounded-md border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
const chipOn = 'border-primary bg-primary text-primary-foreground';
const chipOff = 'border-border bg-background text-foreground hover:border-primary/60 hover:bg-primary/5';

function Ends({ low, high }: { low?: string; high?: string }) {
  if (!low && !high) return null;
  return (
    <div className="mt-1.5 flex justify-between gap-4 text-xs text-muted-foreground">
      <span>{low}</span>
      <span className="text-right">{high}</span>
    </div>
  );
}

export function RatingInput({ value, max, shape, low, high, label, onChange }: {
  value: string; max: number; shape: 'star' | 'number'; low?: string; high?: string; label: string;
  onChange: (v: string) => void;
}) {
  const [hover, setHover] = useState(0);
  const current = Number(value) || 0;
  const shown = hover || current;
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5" onMouseLeave={() => setHover(0)}>
        {Array.from({ length: max }, (_, i) => i + 1).map(n => {
          const on = shape === 'star' ? n <= shown : n === current;
          return (
            <button
              key={n} type="button" role="radio" aria-checked={n === current}
              aria-label={`${n} of ${max}`}
              onMouseEnter={() => setHover(n)}
              onClick={() => onChange(String(n))}
              className={cn(
                shape === 'star'
                  ? 'rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
                  : cn(chip, 'h-10 w-10', on ? chipOn : chipOff),
              )}
            >
              {shape === 'star'
                ? <Star className={cn('h-8 w-8 transition-colors', on ? 'fill-primary text-primary' : 'text-border')} />
                : n}
            </button>
          );
        })}
      </div>
      <Ends low={low} high={high} />
    </div>
  );
}

export function NpsInput({ value, low, high, label, onChange }: {
  value: string; low?: string; high?: string; label: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
        {Array.from({ length: 11 }, (_, i) => i).map(n => (
          <button
            key={n} type="button" role="radio" aria-checked={value === String(n)}
            onClick={() => onChange(String(n))}
            className={cn(chip, 'h-10', value === String(n) ? chipOn : chipOff)}
          >
            {n}
          </button>
        ))}
      </div>
      <Ends low={low} high={high} />
    </div>
  );
}

export function YesNoInput({ value, yes, no, label, onChange }: {
  value: string; yes: string; no: string; label: string; onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {([['Yes', yes], ['No', no]] as const).map(([stored, shown]) => (
        <button
          key={stored} type="button" role="radio" aria-checked={value === stored}
          onClick={() => onChange(stored)}
          className={cn(chip, 'min-w-[5.5rem] px-5 py-2', value === stored ? chipOn : chipOff)}
        >
          {shown}
        </button>
      ))}
    </div>
  );
}

export function SliderInput({ value, min, max, step, unit, low, high, label, error, onChange }: {
  value: string; min: number; max: number; step: number; unit?: string; low?: string; high?: string;
  label: string; error: boolean; onChange: (v: string) => void;
}) {
  const answered = value !== '';
  const mid = String(Math.round((min + (max - min) / 2) / step) * step);
  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="range" min={min} max={max} step={step}
          value={answered ? value : mid}
          aria-label={label} aria-invalid={error || undefined}
          onChange={e => onChange(e.target.value)}
          // Without this a respondent who wants exactly the starting position could never register it.
          onPointerUp={e => onChange(e.currentTarget.value)}
          className={cn('h-2 w-full cursor-pointer accent-primary', !answered && 'opacity-50')}
        />
        <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
          {answered ? `${value}${unit ? ` ${unit}` : ''}` : '—'}
        </span>
      </div>
      <Ends low={low} high={high} />
      {!answered && <p className="mt-1 text-xs text-muted-foreground">Move or tap the slider to answer.</p>}
    </div>
  );
}

export function RankingInput({ order, options, confirmed, label, showOption, onChange }: {
  /** The order currently shown (a respondent's own once confirmed, otherwise the starting order). */
  order: string[];
  options: string[];
  confirmed: boolean;
  label: string;
  showOption: (opt: string) => string;
  onChange: (next: string[]) => void;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      <ol aria-label={label} className="space-y-1.5">
        {order.map((opt, i) => (
          <li
            key={opt}
            className={cn(
              'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
              confirmed ? 'border-primary/40 bg-primary/5' : 'border-border bg-background',
            )}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-foreground">{showOption(opt)}</span>
            <span className="flex shrink-0 gap-1">
              <button
                type="button" aria-label={`Move ${showOption(opt)} up`} disabled={i === 0}
                onClick={() => move(i, -1)}
                className="grid h-7 w-7 place-items-center rounded border border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-30"
              >↑</button>
              <button
                type="button" aria-label={`Move ${showOption(opt)} down`} disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
                className="grid h-7 w-7 place-items-center rounded border border-border text-xs text-muted-foreground hover:bg-muted disabled:opacity-30"
              >↓</button>
            </span>
          </li>
        ))}
      </ol>
      {!confirmed && options.length > 0 && (
        <button
          type="button" onClick={() => onChange(order)}
          className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/60 hover:bg-primary/5"
        >
          This order is right
        </button>
      )}
    </div>
  );
}
