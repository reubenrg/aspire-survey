import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fileNameOf, signedUploadUrl } from '../../engine/uploads';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import { getSurvey, listOrganizations, listVersions, type Organization, type SurveyRow, type SurveyVersion } from '../adminStore';
import {
  downloadFile, exportResponsesCsv, fetchOverview, fetchResponseOne, fetchResponsePage,
  NotAuthorised, type AnalyticsOverview, type ResponseFilters,
} from '../analyticsStore';
import { questionColumns, type ColumnMeta } from '../questionMeta';
import { PRIVACY_MODE_REMINDER, usesInvitationLinks } from '../labels';
import {
  AccessDenied, DataTable, EmptyState, ErrorNote, PageHeader, PrivacyModePill,
  SearchInput, SkeletonRows, Stat, StatRow, Td, relativeTime,
} from '../ui';

const PAGE_SIZE = 25;

export default function ResponseCentre() {
  const { slug = '' } = useParams();
  const session = useAdminSession();

  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [versions, setVersions] = useState<SurveyVersion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [version, setVersion] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Set<string> | null>(null); // null = all
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [total, setTotal] = useState(0);
  const [identityIncluded, setIdentityIncluded] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: Record<string, unknown>; identityIncluded: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);

  const columns: ColumnMeta[] = useMemo(() => (survey ? questionColumns(survey.definition) : []), [survey]);

  const filters: ResponseFilters = useMemo(() => ({
    search: search.trim() || undefined,
    version: version ? Number(version) : undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
  }), [search, version, dateFrom, dateTo]);

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
      const [ov, vs] = await Promise.all([
        fetchOverview(slug).catch(e => { if (e instanceof NotAuthorised) { setDenied(true); return null; } throw e; }),
        listVersions(found.id).catch(() => []),
      ]);
      setOverview(ov);
      setVersions(vs);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  const loadRows = useCallback(async () => {
    if (denied) return;
    try {
      const page_ = await fetchResponsePage(slug, PAGE_SIZE, page * PAGE_SIZE, filters);
      setRows(page_.rows);
      setTotal(page_.total);
      setIdentityIncluded(page_.identityIncluded);
      setRowsError(null);
    } catch (e) {
      if (e instanceof NotAuthorised) { setDenied(true); return; }
      setRowsError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, page, filters, denied]);

  useEffect(() => { void loadRows(); }, [loadRows]);
  useEffect(() => { setPage(0); }, [search, version, dateFrom, dateTo]);

  const shownColumns = visibleColumns ? columns.filter(c => visibleColumns.has(c.column)) : columns;

  const doExport = async () => {
    if (!survey) return;
    setExporting(true);
    try {
      const result = await exportResponsesCsv(slug, survey.organization_id, filters);
      downloadFile(`${slug}-responses-${result.identityIncluded ? 'identified' : 'deidentified'}.csv`, result.csv);
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

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
        title={`${survey.title} — Responses`}
        subtitle={org ? org.name : undefined}
        actions={<Link to={`/admin/surveys/${slug}`} className="text-xs text-muted-foreground hover:text-foreground self-center">← Survey overview</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PrivacyModePill mode={survey.privacy_mode} />
        <span className="text-sm text-muted-foreground">{PRIVACY_MODE_REMINDER[survey.privacy_mode]}</span>
      </div>

      {denied ? (
        <AccessDenied what="view responses for this survey" need="analyst" />
      ) : (
        <>
          <StatRow>
            <Stat label="Status" value={survey.published ? (survey.closed_at ? 'Closed' : 'Live') : 'Draft'} />
            <Stat label="Version" value={`v${survey.current_version}`} />
            <Stat label="Response count" value={overview?.responses ?? '—'} emphasis />
            <Stat label="First / latest" value={overview ? `${relativeTime(overview.first_response)} → ${relativeTime(overview.latest_response)}` : '—'} />
          </StatRow>

          {rowsError && <div className="mt-4"><ErrorNote>{rowsError}</ErrorNote></div>}

          <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search responses…" className="w-56" />
            {versions.length > 1 && (
              <select value={version} onChange={e => setVersion(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60">
                <option value="">All versions</option>
                {versions.map(v => <option key={v.version_number} value={v.version_number}>v{v.version_number}</option>)}
              </select>
            )}
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60" aria-label="From date" />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60" aria-label="To date" />
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setColumnPickerOpen(o => !o)}>Columns ({shownColumns.length}/{columns.length})</Button>
              {columnPickerOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-background p-2 shadow-lg">
                  {columns.map(c => (
                    <label key={c.column} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={visibleColumns ? visibleColumns.has(c.column) : true}
                        onChange={e => setVisibleColumns(prev => {
                          const next = new Set(prev ?? columns.map(cc => cc.column));
                          if (e.target.checked) next.add(c.column); else next.delete(c.column);
                          return next;
                        })}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <span className="truncate">{c.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>
          </div>

          {rows === null ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
            <EmptyState
              title={total === 0 && !search && !version && !dateFrom && !dateTo ? 'No responses yet' : 'No responses match these filters'}
              body={total === 0 && !search && !version && !dateFrom && !dateTo
                ? 'Responses appear here as soon as someone submits.'
                : 'Try a different search term, or widen the date range and version filters.'}
            />
          ) : (
            <>
              <DataTable head={['Submitted', ...shownColumns.map(c => c.label), '']}>
                {rows.map((r, i) => (
                  <tr key={i} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => { if (r.id) void fetchResponseOne(slug, String(r.id)).then(setDetail); }}>
                    <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(r.submitted_at as string)}</Td>
                    {shownColumns.map(c => <Td key={c.column} className="max-w-[16rem] truncate">{cellFor(c, r[c.column])}</Td>)}
                    <Td><Button variant="ghost" size="sm">Open</Button></Td>
                  </tr>
                ))}
              </DataTable>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{total.toLocaleString()} response{total === 1 ? '' : 's'} · {identityIncluded ? 'identified view' : 'de-identified view'}</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Previous</Button>
                  <span>Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
                  <Button variant="ghost" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next →</Button>
                </div>
              </div>
            </>
          )}

          {usesInvitationLinks(survey.privacy_mode) && (
            <p className="mt-6 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {survey.privacy_mode === 'ANONYMOUS_TRACKED'
                ? 'This view never includes employee identity or department/location/designation on individual rows, even for owners - that guarantee is enforced in the database, not just hidden here. Use the Audience page to see who has participated.'
                : identityIncluded
                  ? 'You have permission to view identified responses on this Confidential survey.'
                  : 'You do not have permission to view identified responses on this Confidential survey. Rows are shown de-identified.'}
            </p>
          )}
        </>
      )}

      {detail && (
        <ResponseDetailDialog columns={columns} detail={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

/** File and signature answers are storage paths: show a link that fetches a short-lived signed URL, never the raw path. */
function cellFor(c: ColumnMeta, value: unknown, detail = false): ReactNode {
  if ((c.type === 'file' || c.type === 'signature') && typeof value === 'string' && value !== '') {
    return <UploadedFile path={value} inline={detail && c.type === 'signature'} />;
  }
  return formatCell(value);
}

function UploadedFile({ path, inline }: { path: string; inline?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!inline) return;
    let cancelled = false;
    void signedUploadUrl(path).then(u => { if (!cancelled) { setUrl(u); setFailed(!u); } });
    return () => { cancelled = true; };
  }, [path, inline]);

  if (inline) {
    if (failed) return <span className="text-destructive">Could not load the signature.</span>;
    return url ? <img src={url} alt="Signature" className="h-20 rounded border border-border bg-white" /> : <span>Loading…</span>;
  }
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        void signedUploadUrl(path).then(u => { if (u) window.open(u, '_blank', 'noopener'); else setFailed(true); });
      }}
      className="text-primary hover:underline"
    >
      {failed ? 'Unavailable' : `Open ${fileNameOf(path)}`}
    </button>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  return String(value);
}

function ResponseDetailDialog({
  columns, detail, onClose,
}: { columns: ColumnMeta[]; detail: { row: Record<string, unknown>; identityIncluded: boolean }; onClose: () => void }) {
  const { row } = detail;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/30 px-6 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg text-foreground">Response</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <dl className="mb-4 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between"><dt>Submitted</dt><dd className="text-foreground">{row.submitted_at ? new Date(row.submitted_at as string).toLocaleString() : '—'}</dd></div>
          <div className="flex justify-between"><dt>Version</dt><dd className="text-foreground">v{String(row.definition_version ?? '—')}</dd></div>
          {detail.identityIncluded && row.employee_name ? (
            <div className="flex justify-between"><dt>Respondent</dt><dd className="text-foreground">{String(row.employee_name)} ({String(row.employee_code ?? '')})</dd></div>
          ) : null}
        </dl>
        <div className="max-h-96 space-y-3 overflow-y-auto border-t border-border pt-3">
          {columns.map(c => (
            <div key={c.column}>
              <p className="text-xs font-medium text-foreground">{c.label}</p>
              <div className="text-sm text-muted-foreground">{cellFor(c, row[c.column], true)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
