import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { getSurvey, listOrganizations, listVersions, type Organization, type SurveyRow, type SurveyVersion } from '../adminStore';
import { useAdminSession } from '../AdminGate';
import {
  fetchColumnsDistribution, fetchCrosstab, fetchMultiselectDistribution, fetchNumericSummary, fetchOverview,
  fetchRankingSummary, fetchSegmentSummary, fetchTextCount, fetchTrend, NotAuthorised,
  type AnalyticsOverview, type ChoiceDistribution, type Crosstab, type MultiselectDistribution, type NumericSummary,
  type RankingSummaryRow, type SegmentDimension, type SegmentSummary, type TrendPoint,
} from '../analyticsStore';
import { fillScale, meanFromDistribution, npsFromDistribution } from '../npsMath';
import { groupMatrixRows, questionColumns, type ColumnMeta } from '../questionMeta';
import { averagePosition } from '../matrixMath';
import { PRIVACY_MODE_REMINDER, usesInvitationLinks } from '../labels';
import { BarChart, ScaleDistributionRow, TrendChart } from '../charts';
import {
  AccessDenied, ErrorNote, PageHeader, PrivacyModePill, Skeleton, Stat, StatRow, SkeletonRows,
} from '../ui';

export default function SurveyAnalytics() {
  const { slug = '' } = useParams();
  const session = useAdminSession();

  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [versions, setVersions] = useState<SurveyVersion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [version, setVersion] = useState<string>('');

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [choiceDist, setChoiceDist] = useState<ChoiceDistribution[]>([]);
  const [multiselect, setMultiselect] = useState<Record<string, MultiselectDistribution[]>>({});
  const [textCounts, setTextCounts] = useState<Record<string, number>>({});
  const [numeric, setNumeric] = useState<Record<string, NumericSummary>>({});
  const [ranking, setRanking] = useState<Record<string, RankingSummaryRow[]>>({});
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const columns: ColumnMeta[] = useMemo(() => (survey ? questionColumns(survey.definition) : []), [survey]);
  const versionNum = version ? Number(version) : undefined;

  const loadMeta = useCallback(async () => {
    try {
      const found = await getSurvey(slug);
      if (!found) { setLoadError(`No survey called "${slug}".`); return; }
      setSurvey(found);
      if (found.organization_id) {
        await session.refreshRole(found.organization_id);
        const orgs = await listOrganizations();
        setOrg(orgs.find(o => o.id === found.organization_id) ?? null);
      }
      setVersions(await listVersions(found.id).catch(() => []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  const loadAnalysis = useCallback(async () => {
    if (!survey) return;
    try {
      const [ov, tr] = await Promise.all([
        fetchOverview(slug, versionNum),
        fetchTrend(slug, versionNum),
      ]);
      setOverview(ov);
      setTrend(tr);

      const distCols = columns.filter(c => ['choice', 'matrix-row', 'rating', 'nps'].includes(c.kind)).map(c => c.column);
      const numericCols = columns.filter(c => ['numeric', 'rating', 'nps'].includes(c.kind)).map(c => c.column);
      const [dist, nums] = await Promise.all([
        fetchColumnsDistribution(slug, distCols, versionNum),
        fetchNumericSummary(slug, numericCols, versionNum),
      ]);
      setChoiceDist(dist);
      setNumeric(Object.fromEntries(nums.map(n => [n.column, n])));

      const rankCols = columns.filter(c => c.kind === 'ranking');
      const rankResults = await Promise.all(rankCols.map(c => fetchRankingSummary(slug, c.column, versionNum)));
      setRanking(Object.fromEntries(rankCols.map((c, i) => [c.column, rankResults[i]])));

      const multiCols = columns.filter(c => c.kind === 'multiselect');
      const multiResults = await Promise.all(multiCols.map(c => fetchMultiselectDistribution(slug, c.column, versionNum)));
      setMultiselect(Object.fromEntries(multiCols.map((c, i) => [c.column, multiResults[i]])));

      const textCols = columns.filter(c => c.kind === 'text');
      const textResults = await Promise.all(textCols.map(c => fetchTextCount(slug, c.column, versionNum)));
      setTextCounts(Object.fromEntries(textCols.map((c, i) => [c.column, textResults[i]])));

      setAnalysisError(null);
    } catch (e) {
      if (e instanceof NotAuthorised) { setDenied(true); return; }
      setAnalysisError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey, slug, columns, versionNum]);

  useEffect(() => { void loadAnalysis(); }, [loadAnalysis]);

  const matrixGroups = useMemo(() => groupMatrixRows(columns), [columns]);

  if (loadError && !survey) {
    return (
      <>
        <ErrorNote>{loadError}</ErrorNote>
        <Link to="/admin/surveys" className="text-sm text-primary hover:underline">Back to surveys</Link>
      </>
    );
  }
  if (!survey) return <SkeletonRows rows={4} />;

  return (
    <>
      <PageHeader
        title={`${survey.title} — Analytics`}
        subtitle={org ? org.name : undefined}
        actions={
          <>
            {versions.length > 1 && (
              <select value={version} onChange={e => setVersion(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60">
                <option value="">All compatible versions</option>
                {versions.map(v => <option key={v.version_number} value={v.version_number}>v{v.version_number} only</option>)}
              </select>
            )}
            <Link to={`/admin/surveys/${slug}/responses`} className="self-center text-xs text-muted-foreground hover:text-foreground">Raw responses →</Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PrivacyModePill mode={survey.privacy_mode} />
        <span className="text-sm text-muted-foreground">{PRIVACY_MODE_REMINDER[survey.privacy_mode]}</span>
      </div>

      {denied ? (
        <AccessDenied what="view analytics for this survey" need="analyst" />
      ) : (
        <>
          {analysisError && <ErrorNote>{analysisError}</ErrorNote>}

          {overview === null ? (
            <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => <div key={i} className="bg-background px-4 py-3.5"><Skeleton className="h-12 w-full" /></div>)}
            </div>
          ) : (
            <StatRow>
              <Stat label="Total responses" value={overview.responses} emphasis />
              <Stat label="Completion rate" value={overview.completion_rate !== null ? `${overview.completion_rate}%` : '—'}
                    hint={overview.completion_rate === null ? 'not meaningful for anonymous surveys' : `${overview.completed ?? 0} of ${overview.audience ?? 0} invited`} />
              <Stat label="First response" value={overview.first_response ? new Date(overview.first_response).toLocaleDateString() : '—'} />
              <Stat label="Latest response" value={overview.latest_response ? new Date(overview.latest_response).toLocaleDateString() : '—'} />
            </StatRow>
          )}

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-medium text-foreground">Response trend</h2>
            {trend === null ? <Skeleton className="h-24 w-full" /> : <TrendChart points={trend} />}
          </section>

          {overview && overview.responses === 0 ? (
            <div className="mt-8">
              <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No responses yet — question analysis will appear once people start answering.
              </p>
            </div>
          ) : (
            <section className="mt-8 space-y-6">
              <h2 className="text-sm font-medium text-foreground">Question analysis</h2>
              {columns.filter(c => c.kind !== 'matrix-row').map(c => (
                <QuestionAnalysisCard key={c.column} col={c} choiceDist={choiceDist} multiselect={multiselect} textCounts={textCounts} numeric={numeric} ranking={ranking} />
              ))}
              {[...matrixGroups.entries()].map(([qId, rows]) => (
                <MatrixAnalysisCard key={qId} rows={rows} dist={choiceDist} />
              ))}
            </section>
          )}

          {overview && overview.responses > 0 && (
            <section className="mt-10">
              <CrosstabPanel slug={slug} columns={columns} version={versionNum} />
            </section>
          )}

          {usesInvitationLinks(survey.privacy_mode) && (
            <section className="mt-10">
              <SegmentationPanel slug={slug} privacyMode={survey.privacy_mode} version={versionNum} />
            </section>
          )}
        </>
      )}
    </>
  );
}

function QuestionAnalysisCard({
  col, choiceDist, multiselect, textCounts, numeric, ranking,
}: {
  col: ColumnMeta; choiceDist: ChoiceDistribution[]; multiselect: Record<string, MultiselectDistribution[]>;
  textCounts: Record<string, number>; numeric: Record<string, NumericSummary>; ranking: Record<string, RankingSummaryRow[]>;
}) {
  const dist = choiceDist.filter(d => d.column === col.column).map(d => ({ value: d.value, n: d.n }));
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="mb-1 text-xs text-muted-foreground">{col.sectionTitle}</p>
      <p className="mb-3 text-sm font-medium text-foreground">{col.label}</p>

      {col.kind === 'choice' && (
        <BarChart data={choiceDist.filter(d => d.column === col.column).map(d => ({ label: d.value, n: d.n, pct: d.pct }))} />
      )}

      {col.kind === 'rating' && <RatingBlock max={col.max ?? 5} dist={dist} />}
      {col.kind === 'nps' && <NpsBlock dist={dist} />}
      {col.kind === 'numeric' && <NumericBlock summary={numeric[col.column]} />}
      {col.kind === 'ranking' && <RankingBlock rows={ranking[col.column] ?? []} />}
      {col.kind === 'identifier' && (
        <p className="text-sm text-muted-foreground">
          This question collects an identifying answer, so it is never summarised or charted here.
        </p>
      )}

      {col.kind === 'multiselect' && (
        <>
          <BarChart data={(multiselect[col.column] ?? []).map(d => ({ label: d.value, n: d.n, pct: d.pctOfRespondents }))} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Percentage is of respondents who answered this question, not of total selections — someone may pick more than one.
          </p>
        </>
      )}

      {col.kind === 'text' && (
        <p className="text-sm text-foreground">
          {textCounts[col.column] ?? 0} text response{(textCounts[col.column] ?? 0) === 1 ? '' : 's'} collected.
          <span className="ml-1.5 text-xs text-muted-foreground">Individual answers are available to analysts in Raw Responses, not summarised here.</span>
        </p>
      )}
    </div>
  );
}

function RatingBlock({ max, dist }: { max: number; dist: { value: string; n: number }[] }) {
  const filled = fillScale(dist, 1, max);
  const total = filled.reduce((a, d) => a + d.n, 0);
  const mean = meanFromDistribution(dist);
  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-display text-3xl tabular-nums text-foreground">{mean !== null ? mean.toFixed(2) : '—'}</span>
        <span className="text-xs text-muted-foreground">average out of {max} · {total} rating{total === 1 ? '' : 's'}</span>
      </div>
      <BarChart data={filled.map(d => ({ label: `${d.value} of ${max}`, n: d.n, pct: total ? Math.round((d.n / total) * 1000) / 10 : 0 }))} maxBars={max} />
    </>
  );
}

function NpsBlock({ dist }: { dist: { value: string; n: number }[] }) {
  const r = npsFromDistribution(dist);
  const pct = (n: number) => (r.total ? Math.round((n / r.total) * 1000) / 10 : 0);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-3xl tabular-nums text-foreground">{r.score !== null ? (r.score > 0 ? `+${r.score}` : r.score) : '—'}</span>
        <span className="text-xs text-muted-foreground">Net Promoter Score · {r.total} answer{r.total === 1 ? '' : 's'}</span>
      </div>
      <BarChart data={[
        { label: 'Promoters (9-10)', n: r.promoters, pct: pct(r.promoters) },
        { label: 'Passives (7-8)', n: r.passives, pct: pct(r.passives) },
        { label: 'Detractors (0-6)', n: r.detractors, pct: pct(r.detractors) },
      ]} />
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Score by score</summary>
        <div className="mt-2"><BarChart data={fillScale(dist, 0, 10).map(d => ({ label: d.value, n: d.n }))} maxBars={11} /></div>
      </details>
    </>
  );
}

function NumericBlock({ summary }: { summary?: NumericSummary }) {
  if (!summary) return <p className="text-sm text-muted-foreground">No numeric answers yet.</p>;
  const cells: [string, number][] = [
    ['Average', summary.mean], ['Median', summary.median], ['Lowest', summary.min], ['Highest', summary.max], ['Std. deviation', summary.stddev],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
        {cells.map(([label, v]) => (
          <div key={label} className="bg-background px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg tabular-nums text-foreground">{Number.isInteger(v) ? v : v.toFixed(2)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Based on {summary.n} answer{summary.n === 1 ? '' : 's'}.</p>
    </>
  );
}

function RankingBlock({ rows }: { rows: RankingSummaryRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No rankings yet.</p>;
  const worst = Math.max(...rows.map(r => r.avgPosition));
  return (
    <>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.value} title={`${r.value}: average position ${r.avgPosition}, first choice for ${r.firstChoice}`}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-foreground"><span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>{r.value}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">avg position {r.avgPosition.toFixed(2)} · first choice {r.firstChoice}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (1 - (r.avgPosition - 1) / Math.max(1, worst)) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Ordered from most to least preferred. A lower average position means a higher rank.</p>
    </>
  );
}

const CROSSTAB_KINDS = ['choice', 'rating', 'nps'];

function CrosstabPanel({ slug, columns, version }: { slug: string; columns: ColumnMeta[]; version?: number }) {
  const options = columns.filter(c => CROSSTAB_KINDS.includes(c.kind));
  const [rowCol, setRowCol] = useState('');
  const [colCol, setColCol] = useState('');
  const [table, setTable] = useState<Crosstab | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rowCol || !colCol || rowCol === colCol) { setTable(null); setError(null); return; }
    let cancelled = false;
    setTable(null); setError(null);
    fetchCrosstab(slug, rowCol, colCol, version)
      .then(t => { if (!cancelled) setTable(t); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [slug, rowCol, colCol, version]);

  if (options.length < 2) return null;

  const rowLabels = table ? [...new Set(table.cells.map(c => c.row))] : [];
  const colLabels = table ? [...new Set(table.cells.map(c => c.col))] : [];
  const cell = (r: string, c: string) => table?.cells.find(x => x.row === r && x.col === c)?.n;
  const max = table ? Math.max(1, ...table.cells.map(c => c.n)) : 1;
  const label = (col: string) => options.find(o => o.column === col)?.label ?? col;

  return (
    <div>
      <h2 className="mb-1 text-sm font-medium text-foreground">Compare two questions</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        A cross-tab shows how answers to one question split by another. Combinations with fewer than 5 responses are hidden to protect confidentiality.
      </p>
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <select value={rowCol} onChange={e => setRowCol(e.target.value)} aria-label="Rows" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60">
          <option value="">Rows: choose a question</option>
          {options.map(o => <option key={o.column} value={o.column}>{o.label}</option>)}
        </select>
        <select value={colCol} onChange={e => setColCol(e.target.value)} aria-label="Columns" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60">
          <option value="">Columns: choose a question</option>
          {options.filter(o => o.column !== rowCol).map(o => <option key={o.column} value={o.column}>{o.label}</option>)}
        </select>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {rowCol && colCol && !table && !error && <Skeleton className="h-24 w-full" />}

      {table && (table.cells.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {table.suppressedCells > 0
            ? `Every combination has fewer than ${table.threshold} responses, so none can be shown yet.`
            : 'No one has answered both questions yet.'}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{label(rowCol)} by {label(colCol)}</caption>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className="px-3 py-2 font-medium text-muted-foreground">{label(rowCol)} ↓ / {label(colCol)} →</th>
                  {colLabels.map(c => <th key={c} scope="col" className="px-3 py-2 font-medium text-foreground">{c}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rowLabels.map(r => (
                  <tr key={r}>
                    <th scope="row" className="px-3 py-2 font-medium text-foreground">{r}</th>
                    {colLabels.map(c => {
                      const n = cell(r, c);
                      return (
                        <td key={c} className="px-3 py-2 tabular-nums" style={n ? { background: `color-mix(in srgb, var(--primary, #2961B6) ${Math.round(8 + (n / max) * 32)}%, transparent)` } : undefined}>
                          {n ?? <span className="text-muted-foreground" title={`Fewer than ${table.threshold} responses`}>—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.suppressedCells > 0 && (
            <p className="mt-2 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
              {table.suppressedCells} combination{table.suppressedCells === 1 ? '' : 's'} with fewer than {table.threshold} responses {table.suppressedCells === 1 ? 'is' : 'are'} not shown (—).
              {table.suppressedResponses != null && ` Together they account for ${table.suppressedResponses} responses.`}
            </p>
          )}
        </>
      ))}
    </div>
  );
}

function MatrixAnalysisCard({ rows, dist }: { rows: ColumnMeta[]; dist: ChoiceDistribution[] }) {
  const scale = rows[0]?.scale ?? [];
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="mb-1 text-xs text-muted-foreground">{rows[0]?.sectionTitle}</p>
      <p className="mb-3 text-sm font-medium text-foreground">Matrix: {rows.length} statement{rows.length === 1 ? '' : 's'}</p>
      <div className="divide-y divide-border/60">
        {rows.map(r => {
          const rowDist = dist.filter(d => d.column === r.column);
          const counts = Object.fromEntries(rowDist.map(d => [d.value, d.n]));
          const total = rowDist.reduce((sum, d) => sum + d.n, 0);
          const avg = averagePosition(counts, scale);
          return (
            <div key={r.column}>
              <ScaleDistributionRow label={r.label} scale={scale} counts={counts} total={total} />
              {avg !== null && <p className="mb-1.5 text-[11px] text-muted-foreground">Average position on the scale: {avg.toFixed(1)} of {scale.length}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {scale.map((s, i) => <span key={s}>{i + 1}={s}</span>)}
      </div>
    </div>
  );
}

function SegmentationPanel({ slug, privacyMode, version }: { slug: string; privacyMode: string; version?: number }) {
  const [dimension, setDimension] = useState<SegmentDimension>('department');
  const [summary, setSummary] = useState<SegmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSegmentSummary(slug, { groupBy: dimension, version })
      .then(s => { if (!cancelled) setSummary(s); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [slug, dimension, version]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Segmentation</h2>
        <div className="flex gap-1">
          {(['department', 'location', 'designation'] as SegmentDimension[]).map(d => (
            <button
              key={d} type="button" onClick={() => setDimension(d)}
              className={`rounded px-2 py-1 text-xs capitalize transition-colors ${dimension === d ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {summary === null ? <Skeleton className="h-20 w-full" /> : !summary.applicable ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {privacyMode === 'ANONYMOUS' ? 'Anonymous surveys have no employee data to segment by.' : 'Segmentation data is not available for this survey.'}
        </p>
      ) : (
        <>
          <BarChart data={(summary.groups ?? []).map(g => ({ label: g.value, n: g.n }))} />
          {(summary.suppressedGroups ?? 0) > 0 && (
            <p className="mt-3 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
              Not enough responses to display {summary.suppressedGroups} group{summary.suppressedGroups === 1 ? '' : 's'} while protecting confidentiality.
              {/* The combined response count across hidden groups is only ever shown when 2+ groups are suppressed together - with exactly
                  one hidden group, that total would just be that one group's exact size, which is precisely what suppression exists to hide.
                  See survey_segment_summary()'s own comment for the server-side half of this guarantee. */}
              {summary.suppressedResponses != null && ` (${summary.suppressedResponses} responses total across those groups)`}
              {' '}Groups below {summary.threshold} responses are never shown individually.
            </p>
          )}
          {(summary.groups ?? []).length === 0 && (summary.suppressedGroups ?? 0) === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No data for this dimension yet.</p>
          )}
        </>
      )}
    </div>
  );
}
