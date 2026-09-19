import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { fetchResponseOverview, type ResponseOverviewRow } from '../platformStore';
import {
  DataTable, EmptyState, ErrorNote, FilterSelect, PageHeader, PrivacyModePill, SearchInput,
  Skeleton, SkeletonRows, Stat, StatRow, StatusPill, Td, relativeTime,
} from '../ui';

/**
 * Every survey's response volume in one place. Counting happens in the
 * database (admin_response_overview), so no response row is downloaded just to
 * be counted; reading, filtering and exporting the responses themselves stays
 * in each survey's Response Centre, where the survey's privacy mode decides
 * what identity information is shown.
 */
export default function Responses() {
  const [rows, setRows] = useState<ResponseOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('');
  const [onlyWithResponses, setOnlyWithResponses] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchResponseOverview()
      .then(r => { if (!cancelled) setRows(r); })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setRows([]); } });
    return () => { cancelled = true; };
  }, []);

  const customers = useMemo(
    () => [...new Map((rows ?? []).filter(r => r.organization_id).map(r => [r.organization_id!, r.organization_name ?? 'Unnamed'])).entries()]
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? [])
      .filter(r => !customer || r.organization_id === customer)
      .filter(r => !status || r.status === status)
      .filter(r => !onlyWithResponses || r.responses > 0)
      .filter(r => !q || r.title.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q) || (r.organization_name ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.last_response_at ?? '').localeCompare(a.last_response_at ?? '') || a.title.localeCompare(b.title));
  }, [rows, query, customer, status, onlyWithResponses]);

  const totals = useMemo(() => {
    const all = rows ?? [];
    return {
      responses: all.reduce((a, r) => a + r.responses, 0),
      week: all.reduce((a, r) => a + r.responses_7d, 0),
      month: all.reduce((a, r) => a + r.responses_30d, 0),
      collecting: all.filter(r => r.responses > 0).length,
    };
  }, [rows]);

  const filtersActive = !!(query || customer || status || onlyWithResponses);

  return (
    <>
      <PageHeader
        title="Responses"
        subtitle="Response volume for every survey. Open a survey to read, filter and export its individual responses."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {rows === null ? (
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="bg-background px-4 py-3.5"><Skeleton className="h-12 w-full" /></div>)}
        </div>
      ) : (
        <StatRow>
          <Stat label="All responses" value={totals.responses} emphasis />
          <Stat label="Last 7 days" value={totals.week} />
          <Stat label="Last 30 days" value={totals.month} />
          <Stat label="Surveys with responses" value={totals.collecting} hint={`of ${rows.length} survey${rows.length === 1 ? '' : 's'}`} />
        </StatRow>
      )}

      <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search surveys or customers…" className="w-64" />
        <FilterSelect label="All customers" value={customer} onChange={setCustomer} options={customers} />
        <FilterSelect
          label="All statuses" value={status} onChange={setStatus}
          options={[{ value: 'LIVE', label: 'Live' }, { value: 'DRAFT', label: 'Draft' }, { value: 'CLOSED', label: 'Closed' }, { value: 'ARCHIVED', label: 'Archived' }]}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyWithResponses} onChange={e => setOnlyWithResponses(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Only surveys with responses
        </label>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setCustomer(''); setStatus(''); setOnlyWithResponses(false); }}>
            Clear filters
          </Button>
        )}
      </div>

      {rows === null ? <SkeletonRows rows={5} /> : rows.length === 0 ? (
        <EmptyState
          title="No surveys yet"
          body="Responses appear here once a survey is published and people start answering."
          action={<Link to="/admin/surveys/new"><Button size="sm">Create a survey</Button></Link>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No surveys match these filters" body="Try clearing a filter or searching for something else." />
      ) : (
        <DataTable head={['Survey', 'Customer', 'Status', 'Privacy', 'Responses', '7 days', '30 days', 'Latest', '']}>
          {filtered.map(r => (
            <tr key={r.slug} className="transition-colors hover:bg-muted/40">
              <Td>
                <span className="font-medium text-foreground">{r.title}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">/s/{r.slug}</span>
              </Td>
              <Td className="text-muted-foreground">{r.organization_name ?? 'Unfiled'}</Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td><PrivacyModePill mode={r.privacy_mode} /></Td>
              <Td className="tabular-nums text-foreground">{r.responses.toLocaleString()}</Td>
              <Td className="tabular-nums text-muted-foreground">{r.responses_7d.toLocaleString()}</Td>
              <Td className="tabular-nums text-muted-foreground">{r.responses_30d.toLocaleString()}</Td>
              <Td className="whitespace-nowrap text-muted-foreground">{r.last_response_at ? relativeTime(r.last_response_at) : '—'}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Link to={`/admin/surveys/${r.slug}/responses`}><Button variant="ghost" size="sm">Responses</Button></Link>
                  <Link to={`/admin/surveys/${r.slug}/analytics`}><Button variant="ghost" size="sm">Analytics</Button></Link>
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
