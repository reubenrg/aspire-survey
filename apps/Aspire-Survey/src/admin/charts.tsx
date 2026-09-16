/**
 * Plain CSS bar charts. No charting library is a project dependency, and a
 * handful of horizontal/vertical bars do not need one (Part 20: prefer
 * lightweight, avoid decorative charts, reuse what exists before adding a
 * dependency). Every bar carries its own label, count and percentage as
 * visible text - never color-only - and a title attribute for the exact figures.
 */
import { cn } from '../lib/utils';

export interface BarDatum {
  label: string;
  n: number;
  pct?: number;
}

export function BarChart({ data, maxBars = 12 }: { data: BarDatum[]; maxBars?: number }) {
  const shown = data.slice(0, maxBars);
  const max = Math.max(1, ...shown.map(d => d.n));
  return (
    <div className="space-y-2">
      {shown.map((d, i) => (
        <div key={i} title={`${d.label}: ${d.n}${d.pct !== undefined ? ` (${d.pct}%)` : ''}`}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-foreground">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {d.n.toLocaleString()}{d.pct !== undefined ? ` · ${d.pct}%` : ''}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(2, (d.n / max) * 100)}%` }} />
          </div>
        </div>
      ))}
      {data.length > maxBars && (
        <p className="text-[11px] text-muted-foreground">+ {data.length - maxBars} more, not shown.</p>
      )}
    </div>
  );
}

/** A compact sparkline-style trend, matching the shape already used on the platform Overview page. */
export function TrendChart({ points }: { points: { bucketStart: string; n: number }[] }) {
  if (points.length === 0) {
    return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No responses in range.</p>;
  }
  const max = Math.max(1, ...points.map(p => p.n));
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex h-24 items-end gap-[3px] overflow-x-auto">
        {points.map((p, i) => (
          <div key={i} className="group relative flex min-w-[8px] flex-1 flex-col justify-end" style={{ height: '100%' }} title={`${p.n} on ${new Date(p.bucketStart).toLocaleDateString()}`}>
            <div className="rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(3, (p.n / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{new Date(points[0].bucketStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>peak {max}</span>
        <span>{new Date(points[points.length - 1].bucketStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  );
}

/** For a matrix row's distribution across a scale: stacked segments, one color intensity per scale step, labeled. */
export function ScaleDistributionRow({ label, scale, counts, total }: { label: string; scale: string[]; counts: Record<string, number>; total: number }) {
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{total} response{total === 1 ? '' : 's'}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {scale.map((s, i) => {
          const n = counts[s] ?? 0;
          const pct = total > 0 ? (n / total) * 100 : 0;
          if (pct === 0) return null;
          const intensity = 0.35 + (i / Math.max(1, scale.length - 1)) * 0.65;
          return (
            <div
              key={s}
              title={`${s}: ${n} (${Math.round(pct)}%)`}
              className={cn('h-full first:rounded-l-full last:rounded-r-full')}
              style={{ width: `${pct}%`, background: `color-mix(in srgb, var(--primary, #2961B6) ${Math.round(intensity * 100)}%, transparent)` }}
            />
          );
        })}
      </div>
    </div>
  );
}
