import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { fetchAuditLog, type AuditEntry } from '../reportStore';
import {
  fetchOverview, fetchResponseTrend, fetchSurveySummaries,
  type OverviewStats, type SurveySummary,
} from '../platformStore';
import { useAdminSession } from '../AdminGate';
import {
  DataTable, EmptyState, ErrorNote, PageHeader, Skeleton, SkeletonRows,
  Stat, StatRow, StatusPill, Td, relativeTime,
} from '../ui';

export default function Overview() {
  const session = useAdminSession();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [surveys, setSurveys] = useState<SurveySummary[] | null>(null);
  const [trend, setTrend] = useState<{ day: string; n: number }[] | null>(null);
  const [activity, setActivity] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, list, t] = await Promise.all([
          fetchOverview(), fetchSurveySummaries(), fetchResponseTrend(30),
        ]);
        if (cancelled) return;
        setStats(s); setSurveys(list); setTrend(t);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
      // The audit log is owner-only, so a failure here is expected for other
      // roles and must not take the whole dashboard down with it.
      try {
        const log = await fetchAuditLog(null, 8);
        if (!cancelled) setActivity(log);
      } catch {
        if (!cancelled) setActivity([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Live figures across every customer you have access to."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {stats === null && !error ? (
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-background px-4 py-3.5"><Skeleton className="h-12 w-full" /></div>
          ))}
        </div>
      ) : stats && (
        <div className="space-y-px">
          <StatRow>
            <Stat label="Customers" value={stats.customers} />
            <Stat label="Surveys" value={stats.surveys}
                  hint={`${stats.live} live · ${stats.draft} draft${stats.closed ? ` · ${stats.closed} closed` : ''}`} />
            <Stat label="Responses" value={stats.responses} emphasis />
            <Stat label="This month" value={stats.responses_this_month}
                  hint={stats.responses === 0 ? 'no responses collected yet' : undefined} />
          </StatRow>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-foreground">Responses, last 30 days</h2>
        {trend === null ? <Skeleton className="h-24 w-full" /> : <Trend days={trend} />}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Recent surveys</h2>
          <Link to="/admin/surveys"><Button variant="ghost" size="sm">View all</Button></Link>
        </div>
        {surveys === null ? <SkeletonRows rows={3} /> : surveys.length === 0 ? (
          <EmptyState
            title="No surveys yet"
            body="Surveys belong to a customer. Create a customer first, then build its first survey."
            action={<Link to="/admin/customers"><Button size="sm">Go to customers</Button></Link>}
          />
        ) : (
          <DataTable head={['Survey', 'Customer', 'Status', 'Responses', 'Owner', 'Version', 'Updated', '']}>
            {surveys.slice(0, 8).map(s => (
              <tr key={s.slug} className="transition-colors hover:bg-muted/40">
                <Td><span className="font-medium text-foreground">{s.title}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">/s/{s.slug}</span></Td>
                <Td className="text-muted-foreground">{s.organization_name ?? 'Unfiled'}</Td>
                <Td><StatusPill status={s.status} /></Td>
                <Td className="tabular-nums">{s.responses.toLocaleString()}</Td>
                <Td className="max-w-[12rem] truncate text-muted-foreground" >{s.created_by ?? '—'}</Td>
                <Td className="tabular-nums text-muted-foreground">v{s.current_version}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(s.updated_at)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Link to={`/admin/${s.slug}`}><Button variant="ghost" size="sm">Edit</Button></Link>
                    <Link to={`/admin/${s.slug}/report`}><Button variant="ghost" size="sm">Results</Button></Link>
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-foreground">Recent activity</h2>
        {activity === null ? <SkeletonRows rows={2} /> : activity.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {session.can(null, 'owner')
              ? 'Nothing recorded yet. Publishing a survey or exporting data will appear here.'
              : 'Activity is visible to owners only.'}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {activity.map(a => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="text-foreground">{a.action_type.toLowerCase().replace(/_/g, ' ')}</span>
                  <span className="ml-2 text-muted-foreground">{a.user_email}</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {relativeTime(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * One series, so no legend and one hue: bar length already carries the only
 * variable there is. Only the peak is labelled; the rest is on hover, because
 * a number above every bar competes with the shape it is describing.
 */
function Trend({ days }: { days: { day: string; n: number }[] }) {
  if (days.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No responses in the last 30 days.
      </p>
    );
  }
  const max = Math.max(...days.map(d => d.n));
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex h-24 items-end gap-[3px] overflow-x-auto">
        {days.map(d => (
          <div key={d.day} className="group relative flex min-w-[8px] flex-1 flex-col justify-end" style={{ height: '100%' }}>
            <div
              className="rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary"
              style={{ height: `${Math.max(3, (d.n / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute -top-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] tabular-nums text-background opacity-0 transition-opacity group-hover:opacity-100">
              {d.n} on {new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{new Date(days[0].day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>peak {max}</span>
        <span>{new Date(days[days.length - 1].day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  );
}
