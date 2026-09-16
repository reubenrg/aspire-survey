import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { getSurvey, listOrganizations, listVersions, type Organization, type SurveyRow, type SurveyVersion } from '../adminStore';
import { useAdminSession } from '../AdminGate';
import {
  fetchColumnsDistribution, fetchMultiselectDistribution, fetchOverview, fetchSegmentSummary,
  fetchTextCount, fetchTrend, NotAuthorised,
  type AnalyticsOverview, type ChoiceDistribution, type MultiselectDistribution,
  type SegmentDimension, type SegmentSummary, type TrendPoint,
} from '../analyticsStore';
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

      const choiceCols = columns.filter(c => c.kind === 'choice' || c.kind === 'matrix-row').map(c => c.column);
      const [dist] = await Promise.all([fetchColumnsDistribution(slug, choiceCols, versionNum)]);
      setChoiceDist(dist);

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
                <QuestionAnalysisCard key={c.column} col={c} choiceDist={choiceDist} multiselect={multiselect} textCounts={textCounts} />
              ))}
              {[...matrixGroups.entries()].map(([qId, rows]) => (
                <MatrixAnalysisCard key={qId} rows={rows} dist={choiceDist} />
              ))}
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
  col, choiceDist, multiselect, textCounts,
}: { col: ColumnMeta; choiceDist: ChoiceDistribution[]; multiselect: Record<string, MultiselectDistribution[]>; textCounts: Record<string, number> }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="mb-1 text-xs text-muted-foreground">{col.sectionTitle}</p>
      <p className="mb-3 text-sm font-medium text-foreground">{col.label}</p>

      {col.kind === 'choice' && (
        <BarChart data={choiceDist.filter(d => d.column === col.column).map(d => ({ label: d.value, n: d.n, pct: d.pct }))} />
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
              Not enough responses to display {summary.suppressedGroups} group{summary.suppressedGroups === 1 ? '' : 's'}
              {' '}({summary.suppressedResponses} response{summary.suppressedResponses === 1 ? '' : 's'} total) while protecting confidentiality.
              Groups below {summary.threshold} responses are never shown individually.
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
