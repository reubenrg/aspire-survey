import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import {
  fetchNpsOverview, fetchResponseOverview, fetchResponseTrend, fetchSurveySummaries,
  type NpsOverviewRow, type ResponseOverviewRow, type SurveySummary,
} from '../platformStore';
import { BarChart, TrendChart } from '../charts';
import { DataTable, EmptyState, ErrorNote, PageHeader, Skeleton, SkeletonRows, Stat, StatRow, Td } from '../ui';

const RANGES = [{ days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: 'Year' }];

/**
 * Cross-survey analysis. Everything here is an aggregate computed in the
 * database - counts, completion, NPS - never an individual answer, so it is
 * safe to show at any privacy mode. Question-level analysis, cross-tabs and
 * segmentation live on each survey's own Analytics screen.
 */
export default function Analytics() {
  const [days, setDays] = useState(90);
  const [summaries, setSummaries] = useState<SurveySummary[] | null>(null);
  const [overview, setOverview] = useState<ResponseOverviewRow[] | null>(null);
  const [nps, setNps] = useState<NpsOverviewRow[] | null>(null);
  const [trend, setTrend] = useState<{ day: string; n: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, o, n] = await Promise.all([fetchSurveySummaries(), fetchResponseOverview(), fetchNpsOverview()]);
        if (cancelled) return;
        setSummaries(s); setOverview(o); setNps(n);
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setSummaries([]); setOverview([]); setNps([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTrend(null);
    fetchResponseTrend(days)
      .then(t => { if (!cancelled) setTrend(t); })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setTrend([]); } });
    return () => { cancelled = true; };
  }, [days]);

  const derived = useMemo(() => {
    const all = summaries ?? [];
    const totalResponses = all.reduce((a, s) => a + s.responses, 0);
    const tracked = all.filter(s => s.audience > 0);
    const audience = tracked.reduce((a, s) => a + s.audience, 0);
    const completed = tracked.reduce((a, s) => a + s.completed, 0);

    const byCustomer = new Map<string, number>();
    for (const s of all) byCustomer.set(s.organization_name ?? 'Unfiled', (byCustomer.get(s.organization_name ?? 'Unfiled') ?? 0) + s.responses);

    const promoters = (nps ?? []).reduce((a, r) => a + r.promoters, 0);
    const detractors = (nps ?? []).reduce((a, r) => a + r.detractors, 0);
    const npsTotal = (nps ?? []).reduce((a, r) => a + r.answers, 0);

    return {
      totalResponses,
      live: all.filter(s => s.status === 'LIVE').length,
      tracked,
      completionRate: audience > 0 ? Math.round((completed / audience) * 1000) / 10 : null,
      completed, audience,
      customers: [...byCustomer.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
      surveys: [...all].sort((a, b) => b.responses - a.responses).map(s => ({ label: s.title, n: s.responses })),
      overallNps: npsTotal > 0 ? Math.round(((promoters - detractors) / npsTotal) * 1000) / 10 : null,
      npsTotal,
    };
  }, [summaries, nps]);

  const loading = summaries === null || overview === null || nps === null;
  const inRange = (trend ?? []).reduce((a, d) => a + d.n, 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="How surveys are performing across every customer. For question-level results, open a survey's own Analytics."
        actions={
          <div role="group" aria-label="Trend range" className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.days} type="button" onClick={() => setDays(r.days)} aria-pressed={days === r.days}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${days === r.days ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="bg-background px-4 py-3.5"><Skeleton className="h-12 w-full" /></div>)}
        </div>
      ) : (
        <StatRow>
          <Stat label="Responses" value={derived.totalResponses} emphasis hint={`${derived.live} live survey${derived.live === 1 ? '' : 's'}`} />
          <Stat
            label="Completion rate"
            value={derived.completionRate !== null ? `${derived.completionRate}%` : '—'}
            hint={derived.completionRate !== null ? `${derived.completed} of ${derived.audience} invited` : 'no invitation-based surveys yet'}
          />
          <Stat
            label="Net Promoter Score"
            value={derived.overallNps !== null ? (derived.overallNps > 0 ? `+${derived.overallNps}` : String(derived.overallNps)) : '—'}
            hint={derived.overallNps !== null ? `${derived.npsTotal} answers across ${nps?.length ?? 0} question${nps?.length === 1 ? '' : 's'}` : 'needs a survey with 5+ NPS answers'}
          />
          <Stat label={`Last ${days === 365 ? 'year' : `${days} days`}`} value={trend === null ? '…' : inRange} hint="responses in range" />
        </StatRow>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-foreground">Responses over time</h2>
        {trend === null ? <Skeleton className="h-24 w-full" /> : (
          <TrendChart points={trend.map(t => ({ bucketStart: t.day, n: t.n }))} />
        )}
      </section>

      {!loading && (summaries ?? []).length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing to analyse yet"
            body="Publish a survey and share its link. Analytics appear here as soon as responses arrive."
            action={<Link to="/admin/surveys/new"><Button size="sm">Create a survey</Button></Link>}
          />
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 text-sm font-medium text-foreground">Responses by customer</h2>
              {loading ? <Skeleton className="h-28 w-full" /> : <BarChart data={derived.customers} />}
            </section>
            <section>
              <h2 className="mb-3 text-sm font-medium text-foreground">Responses by survey</h2>
              {loading ? <Skeleton className="h-28 w-full" /> : <BarChart data={derived.surveys} maxBars={8} />}
            </section>
          </div>

          <section className="mt-8">
            <h2 className="mb-1 text-sm font-medium text-foreground">Completion of invited surveys</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Only surveys sent to a known audience have a completion rate. Anonymous open-link surveys have no audience to measure against.
            </p>
            {loading ? <SkeletonRows rows={2} /> : derived.tracked.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No survey has invited an audience yet.
              </p>
            ) : (
              <DataTable head={['Survey', 'Customer', 'Invited', 'Completed', 'Rate', '']}>
                {derived.tracked.map(s => {
                  const rate = s.audience > 0 ? Math.round((s.completed / s.audience) * 1000) / 10 : 0;
                  return (
                    <tr key={s.slug} className="transition-colors hover:bg-muted/40">
                      <Td className="font-medium text-foreground">{s.title}</Td>
                      <Td className="text-muted-foreground">{s.organization_name ?? 'Unfiled'}</Td>
                      <Td className="tabular-nums">{s.audience.toLocaleString()}</Td>
                      <Td className="tabular-nums">{s.completed.toLocaleString()}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <div className="h-full rounded-full bg-primary" style={{ width: `${rate}%` }} />
                          </div>
                          <span className="tabular-nums text-foreground">{rate}%</span>
                        </div>
                      </Td>
                      <Td><div className="flex justify-end"><Link to={`/admin/surveys/${s.slug}/analytics`}><Button variant="ghost" size="sm">Analytics</Button></Link></div></Td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-1 text-sm font-medium text-foreground">Net Promoter Score by survey</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Promoters (9-10) minus detractors (0-6), as a share of everyone who answered. A score is shown only once at least 5 people have answered.
            </p>
            {loading ? <SkeletonRows rows={2} /> : (nps ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No survey has an NPS question with 5 or more answers yet.
              </p>
            ) : (
              <DataTable head={['Survey', 'Question', 'Answers', 'Promoters', 'Passives', 'Detractors', 'NPS']}>
                {(nps ?? []).map((r, i) => (
                  <tr key={`${r.slug}-${i}`} className="transition-colors hover:bg-muted/40">
                    <Td>
                      <span className="font-medium text-foreground">{r.title}</span>
                      <span className="block text-[11px] text-muted-foreground">{r.organization_name ?? 'Unfiled'}</span>
                    </Td>
                    <Td className="max-w-[16rem] truncate text-muted-foreground">{r.question_label}</Td>
                    <Td className="tabular-nums">{r.answers}</Td>
                    <Td className="tabular-nums">{r.promoters}</Td>
                    <Td className="tabular-nums">{r.passives}</Td>
                    <Td className="tabular-nums">{r.detractors}</Td>
                    <Td className="font-medium tabular-nums text-foreground">{r.nps > 0 ? `+${r.nps}` : r.nps}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </section>
        </>
      )}
    </>
  );
}
