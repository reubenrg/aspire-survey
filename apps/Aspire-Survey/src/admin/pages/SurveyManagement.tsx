import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import {
  duplicateSurvey, listOrganizations, listSurveys, setArchived,
  type Organization, type SurveyRow,
} from '../adminStore';
import { setClosed } from '../reportStore';
import { fetchSurveySummaries, type SurveySummary } from '../platformStore';
import { completionRate, genericLinkWarning, usesInvitationLinks } from '../labels';
import {
  DataTable, EmptyState, ErrorNote, FilterSelect, PageHeader, PrivacyModePill,
  RowMenu, SearchInput, SkeletonRows, SurveyStatusPill, Td, relativeTime,
} from '../ui';

/**
 * The operational home for every survey the caller can see. Data comes from
 * one aggregated RPC (admin_survey_summaries), so opening this screen never
 * pulls a single response row to the browser just to count it; filtering
 * that small summary set is done here rather than round-tripping per filter.
 */
export default function SurveyManagement() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SurveySummary[] | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [shareFor, setShareFor] = useState<SurveySummary | null>(null);

  const load = useCallback(async () => {
    try {
      const [summaries, organizations] = await Promise.all([fetchSurveySummaries(), listOrganizations()]);
      setRows(summaries);
      setOrgs(organizations);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const orgBySlugId = useMemo(() => new Map(orgs.map(o => [o.id, o])), [orgs]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const term = search.trim().toLowerCase();
    return rows.filter(r => {
      if (term && !r.title.toLowerCase().includes(term) && !r.slug.toLowerCase().includes(term)) return false;
      if (customer && r.organization_id !== customer) return false;
      if (status && r.status !== status) return false;
      if (privacy && r.privacy_mode !== privacy) return false;
      return true;
    });
  }, [rows, search, customer, status, privacy]);

  return (
    <>
      <PageHeader
        title="Surveys"
        subtitle={rows === null ? 'Loading…' : `${filtered.length} of ${rows.length} survey${rows.length === 1 ? '' : 's'}.`}
        actions={<Link to="/admin/surveys/new"><Button>New survey</Button></Link>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search surveys…" className="w-56" />
        <FilterSelect
          label="Customer" value={customer} onChange={setCustomer}
          options={orgs.map(o => ({ value: o.id, label: o.name }))}
        />
        <FilterSelect
          label="Status" value={status} onChange={setStatus}
          options={[
            { value: 'DRAFT', label: 'Draft' }, { value: 'LIVE', label: 'Live' },
            { value: 'CLOSED', label: 'Closed' }, { value: 'ARCHIVED', label: 'Archived' },
          ]}
        />
        <FilterSelect
          label="Privacy mode" value={privacy} onChange={setPrivacy}
          options={[
            { value: 'ANONYMOUS', label: 'Anonymous' },
            { value: 'ANONYMOUS_TRACKED', label: 'Anonymous — Participation Tracked' },
            { value: 'CONFIDENTIAL', label: 'Confidential' },
          ]}
        />
        {(search || customer || status || privacy) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setCustomer(''); setStatus(''); setPrivacy(''); }}>
            Clear filters
          </Button>
        )}
      </div>

      {rows === null ? <SkeletonRows rows={5} /> : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            title="No surveys yet"
            body="Surveys belong to a customer. Create a customer first if you haven't, then start your first survey."
            action={<Link to="/admin/surveys/new"><Button size="sm">New survey</Button></Link>}
          />
        ) : (
          <EmptyState title="No surveys match these filters" body="Try a different search term or clear the filters above." />
        )
      ) : (
        <DataTable head={[
          'Survey', 'Customer', 'Privacy mode', 'Status', 'Version', 'Responses',
          'Audience', 'Completion', 'Owner', 'Updated', '',
        ]}>
          {filtered.map(r => {
            const canEdit = session.can(r.organization_id, 'editor');
            const org = r.organization_id ? orgBySlugId.get(r.organization_id) : undefined;
            const rate = completionRate(r.completed, r.audience);
            return (
              <tr key={r.slug} className="transition-colors hover:bg-muted/40">
                <Td>
                  <Link to={`/admin/surveys/${r.slug}`} className="block min-w-0">
                    <span className="block truncate font-medium text-foreground hover:underline">{r.title}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">/s/{r.slug}</span>
                  </Link>
                </Td>
                <Td className="text-muted-foreground">{r.organization_name ?? 'Unfiled'}</Td>
                <Td><PrivacyModePill mode={r.privacy_mode} /></Td>
                <Td><SurveyStatusPill status={r.status} /></Td>
                <Td className="tabular-nums text-muted-foreground">v{r.current_version}</Td>
                <Td className="tabular-nums">{r.responses.toLocaleString()}</Td>
                <Td className="tabular-nums">{r.audience.toLocaleString()}</Td>
                <Td className="tabular-nums">
                  {r.audience > 0 ? `${rate}%` : '—'}
                </Td>
                <Td className="max-w-[10rem] truncate text-muted-foreground">{r.created_by ?? '—'}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(r.updated_at)}</Td>
                <Td>
                  <div className="flex justify-end">
                    <RowMenu items={[
                      { label: 'Edit', onSelect: () => navigate(`/admin/surveys/${r.slug}/builder`) },
                      { label: 'Edit (original editor)', onSelect: () => navigate(`/admin/${r.slug}`) },
                      { label: 'Audience', onSelect: () => navigate(`/admin/surveys/${r.slug}/audience`) },
                      { label: 'Distribution', onSelect: () => navigate(`/admin/surveys/${r.slug}/campaign`) },
                      {
                        label: 'Preview',
                        disabled: r.status !== 'LIVE',
                        disabledReason: r.status !== 'LIVE' ? 'Publish this survey first' : undefined,
                        onSelect: () => window.open(`/s/${r.slug}`, '_blank', 'noreferrer'),
                      },
                      { label: 'Share', onSelect: () => setShareFor(r) },
                      { label: 'Responses', onSelect: () => navigate(`/admin/surveys/${r.slug}/responses`) },
                      { label: 'Analytics', onSelect: () => navigate(`/admin/surveys/${r.slug}/analytics`) },
                      { label: 'Report', onSelect: () => navigate(`/admin/surveys/${r.slug}/report`) },
                      {
                        label: 'Duplicate', disabled: !canEdit,
                        disabledReason: !canEdit ? 'Needs editor access' : undefined,
                        onSelect: async () => {
                          try {
                            const full = await findRow(r.slug);
                            const copy = await duplicateSurvey(full);
                            navigate(`/admin/${copy.slug}`);
                          } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                        },
                      },
                      {
                        label: r.status === 'CLOSED' ? 'Reopen' : 'Close',
                        disabled: !canEdit || r.status === 'DRAFT' || r.status === 'ARCHIVED',
                        disabledReason: !canEdit ? 'Needs editor access' : r.status === 'DRAFT' ? 'Publish it first' : undefined,
                        onSelect: async () => {
                          try { await setClosed(r.slug, r.organization_id, r.status !== 'CLOSED'); await load(); }
                          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                        },
                      },
                      {
                        label: r.status === 'ARCHIVED' ? 'Unarchive' : 'Archive',
                        disabled: !canEdit,
                        disabledReason: !canEdit ? 'Needs editor access' : undefined,
                        onSelect: async () => {
                          try { await setArchived(r.slug, r.status !== 'ARCHIVED'); await load(); }
                          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                        },
                      },
                    ]} />
                  </div>
                </Td>
              </tr>
            );
          })}
        </DataTable>
      )}

      {shareFor && <ShareDialog summary={shareFor} onClose={() => setShareFor(null)} />}
    </>
  );

  async function findRow(slug: string): Promise<SurveyRow> {
    const list = await listSurveys();
    const found = list.find(s => s.slug === slug);
    if (!found) throw new Error('Could not reload this survey to duplicate it.');
    return found;
  }
}

function ShareDialog({ summary, onClose }: { summary: SurveySummary; onClose: () => void }) {
  const url = `${window.location.origin}/s/${summary.slug}`;
  const warning = genericLinkWarning(summary.privacy_mode);
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Share “{summary.title}”</h2>
        {warning ? (
          <>
            <div className="mb-4 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-500">{warning}</p>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {usesInvitationLinks(summary.privacy_mode)
                ? 'Send individual employee links from the Audience page instead.'
                : ''}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
              <Link to={`/admin/surveys/${summary.slug}/audience`}>
                <Button type="button">Go to Audience</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">Anyone with this link can take the survey.</p>
            <div className="flex items-center gap-2">
              <input readOnly value={url} className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs" />
              <Button
                type="button" size="sm"
                onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="mt-5 flex justify-end">
              <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
