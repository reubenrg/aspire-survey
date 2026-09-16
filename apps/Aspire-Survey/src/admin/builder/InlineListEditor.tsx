import { useRef } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  items: string[];
  onChange: (items: string[]) => void;
  readOnly?: boolean;
  addLabel?: string;
  placeholder?: string;
  /** Minimum rows to keep - the delete button on the last remaining one disables. */
  min?: number;
}

/**
 * A list of text rows edited in place - add, reorder with up/down, delete -
 * replacing a raw "one per line" textarea. Used for select/radio/checkbox
 * options and for a matrix's rows and scale.
 *
 * This project deliberately has no drag-and-drop library (see StructurePanel's
 * own comment): reordering here follows that same convention, buttons instead
 * of a dnd-kit dependency, rather than introducing a second reorder mechanism.
 *
 * Pasting multi-line text into any row splits it into that many rows at that
 * position - the bulk-add path - so a spreadsheet column or a list typed
 * elsewhere can be dropped in without retyping it one line at a time.
 */
export default function InlineListEditor({ items, onChange, readOnly, addLabel = '+ Add', placeholder, min = 1 }: Props) {
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const focusIndex = useRef<number | null>(null);

  const commit = (next: string[], focusAt: number | null) => {
    focusIndex.current = focusAt;
    onChange(next);
  };

  const setAt = (i: number, value: string) => {
    const next = [...items];
    next[i] = value;
    commit(next, null);
  };

  const insertAfter = (i: number) => {
    const next = [...items.slice(0, i + 1), '', ...items.slice(i + 1)];
    commit(next, i + 1);
  };

  const removeAt = (i: number) => {
    if (items.length <= min) return;
    const next = items.filter((_, idx) => idx !== i);
    commit(next, Math.max(0, i - 1));
  };

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next, j);
  };

  const handlePaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return; // let a single-line paste behave normally
    e.preventDefault();
    const pasted = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (pasted.length === 0) return;
    const next = [...items];
    next.splice(i, 1, ...pasted);
    commit(next, i + pasted.length - 1);
  };

  // Focus whichever row just became the meaningful one, after a re-render.
  if (focusIndex.current !== null) {
    const idx = focusIndex.current;
    focusIndex.current = null;
    requestAnimationFrame(() => inputRefs.current[idx]?.focus());
  }

  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            ref={el => { inputRefs.current[i] = el; }}
            disabled={readOnly}
            value={item}
            placeholder={placeholder}
            onChange={e => setAt(i, e.target.value)}
            onPaste={e => handlePaste(i, e)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (!readOnly) insertAfter(i); }
              else if (e.key === 'Backspace' && item === '' && items.length > min) { e.preventDefault(); removeAt(i); }
            }}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
          />
          {!readOnly && (
            <div className="flex shrink-0 items-center gap-0.5">
              <RowBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</RowBtn>
              <RowBtn label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</RowBtn>
              <RowBtn label="Remove" disabled={items.length <= min} onClick={() => removeAt(i)}>✕</RowBtn>
            </div>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={() => commit([...items, ''], items.length)}
          className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}

function RowBtn({ children, label, disabled, onClick }: { children: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button" aria-label={label} title={label} disabled={disabled}
      onClick={onClick}
      className={cn('grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30')}
    >
      {children}
    </button>
  );
}
