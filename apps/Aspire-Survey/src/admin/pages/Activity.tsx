import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { fetchAuditPage, type AuditEntry } from '../reportStore';
import { listOrganizations, type Organization } from '../adminStore';
import { totalPages, hasNextPage, hasPreviousPage } from '../pagination';
import { AccessDenied, DataTable, EmptyState, ErrorNote, PageHeader, SkeletonRows, Td, relativeTime } from '../ui';

const PAGE_SIZE = 25;

const ACTION_LABELS: Record<string, string> = {
  SURVEY_CLOSED: 'Survey closed', SURVEY_REOPENED: 'Survey reopened', DATA_EXPORTED: 'Data exported',
  MEMBER_ADDED: 'Member added', ROLE_CHANGED: 'Role changed', IDENTITY_PERMISSION_CHANGED: 'Identity permission changed',
  MEMBER_DEACTIVATED: 'Member deactivated', MEMBER_REACTIVATED: 'Member reactivated',
  LIBRARY_QUESTION_CREATED: 'Library question created', LIBRARY_QUESTION_EDITED: 'Library question edited',
  LIBRARY_QUESTION_DEACTIVATED: 'Library question status changed', LIBRARY_QUESTION_ADDED_TO_SURVEY: 'Library question added to survey',
  TEMPLATE_CREATED: 'Template created', TEMPLATE_EDITED: 'Template edited', TEMPLATE_DEACTIVATED: 'Template status changed',
  SETTINGS_CHANGED: 'Settings changed', CUSTOMER_BRANDING_CHANGED: 'Customer branding changed',
};

function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type.toLowerCase().replace(/_/g, ' ');
}

/**
 * Reads only audit_logs, which never stores response content, tokens, token
 * hashes, passwords or API keys (Part 17) - every recordAudit() call across
 * this project passes structured metadata (ids, counts, role values), never
 * raw content, so there is nothing to redact here. Visibility is exactly
 * audit_logs' existing owner-only RLS: a workspace owner sees their own
 * workspace's activity, a global owner sees everything.
 */
export default function Activity() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [org, setOrg] = useState('');
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => { void listOrganizations().then(setOrgs).catch(() => {}); }, []);

  const filters = useMemo(() => ({
    organizationId: org || undefined,
    userEmail: user.trim() || undefined,
    actionType: action || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
  }), [org, user, action, dateFrom, dateTo]);

  const load = useCallback(async () => {
    try {
      const { rows: r, total: t } = await fetchAuditPage(filters, PAGE_SIZE, page * PAGE_SIZE);
      setRows(r); setTotal(t); setError(null); setDenied(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/only an owner/i.test(msg)) { setDenied(true); return; }
      setError(msg);
      setRows([]);
    }
  }, [filters, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [org, user, action, dateFrom, dateTo]);

  const knownActions = Object.keys(ACTION_LABELS);

  if (denied) {
    return (
      <>
        <PageHeader title="Activity" subtitle="Audit trail of administrative actions." />
        <AccessDenied what="view the activity log" need="owner" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Activity" subtitle={`${total.toLocaleString()} event${total === 1 ? '' : 's'} matching these filters`} />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={org} onChange={e => setOrg(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60">
          <option value="">All workspaces</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={action} onChange={e => setAction(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60">
          <option value="">All actions</option>
          {knownActions.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="Filter by user email…" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60" />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60" aria-label="From date" />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60" aria-label="To date" />
      </div>

      {rows === null ? <SkeletonRows rows={6} /> : rows.length === 0 ? (
        <EmptyState
          title={total === 0 && !org && !user && !action && !dateFrom ? 'No activity yet' : 'No activity matches these filters'}
          body={total === 0 && !org && !user && !action && !dateFrom
            ? 'Actions like publishing a survey, exporting data or changing a role will appear here.'
            : 'Try widening the date range or clearing a filter.'}
        />
      ) : (
        <>
          <DataTable head={['Timestamp', 'User', 'Action', 'Detail']}>
            {rows.map(r => (
              <tr key={r.id} className="transition-colors hover:bg-muted/40">
                <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(r.created_at)}</Td>
                <Td className="max-w-[12rem] truncate text-foreground">{r.user_email}</Td>
                <Td className="text-foreground">{actionLabel(r.action_type)}</Td>
                <Td className="max-w-md truncate font-mono text-[11px] text-muted-foreground">{summarizeDetail(r.details)}</Td>
              </tr>
            ))}
          </DataTable>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {page + 1} of {totalPages(total, PAGE_SIZE)}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={!hasPreviousPage(page)} onClick={() => setPage(p => p - 1)}>← Previous</Button>
              <Button variant="ghost" size="sm" disabled={!hasNextPage(page, PAGE_SIZE, total)} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function summarizeDetail(details: Record<string, unknown>): string {
  const entries = Object.entries(details ?? {}).filter(([k]) => k !== 'token' && k !== 'token_hash');
  return entries.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : String(v)}`).join(' · ') || '—';
}
