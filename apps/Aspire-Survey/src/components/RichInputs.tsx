import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { ACCEPT, checkFile, fileNameOf, uploadAnswerFile, useUploadScope, type AcceptKind } from '../engine/uploads';

/**
 * Respondent inputs for the richer question types. Like ScaleInputs they know
 * nothing about surveys: a value in, a new value out.
 */

const box = 'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring/30';
const border = (error: boolean) => (error ? 'border-destructive' : 'border-border focus:border-primary/60');

export function SumInput({ rows, total, unit, values, error, label, onChange }: {
  rows: string[]; total: number; unit?: string; values: Record<string, string>; error: boolean; label: string;
  onChange: (next: Record<string, string>) => void;
}) {
  const nums = rows.map(r => Number(values[r] || 0));
  const sum = Math.round(nums.reduce((a, b) => (Number.isFinite(b) ? a + b : a), 0) * 1e6) / 1e6;
  const left = Math.round((total - sum) * 1e6) / 1e6;
  return (
    <div role="group" aria-label={label} className="space-y-2">
      {rows.map(r => (
        <label key={r} className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm text-foreground">{r}</span>
          <input
            type="number" inputMode="decimal" min={0} step="any" value={values[r] ?? ''}
            onChange={e => onChange({ ...values, [r]: e.target.value })}
            aria-label={r}
            className={cn(box, border(error), 'w-28 text-right tabular-nums')}
          />
          {unit && <span className="w-10 text-xs text-muted-foreground">{unit}</span>}
        </label>
      ))}
      <div className={cn('flex items-center justify-between rounded-md px-3 py-2 text-sm tabular-nums', left === 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} aria-live="polite">
        <span>Total {sum} of {total}{unit ? ` ${unit}` : ''}</span>
        <span>{left === 0 ? 'Done' : left > 0 ? `${left} left` : `${-left} over`}</span>
      </div>
    </div>
  );
}

export function MultiTextInput({ rows, values, error, label, onChange }: {
  rows: string[]; values: Record<string, string>; error: boolean; label: string; onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div role="group" aria-label={label} className="space-y-2.5">
      {rows.map(r => (
        <label key={r} className="block space-y-1">
          <span className="text-xs text-muted-foreground">{r}</span>
          <input type="text" value={values[r] ?? ''} onChange={e => onChange({ ...values, [r]: e.target.value })} className={cn(box, border(error))} />
        </label>
      ))}
    </div>
  );
}

export function FullNameInput({ first, last, error, onChange }: {
  first: string; last: string; error: boolean; onChange: (first: string, last: string) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">First name</span>
        <input type="text" autoComplete="given-name" value={first} onChange={e => onChange(e.target.value, last)} className={cn(box, border(error))} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Last name</span>
        <input type="text" autoComplete="family-name" value={last} onChange={e => onChange(first, e.target.value)} className={cn(box, border(error))} />
      </label>
    </div>
  );
}

export function ImageChoice({ options, images, multiple, value, label, showOption, onChange }: {
  options: string[]; images: string[]; multiple: boolean; value: string[]; label: string;
  showOption: (o: string) => string; onChange: (next: string[]) => void;
}) {
  const pick = (o: string) => {
    if (!multiple) return onChange([o]);
    onChange(value.includes(o) ? value.filter(v => v !== o) : [...value, o]);
  };
  return (
    <div role={multiple ? 'group' : 'radiogroup'} aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {options.map(o => {
        const on = value.includes(o);
        const src = images[options.indexOf(o)];
        return (
          <button
            key={o} type="button" role={multiple ? 'checkbox' : 'radio'} aria-checked={on}
            onClick={() => pick(o)}
            className={cn(
              'overflow-hidden rounded-lg border-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              on ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            )}
          >
            {src ? (
              <img src={src} alt="" loading="lazy" className="aspect-[4/3] w-full bg-muted object-cover" />
            ) : (
              <div className="grid aspect-[4/3] w-full place-items-center bg-muted text-xs text-muted-foreground">No image</div>
            )}
            <span className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-foreground">
              {showOption(o)}
              {on && <span aria-hidden className="text-primary">✓</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FileUpload({ value, maxSizeMb, accept, error, label, onChange }: {
  value: string; maxSizeMb: number; accept: AcceptKind; error: boolean; label: string; onChange: (path: string) => void;
}) {
  const scope = useUploadScope();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const bad = checkFile(file, { maxSizeMb, accept });
    if (bad) { setProblem(bad); return; }
    setProblem(null);
    // In the Builder preview there is no survey to upload to: pretend, so the flow can be judged.
    if (!scope) { onChange(`preview/${file.name}`); return; }
    setBusy(true);
    try { onChange(await uploadAnswerFile(scope.slug, file, file.name)); }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return (
    <div>
      <input
        ref={input} type="file" accept={ACCEPT[accept].input} aria-label={label} disabled={busy}
        onChange={e => void choose(e.target.files?.[0])}
        className={cn('block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70', error && 'rounded-md ring-1 ring-destructive')}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">Up to {maxSizeMb} MB. Choose {ACCEPT[accept].label}.{!scope && ' (Uploads are simulated in preview.)'}</p>
      {busy && <p className="mt-1 text-xs text-muted-foreground">Uploading…</p>}
      {value && !busy && (
        <p className="mt-2 flex items-center gap-2 rounded-md bg-primary/5 px-3 py-1.5 text-sm text-foreground">
          <span aria-hidden className="text-primary">✓</span>
          <span className="min-w-0 flex-1 truncate">{fileNameOf(value)}</span>
          <button type="button" onClick={() => onChange('')} className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
        </p>
      )}
      {problem && <p role="alert" className="mt-1 text-xs text-destructive">{problem}</p>}
    </div>
  );
}

export function SignaturePad({ value, error, label, onChange }: {
  value: string; error: boolean; label: string; onChange: (path: string) => void;
}) {
  const scope = useUploadScope();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [inked, setInked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d'); if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true; const p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d'); if (!ctx) return;
    const p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setInked(true);
  };
  const up = () => { drawing.current = false; };

  const clear = () => {
    const c = canvas.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setInked(false); setProblem(null); onChange('');
  };

  const save = async () => {
    const c = canvas.current; if (!c || !inked) return;
    if (!scope) { onChange('preview/signature.png'); return; }
    setBusy(true); setProblem(null);
    try {
      const blob: Blob | null = await new Promise(res => c.toBlob(res, 'image/png'));
      if (!blob) throw new Error('The signature could not be captured.');
      onChange(await uploadAnswerFile(scope.slug, new Blob([blob], { type: 'image/png' }), 'signature.png'));
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <canvas
        ref={canvas} width={600} height={180} role="img" aria-label={label}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className={cn('w-full touch-none rounded-md border bg-white', error ? 'border-destructive' : 'border-border')}
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={clear} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Clear</button>
        <button type="button" onClick={() => void save()} disabled={!inked || busy}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/60 hover:bg-primary/5 disabled:opacity-50">
          {busy ? 'Saving…' : value ? 'Replace saved signature' : 'Use this signature'}
        </button>
        {value && !busy && <span className="text-xs text-primary">✓ Signature saved</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Draw with your finger, a pen or the mouse, then choose “Use this signature”.</p>
      {problem && <p role="alert" className="mt-1 text-xs text-destructive">{problem}</p>}
    </div>
  );
}
