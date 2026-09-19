import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { checkFile, safeFileName } from '../../engine/uploadRules';

/** Public bucket for the pictures an author attaches to choices; anyone with the survey link may view them. */
export const IMAGE_BUCKET = 'survey-images';

interface Props {
  options: string[];
  images: string[];
  readOnly: boolean;
  onChange: (options: string[], images: string[]) => void;
}

/**
 * Edits the choices of an image question: a label and a picture per row. `images`
 * is kept the same length as `options`, so removing or adding a row never
 * shifts a picture onto the wrong label.
 */
export default function ImageOptionsEditor({ options, images, readOnly, onChange }: Props) {
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pics = options.map((_, i) => images[i] ?? '');

  const update = (i: number, patch: { label?: string; image?: string }) =>
    onChange(options.map((o, n) => (n === i ? patch.label ?? o : o)), pics.map((p, n) => (n === i ? patch.image ?? p : p)));

  const upload = async (i: number, file: File | undefined) => {
    if (!file) return;
    const bad = checkFile(file, { maxSizeMb: 2, accept: 'images' });
    if (bad) { setProblem(bad); return; }
    setProblem(null); setBusy(i);
    try {
      const path = `${crypto.randomUUID()}/${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);
      update(i, { image: supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {options.map((o, i) => (
        <div key={i} className="rounded-md border border-border bg-background p-2">
          <div className="flex items-center gap-2">
            {pics[i] ? <img src={pics[i]} alt="" className="h-10 w-14 shrink-0 rounded object-cover" /> : <div className="grid h-10 w-14 shrink-0 place-items-center rounded bg-muted text-[10px] text-muted-foreground">none</div>}
            <input
              disabled={readOnly} value={o} placeholder="Choice label" aria-label={`Choice ${i + 1} label`}
              onChange={e => update(i, { label: e.target.value })}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary/60"
            />
            {!readOnly && (
              <button
                type="button" aria-label={`Remove choice ${i + 1}`} disabled={options.length <= 2}
                onClick={() => onChange(options.filter((_, n) => n !== i), pics.filter((_, n) => n !== i))}
                className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-30"
              >✕</button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              disabled={readOnly} value={pics[i]} placeholder="Picture address (https://…)" aria-label={`Choice ${i + 1} picture address`}
              onChange={e => update(i, { image: e.target.value })}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-primary/60"
            />
            {!readOnly && (
              <label className={cn('shrink-0 cursor-pointer rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted', busy === i && 'opacity-60')}>
                {busy === i ? 'Uploading…' : 'Upload'}
                <input type="file" accept="image/*" className="sr-only" onChange={e => void upload(i, e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>
      ))}
      {!readOnly && (
        <button
          type="button" onClick={() => onChange([...options, `Option ${options.length + 1}`], [...pics, ''])}
          className="rounded border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          + Add choice
        </button>
      )}
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}
