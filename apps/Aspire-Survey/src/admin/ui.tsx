import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Shared admin primitives. Every later screen composes from these so spacing,
 * type scale and states stay consistent rather than being re-invented per page.
 */

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-xl tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Metric tile. `hint` carries the qualifier so the number stays unambiguous. */
export function Stat({
  label, value, hint, emphasis = false,
}: { label: string; value: string | number; hint?: string; emphasis?: boolean }) {
  return (
    <div className="bg-background px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 font-display tabular-nums leading-none text-foreground',
        emphasis ? 'text-3xl' : 'text-2xl',
      )}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}

/** Status reads as a shape as well as a word, so a table scans without reading. */
export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    LIVE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    DRAFT: 'bg-muted text-muted-foreground',
    CLOSED: 'bg-amber-500/10 text-amber-700 dark:text-amber-500',
    ARCHIVED: 'bg-muted text-muted-foreground/70',
    ACTIVE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    INACTIVE: 'bg-muted text-muted-foreground/70',
  };
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
      tone[status] ?? 'bg-muted text-muted-foreground',
    )}>
      {status === 'LIVE' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {status}
    </span>
  );
}

export function RolePill({ role }: { role: string | null }) {
  if (!role) return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">no access</span>;
  return (
    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
      {role}
    </span>
  );
}

/** An empty state should say what to do next, not merely that there is nothing. */
export function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function AccessDenied({ what, need }: { what: string; need: string }) {
  return (
    <div className="rounded-lg border border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">You cannot {what}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        This needs the <strong>{need}</strong> role. Your access is set per customer, so ask an owner
        to grant it for the customer you need.
      </p>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-md border border-border border-l-4 border-l-destructive bg-destructive/5 px-4 py-3">
      <p className="text-xs leading-relaxed text-destructive">{children}</p>
    </div>
  );
}

/** Skeletons match the shape of what loads, so the page does not jump. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}

export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {head.map(h => (
              <th key={h} className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('border-b border-border/60 px-3 py-2.5 align-middle', className)}>{children}</td>;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
