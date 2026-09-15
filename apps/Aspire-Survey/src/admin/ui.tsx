import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import {
  INVITATION_STATUS_LABEL, PRIVACY_MODE_LABEL, SURVEY_STATUS_LABEL,
  type InvitationStatus, type PrivacyMode, type SurveyStatus,
} from './labels';

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

// ── Sprint 2B additions ──────────────────────────────────────────────────

/** Status reads as a shape as well as a word, so a table scans without reading. */
export function SurveyStatusPill({ status }: { status: SurveyStatus }) {
  const tone: Record<SurveyStatus, string> = {
    LIVE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    DRAFT: 'bg-muted text-muted-foreground',
    CLOSED: 'bg-amber-500/10 text-amber-700 dark:text-amber-500',
    ARCHIVED: 'bg-muted text-muted-foreground/70',
  };
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
      tone[status],
    )}>
      {status === 'LIVE' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {SURVEY_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Privacy mode is never colour-only: Confidential carries a distinct icon
 * glyph as well as its own tone, so the one badge someone must never misread
 * is legible even without colour.
 */
export function PrivacyModePill({ mode }: { mode: PrivacyMode }) {
  const tone: Record<PrivacyMode, string> = {
    ANONYMOUS: 'bg-muted text-muted-foreground',
    ANONYMOUS_TRACKED: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    CONFIDENTIAL: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  };
  const glyph: Record<PrivacyMode, string> = {
    ANONYMOUS: '○',
    ANONYMOUS_TRACKED: '◐',
    CONFIDENTIAL: '●',
  };
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium',
      tone[mode],
    )}>
      <span aria-hidden className="leading-none">{glyph[mode]}</span>
      {PRIVACY_MODE_LABEL[mode]}
    </span>
  );
}

export function InvitationStatusPill({ status }: { status: InvitationStatus }) {
  const tone: Record<InvitationStatus, string> = {
    NOT_SENT: 'bg-muted text-muted-foreground',
    SENT: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    OPENED: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
    STARTED: 'bg-amber-500/10 text-amber-700 dark:text-amber-500',
    COMPLETED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    EXPIRED: 'bg-muted text-muted-foreground/70',
    REVOKED: 'bg-destructive/10 text-destructive',
  };
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
      tone[status],
    )}>
      {INVITATION_STATUS_LABEL[status]}
    </span>
  );
}

export function SearchInput({
  value, onChange, placeholder = 'Search…', className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">⌕</span>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-3 text-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}

export function FilterSelect({
  value, onChange, options, label,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
    >
      <option value="">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
}

/** A row-actions overflow menu. Disabled items stay visible with a reason, rather than being hidden or linking to a dead page. */
export function RowMenu({ items, label = 'Actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(o => !o)}>
        ⋯
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-md border border-border bg-background py-1 shadow-lg">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              onClick={() => { if (item.disabled) return; setOpen(false); item.onSelect?.(); }}
              className={cn(
                'block w-full px-3 py-1.5 text-left text-sm transition-colors',
                item.disabled
                  ? 'cursor-not-allowed text-muted-foreground/50'
                  : item.destructive
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground hover:bg-muted',
              )}
            >
              {item.label}
              {item.disabled && item.disabledReason && (
                <span className="block text-[10px] leading-tight text-muted-foreground/70">{item.disabledReason}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog({
  title, body, confirmLabel = 'Confirm', destructive, busy, onConfirm, onCancel,
}: {
  title: string; body: ReactNode; confirmLabel?: string; destructive?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">{title}</h2>
        <div className="mb-5 text-sm leading-relaxed text-muted-foreground">{body}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
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
