import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { Alert, useAdminSession } from './AdminGate';
import { getSurvey, type SurveyRow } from './adminStore';
import {
  downloadFile, exportResponsesCsv, fetchAuditLog, fetchBreakdown, fetchReportColumns,
  fetchStats, setClosed,
  type AuditEntry, type Breakdown, type ReportColumn, type ReportStats,
} from './reportStore';

type Tab = 'overview' | 'questions' | 'export' | 'audit';

export default function ReportPage() {
  const { slug = '' } = useParams();
  const session = useAdminSession();
  const [row, setRow] = useState<SurveyRow | null>(null);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await getSurvey(slug);
      if (!found) { setError(`No survey called "${slug}".`); return; }
      setRow(found);
      if (found.organization_id) await session.refreshRole(found.organization_id);
      const [s, c] = await Promise.all([fetchStats(slug), fetchReportColumns(slug)]);
      setStats(s);
      setColumns(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [slug, session]);

  useEffect(() => { void load(); }, [load]);

  const orgId = row?.organization_id ?? null;
  const canAnalyse = session.can(orgId, 'analyst');
  const canClose = session.can(orgId, 'editor');
  const isClosed = Boolean((row as unknown as { closed_at?: string } | null)?.closed_at);

  const exportCsv = async () => {
    if (!row) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const { csv, rows } = await exportResponsesCsv(slug, row.table_name, orgId);
      if (rows === 0) { setNote('No responses to export yet.'); return; }
      downloadFile(`${slug}-responses-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      setNote(`Exported ${rows} response${rows === 1 ? '' : 's'}. This download was recorded in the audit log.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !row) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Alert>{error}</Alert>
        <Link to="/admin" className="mt-3 inline-block text-sm text-primary underline">Back to surveys</Link>
      </div>
    );
  }
  if (!row) return <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/admin/${slug}`} className="text-xs text-muted-foreground hover:text-foreground">
            ← Back to the builder
          </Link>
          <h1 className="mt-1 font-display text-xl text-foreground">{row.title}</h1>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            /s/{row.slug} · v{row.current_version}
            {' · '}
            <span className={isClosed ? 'text-muted-foreground' : 'text-primary'}>
              {isClosed ? 'closed' : row.published ? 'open' : 'draft'}
            </span>
          </p>
        </div>
        {canClose && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null);
              try { await setClosed(slug, orgId, !isClosed); await load(); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              finally { setBusy(false); }
            }}
          >
            {isClosed ? 'Reopen survey' : 'Close survey'}
          </Button>
        )}
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {note && (
        <div className="mb-4 rounded-md border border-border border-l-4 border-l-primary bg-primary/5 px-4 py-2">
          <p className="text-xs text-primary">{note}</p>
        </div>
      )}

      {!canAnalyse ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">Results are limited to analysts</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            You can see and edit this survey, but not the answers people gave. Ask an owner for the
            analyst role if you need them.
          </p>
        </div>
      ) : (
        <>
          <nav className="mb-5 flex gap-1 border-b border-border">
            {(['overview', 'questions', 'export', 'audit'] as Tab[]).map(t => (
              <button
                key={t} onClick={() => setTab(t)}
                className={cn(
                  'px-3 py-2 text-sm capitalize transition-colors',
                  tab === t
                    ? 'border-b-2 border-primary font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </nav>

          {tab === 'overview' && <Overview stats={stats} />}
          {tab === 'questions' && <Questions slug={slug} columns={columns} total={stats?.total ?? 0} />}
          {tab === 'export' && (
            <ExportTab onExport={exportCsv} busy={busy} total={stats?.total ?? 0} table={row.table_name} />
          )}
          {tab === 'audit' && <AuditTab organizationId={orgId} canRead={session.can(orgId, 'owner')} />}
        </>
      )}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────

function Overview({ stats }: { stats: ReportStats | null }) {
  if (!stats) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (stats.total === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="text-sm font-medium text-foreground">No responses yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Figures appear here as they come in.</p>
      </div>
    );
  }

  const versions = Object.entries(stats.by_version).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-8">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <Stat label="Responses" value={stats.total.toLocaleString()} />
        <Stat label="First" value={formatDate(stats.first_at)} />
        <Stat label="Latest" value={formatDate(stats.last_at)} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-foreground">Responses per day</h2>
        <DayChart days={stats.by_day} />
      </section>

      {versions.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-medium text-foreground">By survey version</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Which version of the questions each person actually saw. Answers collected under
            different versions are not always comparable.
          </p>
          <BarList
            items={versions.map(([v, n]) => ({
              label: v === 'unversioned' ? 'Before versioning' : `Version ${v}`,
              n,
            }))}
            total={stats.total}
          />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-display tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** Daily counts. One series, so no legend; only the peak is labelled. */
function DayChart({ days }: { days: { day: string; n: number }[] }) {
  if (days.length === 0) return <p className="text-sm text-muted-foreground">No dated responses.</p>;
  const max = Math.max(...days.map(d => d.n));

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit items-end gap-[2px]" style={{ height: '7rem' }}>
        {days.map(d => (
          <div key={d.day} className="group relative flex w-6 flex-col justify-end" style={{ height: '100%' }}>
            <div
              className="rounded-t-[4px] bg-primary transition-colors group-hover:bg-primary/80"
              style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] tabular-nums text-background opacity-0 transition-opacity group-hover:opacity-100">
              {d.n} on {formatDate(d.day)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{formatDate(days[0].day)}</span>
        <span>peak {max}</span>
        <span>{formatDate(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

// ── Per-question ───────────────────────────────────────────────────────────

function Questions({ slug, columns, total }: { slug: string; columns: ReportColumn[]; total: number }) {
  const [data, setData] = useState<Record<string, Breakdown[]>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const chartable = useMemo(() => columns.filter(c => c.chartable), [columns]);
  const freeText = useMemo(() => columns.filter(c => !c.chartable), [columns]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          chartable.map(async c => [c.column_name, await fetchBreakdown(slug, c.column_name)] as const),
        );
        if (!cancelled) setData(Object.fromEntries(entries));
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [slug, chartable]);

  if (failed) return <Alert>{failed}</Alert>;
  if (total === 0) return <p className="text-sm text-muted-foreground">No responses yet.</p>;

  return (
    <div className="space-y-8">
      {chartable.map(c => {
        const rows = data[c.column_name];
        const tally = rows?.reduce((n, r) => n + r.n, 0) ?? 0;
        // A multi-select tallies choices, not people: someone picking three
        // options counts three times. Summing it as "answered" produced
        // nonsense like "41 of 23 answered", and percentages of selections
        // understate how many people picked each option. Percentages are of
        // respondents either way, which is what a reader assumes.
        const isMulti = c.question_type === 'checkbox';
        const denominator = isMulti ? total : tally;
        return (
          <section key={c.column_name}>
            <h2 className="text-sm font-medium text-foreground">{c.label || c.question_id}</h2>
            <p className="mb-3 font-mono text-[11px] text-muted-foreground">
              {c.column_name} · {isMulti
                ? `${tally} selection${tally === 1 ? '' : 's'} across ${total} response${total === 1 ? '' : 's'}`
                : `${tally} of ${total} answered`}
            </p>
            {rows === undefined
              ? <p className="text-sm text-muted-foreground">Loading…</p>
              : rows.length === 0
                ? <p className="text-sm text-muted-foreground">No answers.</p>
                : <BarList items={rows.map(r => ({ label: r.value, n: r.n }))} total={denominator} />}
          </section>
        );
      })}

      {freeText.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-medium text-foreground">Written answers</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Open text is not charted: every answer is different, so a distribution would just be the
            answers themselves with a count of one beside each. Read them in the CSV export.
          </p>
          <ul className="space-y-1.5">
            {freeText.map(c => (
              <li key={c.column_name} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
                <span className="text-sm text-foreground">{c.label || c.question_id}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{c.column_name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Horizontal magnitude bars. One hue throughout: these compare sizes within a
 * single question, so colour would encode nothing that length does not already
 * say. Values are labelled on every row because the list doubles as the table
 * view, which is what keeps it readable without relying on colour.
 */
function BarList({ items, total }: { items: { label: string; n: number }[]; total: number }) {
  const max = Math.max(1, ...items.map(i => i.n));
  return (
    <div className="space-y-2">
      {items.map(item => {
        const pct = total > 0 ? (item.n / total) * 100 : 0;
        return (
          <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <p className="mb-1 truncate text-sm text-foreground" title={item.label}>{item.label}</p>
              <div className="h-2 w-full rounded-[2px] bg-muted">
                <div
                  className="h-full rounded-[4px] bg-primary"
                  style={{ width: `${Math.max(1, (item.n / max) * 100)}%` }}
                />
              </div>
            </div>
            <p className="whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{item.n}</span>
              {' '}<span className="text-xs">{pct.toFixed(0)}%</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Export ─────────────────────────────────────────────────────────────────

function ExportTab({
  onExport, busy, total, table,
}: { onExport: () => void; busy: boolean; total: number; table: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-5">
        <h2 className="text-sm font-medium text-foreground">Export responses</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every response from <code className="font-mono text-xs">{table}</code> as CSV, one row per
          person, including identifying columns and written answers.
        </p>
        <p className="mt-3 max-w-prose text-xs text-muted-foreground">
          Downloads are recorded in the audit log with your email, the survey and the row count. The
          entry is written before the file is produced, so an export that is not logged does not
          happen.
        </p>
        <Button className="mt-4" onClick={onExport} disabled={busy || total === 0}>
          {busy ? 'Preparing…' : `Download CSV (${total} response${total === 1 ? '' : 's'})`}
        </Button>
      </div>
    </div>
  );
}

// ── Audit ──────────────────────────────────────────────────────────────────

function AuditTab({ organizationId, canRead }: { organizationId: string | null; canRead: boolean }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) return;
    fetchAuditLog(organizationId)
      .then(setEntries)
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [organizationId, canRead]);

  if (!canRead) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="text-sm font-medium text-foreground">The audit log is owner-only</p>
        <p className="mt-1 text-sm text-muted-foreground">
          It records who exported data, so it is itself restricted.
        </p>
      </div>
    );
  }
  if (error) return <Alert>{error}</Alert>;
  if (entries === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className="border-b border-border/60">
              <td className="py-2 pr-3 align-top font-mono text-[11px] tabular-nums text-muted-foreground">
                {new Date(e.created_at).toLocaleString()}
              </td>
              <td className="py-2 pr-3 align-top text-foreground">{e.user_email}</td>
              <td className="py-2 pr-3 align-top">
                <ActionPill action={e.action_type} />
              </td>
              <td className="py-2 align-top font-mono text-[11px] text-muted-foreground">
                {Object.entries(e.details).map(([k, v]) => `${k}=${String(v)}`).join(' ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Export is the one action that moves data out, so it reads differently. */
function ActionPill({ action }: { action: string }) {
  const notable = action === 'DATA_EXPORTED';
  return (
    <span className={cn(
      'whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px]',
      notable ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
    )}>
      {action.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="pb-2 pr-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
