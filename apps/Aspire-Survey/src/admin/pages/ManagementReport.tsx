import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { getSurvey, listOrganizations, type Organization, type SurveyRow } from '../adminStore';
import { useAdminSession } from '../AdminGate';
import {
  fetchColumnsDistribution, fetchMultiselectDistribution, fetchOverview, fetchSegmentSummary,
  fetchTextCount, fetchTrend, NotAuthorised,
  type AnalyticsOverview, type ChoiceDistribution, type MultiselectDistribution, type SegmentSummary, type TrendPoint,
} from '../analyticsStore';
import { groupMatrixRows, questionColumns, type ColumnMeta } from '../questionMeta';
import { PRIVACY_MODE_LABEL } from '../labels';
import { BarChart, ScaleDistributionRow, TrendChart } from '../charts';
import { AccessDenied, ErrorNote } from '../ui';

/**
 * A clean, customer-facing document, not the operational Admin screen: no
 * edit controls, no export button, no raw-response link - just what
 * happened and what people said, ready to walk through in a review call or
 * print to PDF (Part 19). Sits outside AdminShell entirely, the same reason
 * the Builder does: the sidebar/header are exactly the kind of "internal
 * Admin controls" this page must not carry, on screen or on paper.
 */
export default function ManagementReport() {
  const { slug = '' } = useParams();
  const session = useAdminSession();

  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [choiceDist, setChoiceDist] = useState<ChoiceDistribution[]>([]);
  const [multiselect, setMultiselect] = useState<Record<string, MultiselectDistribution[]>>({});
  const [textCounts, setTextCounts] = useState<Record<string, number>>({});
  const [segment, setSegment] = useState<SegmentSummary | null>(null);

  const columns: ColumnMeta[] = useMemo(() => (survey ? questionColumns(survey.definition) : []), [survey]);
  const matrixGroups = useMemo(() => groupMatrixRows(columns), [columns]);

  const load = useCallback(async () => {
    try {
      const found = await getSurvey(slug);
      if (!found) { setLoadError(`No survey called "${slug}".`); return; }
      setSurvey(found);
      if (found.organization_id) {
        await session.refreshRole(found.organization_id);
        const orgs = await listOrganizations();
        setOrg(orgs.find(o => o.id === found.organization_id) ?? null);
      }

      const cols = questionColumns(found.definition);
      const [ov, tr, dist] = await Promise.all([
        fetchOverview(slug),
        fetchTrend(slug),
        fetchColumnsDistribution(slug, cols.filter(c => c.kind === 'choice' || c.kind === 'matrix-row').map(c => c.column)),
      ]);
      setOverview(ov); setTrend(tr); setChoiceDist(dist);

      const multiCols = cols.filter(c => c.kind === 'multiselect');
      const multiResults = await Promise.all(multiCols.map(c => fetchMultiselectDistribution(slug, c.column)));
      setMultiselect(Object.fromEntries(multiCols.map((c, i) => [c.column, multiResults[i]])));

      const textCols = cols.filter(c => c.kind === 'text');
      const textResults = await Promise.all(textCols.map(c => fetchTextCount(slug, c.column)));
      setTextCounts(Object.fromEntries(textCols.map((c, i) => [c.column, textResults[i]])));

      if (found.privacy_mode !== 'ANONYMOUS') {
        setSegment(await fetchSegmentSummary(slug, { groupBy: 'department' }).catch(() => null));
      }
    } catch (e) {
      if (e instanceof NotAuthorised) { setDenied(true); return; }
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  if (loadError && !survey) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorNote>{loadError}</ErrorNote>
        <Link to="/admin/surveys" className="text-sm text-primary hover:underline">Back to surveys</Link>
      </div>
    );
  }
  if (!survey) return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;

  if (denied) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <AccessDenied what="view this report" need="analyst" />
      </div>
    );
  }

  const period = overview?.first_response && overview?.latest_response
    ? `${new Date(overview.first_response).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(overview.latest_response).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : 'No responses yet';

  return (
    <div className="min-h-screen bg-muted/20 print:bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .report-page { box-shadow: none !important; margin: 0 !important; max-width: none !important; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-6 py-3">
        <Link to={`/admin/surveys/${slug}`} className="text-sm text-muted-foreground hover:text-foreground">← Back to survey</Link>
        <Button size="sm" onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>

      <div className="report-page mx-auto max-w-3xl bg-background px-10 py-10 shadow-sm print:px-0">
        <header className="mb-8 border-b border-border pb-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{org?.name ?? 'Unfiled'}</p>
          <h1 className="mt-1 font-display text-2xl text-foreground">{survey.title}</h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Response period: {period}</span>
            <span>Privacy mode: {PRIVACY_MODE_LABEL[survey.privacy_mode]}</span>
            <span>Version {survey.current_version}</span>
          </div>
        </header>

        <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ReportStat label="Responses" value={overview?.responses ?? 0} />
          <ReportStat label="Completion rate" value={overview?.completion_rate !== null && overview?.completion_rate !== undefined ? `${overview.completion_rate}%` : '—'} />
          <ReportStat label="Invited" value={overview?.audience ?? '—'} />
          <ReportStat label="Completed" value={overview?.completed ?? '—'} />
        </section>

        <section className="mb-10">
          <h2 className="mb-3 font-display text-base text-foreground">Response trend</h2>
          {trend ? <TrendChart points={trend} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </section>

        {segment?.applicable && (segment.groups?.length ?? 0) > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 font-display text-base text-foreground">Participation by department</h2>
            <BarChart data={(segment.groups ?? []).map(g => ({ label: g.value, n: g.n }))} />
            {(segment.suppressedGroups ?? 0) > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {segment.suppressedGroups} smaller group{segment.suppressedGroups === 1 ? '' : 's'} not shown individually, to protect confidentiality.
              </p>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-4 font-display text-base text-foreground">Question summaries</h2>
          <div className="space-y-6">
            {columns.filter(c => c.kind !== 'matrix-row').map(c => (
              <div key={c.column} className="break-inside-avoid">
                <p className="mb-2 text-sm font-medium text-foreground">{c.label}</p>
                {c.kind === 'choice' && (
                  <BarChart data={choiceDist.filter(d => d.column === c.column).map(d => ({ label: d.value, n: d.n, pct: d.pct }))} />
                )}
                {c.kind === 'multiselect' && (
                  <BarChart data={(multiselect[c.column] ?? []).map(d => ({ label: d.value, n: d.n, pct: d.pctOfRespondents }))} />
                )}
                {c.kind === 'text' && (
                  <p className="text-sm text-muted-foreground">{textCounts[c.column] ?? 0} text response{(textCounts[c.column] ?? 0) === 1 ? '' : 's'} collected.</p>
                )}
              </div>
            ))}
            {[...matrixGroups.entries()].map(([qId, rows]) => {
              const scale = rows[0]?.scale ?? [];
              return (
                <div key={qId} className="break-inside-avoid">
                  <p className="mb-2 text-sm font-medium text-foreground">{rows[0]?.sectionTitle}</p>
                  {rows.map(r => {
                    const rowDist = choiceDist.filter(d => d.column === r.column);
                    const counts = Object.fromEntries(rowDist.map(d => [d.value, d.n]));
                    const total = rowDist.reduce((sum, d) => sum + d.n, 0);
                    return <ScaleDistributionRow key={r.column} label={r.label} scale={scale} counts={counts} total={total} />;
                  })}
                </div>
              );
            })}
          </div>
        </section>

        <footer className="mt-12 border-t border-border pt-4 text-[11px] text-muted-foreground">
          Generated {new Date().toLocaleString()} · Aspire Survey
        </footer>
      </div>
    </div>
  );
}

function ReportStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-display text-xl tabular-nums text-foreground">{value}</p>
    </div>
  );
}
