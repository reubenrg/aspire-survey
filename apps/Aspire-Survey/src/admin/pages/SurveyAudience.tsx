import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import { getSurvey, listOrganizations, type Organization, type SurveyRow } from '../adminStore';
import { listEmployees, listFacets, type Employee } from '../employeeStore';
import {
  buildAudience, fetchAudience, fetchAudienceSummary, inviteUrl, markInvitationsSent,
  regenerateInvitation, revokeInvitations, type AudienceCounts, type AudienceRow,
} from '../audienceStore';
import {
  INVITATION_STATUS_LABEL, PRIVACY_MODE_REMINDER, completionRate, isRemindable, usesInvitationLinks,
  type InvitationStatus,
} from '../labels';
import {
  ConfirmDialog, DataTable, EmptyState, ErrorNote, InvitationStatusPill, PageHeader,
  PrivacyModePill, SearchInput, SkeletonRows, Stat, StatRow, Td, relativeTime,
} from '../ui';

type AudienceCriterion = 'all' | 'department' | 'designation' | 'location' | 'selected';

export default function SurveyAudience() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const session = useAdminSession();

  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [summary, setSummary] = useState<AudienceCounts | null>(null);
  const [rows, setRows] = useState<AudienceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [builderOpen, setBuilderOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ row: AudienceRow; token: string; freshlySent: boolean } | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<AudienceRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await getSurvey(slug);
      if (!found) { setError(`No survey called "${slug}".`); return; }
      setSurvey(found);
      if (found.organization_id) {
        await session.refreshRole(found.organization_id);
        const orgs = await listOrganizations();
        setOrg(orgs.find(o => o.id === found.organization_id) ?? null);
      }
      const [s, a] = await Promise.all([fetchAudienceSummary(found.id), fetchAudience(found.id)]);
      setSummary(s);
      setRows(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const canManage = survey ? session.can(survey.organization_id, 'editor') : false;

  const filtered = useMemo(() => {
    if (!rows) return [];
    const term = search.trim().toLowerCase();
    return rows.filter(r => {
      if (term && !r.employee_name.toLowerCase().includes(term) && !r.employee_code.toLowerCase().includes(term)) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const remindable = useMemo(() => (rows ?? []).filter(r => isRemindable(r.status)), [rows]);

  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const doRevoke = async (targets: AudienceRow[]) => {
    setBusy(true);
    try {
      await revokeInvitations(targets.map(t => t.invitation_id));
      setNotice(`Revoked ${targets.length} invitation${targets.length === 1 ? '' : 's'}.`);
      setConfirmRevoke(null);
      setSelected(new Set());
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const doMarkSent = async (targets: AudienceRow[]) => {
    setBusy(true);
    try {
      await markInvitationsSent(targets.map(t => t.invitation_id));
      setNotice(`Marked ${targets.length} invitation${targets.length === 1 ? '' : 's'} as sent.`);
      setSelected(new Set());
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const doGenerate = async (row: AudienceRow) => {
    setBusy(true); setError(null);
    try {
      const { token } = await regenerateInvitation(row.invitation_id);
      setLinkDialog({ row, token, freshlySent: false });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (error && !survey) {
    return (
      <>
        <ErrorNote>{error}</ErrorNote>
        <Link to="/admin/surveys" className="text-sm text-primary hover:underline">Back to surveys</Link>
      </>
    );
  }
  if (!survey) return <SkeletonRows rows={4} />;

  const invitationBased = usesInvitationLinks(survey.privacy_mode);
  const rate = summary ? completionRate(summary.completed, summary.audience) : 0;

  return (
    <>
      <PageHeader
        title={`${survey.title} — Audience`}
        subtitle={org ? org.name : undefined}
        actions={canManage && invitationBased ? (
          <>
            <Button variant="outline" onClick={() => setBuilderOpen(true)}>Build audience</Button>
            <Button onClick={() => navigate(`/admin/surveys/${survey.slug}/campaign`)}>Email this audience →</Button>
          </>
        ) : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PrivacyModePill mode={survey.privacy_mode} />
        <span className="text-sm text-muted-foreground">{PRIVACY_MODE_REMINDER[survey.privacy_mode]}</span>
      </div>

      {invitationBased && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border border-l-4 border-l-primary bg-primary/5 px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground">
            Copying links one at a time is only for one-off cases. To write the invitation email once and send every
            employee their own link, use <strong>Distribution</strong>.
          </p>
          <Button size="sm" onClick={() => navigate(`/admin/surveys/${survey.slug}/campaign`)}>
            Go to Distribution
          </Button>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && (
        <div className="mb-4 rounded-md border border-border border-l-4 border-l-primary bg-primary/5 px-4 py-2">
          <p className="text-xs text-primary">{notice}</p>
        </div>
      )}

      {!invitationBased ? (
        <EmptyState
          title="This survey does not use an audience"
          body="Anonymous surveys are shared with one public link and have no individual invitations to track. Switch privacy mode is not offered here, since it would change how already-collected responses can be interpreted."
        />
      ) : (
        <>
          <StatRow>
            <Stat label="Audience" value={summary?.audience ?? 0} />
            <Stat label="Sent" value={(summary?.sent ?? 0) + (summary?.opened ?? 0) + (summary?.started ?? 0) + (summary?.completed ?? 0)}
                  hint={`${summary?.not_sent ?? 0} not yet sent`} />
            <Stat label="Completed" value={summary?.completed ?? 0} emphasis />
            <Stat label="Completion rate" value={summary && summary.audience > 0 ? `${rate}%` : '—'} />
          </StatRow>

          <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            {(['not_sent', 'opened', 'expired', 'revoked'] as const).map(k => (
              <div key={k} className="bg-background px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{INVITATION_STATUS_LABEL[k.toUpperCase() as InvitationStatus]}</p>
                <p className="mt-0.5 font-display text-lg tabular-nums text-foreground">{summary?.[k] ?? 0}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">Participants</h2>
            {canManage && (
              <Button
                variant="outline" size="sm" disabled={remindable.length === 0}
                onClick={() => setReminderOpen(true)}
              >
                Remind incomplete participants ({remindable.length})
              </Button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search participants…" className="w-56" />
            <select
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60"
            >
              <option value="">All statuses</option>
              {Object.entries(INVITATION_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {canManage && selected.size > 0 && (
              <>
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                <Button variant="outline" size="sm" onClick={() => doMarkSent(filtered.filter(r => selected.has(r.invitation_id)))}>Mark as sent</Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmRevoke(filtered.filter(r => selected.has(r.invitation_id)))}>
                  Revoke
                </Button>
              </>
            )}
          </div>

          {rows === null ? <SkeletonRows rows={5} /> : filtered.length === 0 ? (
            <EmptyState
              title={rows.length === 0 ? 'No audience yet' : 'No participants match these filters'}
              body={rows.length === 0
                ? 'Build the audience to invite employees to this survey.'
                : 'Try a different search term or status filter.'}
              action={rows.length === 0 && canManage ? <Button size="sm" onClick={() => setBuilderOpen(true)}>Build audience</Button> : undefined}
            />
          ) : (
            <DataTable head={['', 'Employee', 'Employee code', 'Department', 'Location', 'Status', 'Sent', 'Last activity', 'Completion', 'Actions']}>
              {filtered.map(r => (
                <tr key={r.invitation_id} className="transition-colors hover:bg-muted/40">
                  <Td>
                    {canManage && (
                      <input type="checkbox" checked={selected.has(r.invitation_id)} onChange={() => toggle(r.invitation_id)} className="h-3.5 w-3.5 accent-primary" />
                    )}
                  </Td>
                  <Td className="font-medium text-foreground">{r.employee_name}{!r.is_active && <span className="ml-1.5 text-[10px] text-muted-foreground">(inactive)</span>}</Td>
                  <Td className="font-mono text-xs text-muted-foreground">{r.employee_code}</Td>
                  <Td className="text-muted-foreground">{r.department ?? '—'}</Td>
                  <Td className="text-muted-foreground">{r.location ?? '—'}</Td>
                  <Td><InvitationStatusPill status={r.status} /></Td>
                  <Td className="text-muted-foreground">{r.sent_at ? relativeTime(r.sent_at) : '—'}</Td>
                  <Td className="text-muted-foreground">{lastActivity(r)}</Td>
                  <Td>{r.status === 'COMPLETED' ? '✓' : '—'}</Td>
                  <Td>
                    {canManage && (
                      <InvitationRowActions
                        row={r} busy={busy}
                        onGenerate={() => doGenerate(r)}
                        onRevoke={() => setConfirmRevoke([r])}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      )}

      {builderOpen && survey.organization_id && (
        <AudienceBuilder
          surveyId={survey.id} organizationId={survey.organization_id}
          existingEmployeeIds={new Set((rows ?? []).map(r => r.employee_id))}
          onClose={() => setBuilderOpen(false)}
          onBuilt={async n => { setBuilderOpen(false); setNotice(`Added ${n} employee${n === 1 ? '' : 's'} to the audience.`); await load(); }}
        />
      )}

      {linkDialog && (
        <CopyLinkDialog
          row={linkDialog.row} token={linkDialog.token}
          onMarkSent={async () => { await doMarkSent([linkDialog.row]); setLinkDialog(null); }}
          onClose={() => setLinkDialog(null)}
        />
      )}

      {reminderOpen && (
        <ReminderDialog
          targets={remindable} busy={busy}
          onGenerate={async (row) => {
            setBusy(true);
            try { return (await regenerateInvitation(row.invitation_id)).token; }
            finally { setBusy(false); }
          }}
          onClose={async () => { setReminderOpen(false); await load(); }}
        />
      )}

      {confirmRevoke && (
        <ConfirmDialog
          title={`Revoke ${confirmRevoke.length} invitation${confirmRevoke.length === 1 ? '' : 's'}?`}
          body="Their link stops working immediately. This cannot be undone from here, but a new invitation can be issued later."
          confirmLabel="Revoke" destructive busy={busy}
          onConfirm={() => doRevoke(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}
    </>
  );
}

function lastActivity(r: AudienceRow): string {
  const latest = r.completed_at ?? r.started_at ?? r.opened_at ?? r.sent_at;
  return latest ? relativeTime(latest) : '—';
}

function InvitationRowActions({
  row, busy, onGenerate, onRevoke,
}: { row: AudienceRow; busy: boolean; onGenerate: () => void; onRevoke: () => void }) {
  if (row.status === 'COMPLETED') {
    return <span className="text-xs text-muted-foreground">Completed</span>;
  }
  const primaryLabel =
    row.status === 'NOT_SENT' ? 'Generate link'
      : row.status === 'EXPIRED' ? 'Renew'
        : row.status === 'REVOKED' ? 'Regenerate'
          : 'Resend';
  return (
    <div className="flex justify-end gap-1">
      <Button variant="outline" size="sm" disabled={busy} onClick={onGenerate}>{primaryLabel}</Button>
      {row.status !== 'REVOKED' && (
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={onRevoke}>
          Revoke
        </Button>
      )}
    </div>
  );
}

function CopyLinkDialog({
  row, token, onMarkSent, onClose,
}: { row: AudienceRow; token: string; onMarkSent: () => void; onClose: () => void }) {
  const url = inviteUrl(token);
  const [copied, setCopied] = useState(false);
  const wasAlreadySent = row.status !== 'NOT_SENT';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-3 font-display text-lg text-foreground">Invitation link</h2>
        <dl className="mb-4 space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Employee</dt><dd className="text-foreground">{row.employee_name}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Status</dt><dd><InvitationStatusPill status="NOT_SENT" /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Expiry</dt><dd className="text-foreground">{row.expires_at ? new Date(row.expires_at).toLocaleDateString() : 'No expiry set'}</dd></div>
        </dl>

        {wasAlreadySent && (
          <p className="mb-3 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-500">
            The previous link for this person will stop working.
          </p>
        )}

        <div className="flex items-center gap-2">
          <input readOnly value={url} className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs" />
          <Button
            type="button" size="sm"
            onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          This link will not be shown again after you close this window. Copy it now, or regenerate a new one later.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Sending to the whole audience? Don't copy these one by one — <strong className="text-foreground">Distribution</strong> writes
          the email once and gives every employee their own link automatically.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button type="button" onClick={onMarkSent}>Mark as sent</Button>
        </div>
      </div>
    </div>
  );
}

function ReminderDialog({
  targets, busy, onGenerate, onClose,
}: {
  targets: AudienceRow[]; busy: boolean;
  onGenerate: (row: AudienceRow) => Promise<string>;
  onClose: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(targets.map(t => t.invitation_id)));
  const [links, setLinks] = useState<{ row: AudienceRow; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepare = async () => {
    setError(null);
    try {
      const chosen = targets.filter(t => selected.has(t.invitation_id));
      const out: { row: AudienceRow; url: string }[] = [];
      for (const row of chosen) {
        const token = await onGenerate(row);
        out.push({ row, url: inviteUrl(token) });
      }
      setLinks(out);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/30 px-6 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Remind incomplete participants</h2>
        {!links ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Their link has not been completed yet. A fresh link is generated for each person you select
              here, since the original was not retained after it was first shared — the previous link stops
              working once you do this.
            </p>
            {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
              {targets.map(t => (
                <label key={t.invitation_id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/40">
                  <input
                    type="checkbox" checked={selected.has(t.invitation_id)}
                    onChange={() => setSelected(s => { const n = new Set(s); n.has(t.invitation_id) ? n.delete(t.invitation_id) : n.add(t.invitation_id); return n; })}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="flex-1 text-foreground">{t.employee_name}</span>
                  <InvitationStatusPill status={t.status} />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => void onClose()}>Cancel</Button>
              <Button type="button" disabled={selected.size === 0 || busy} onClick={prepare}>
                {busy ? 'Preparing…' : `Prepare ${selected.size} link${selected.size === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">Copy each link and send it through your usual channel.</p>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {links.map(l => (
                <div key={l.row.invitation_id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <span className="w-28 shrink-0 truncate text-xs text-foreground">{l.row.employee_name}</span>
                  <input readOnly value={l.url} className="flex-1 truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[11px]" />
                  <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(l.url)}>Copy</Button>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <Button type="button" onClick={() => void onClose()}>Done</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AudienceBuilder({
  surveyId, organizationId, existingEmployeeIds, onClose, onBuilt,
}: {
  surveyId: string; organizationId: string; existingEmployeeIds: Set<string>;
  onClose: () => void; onBuilt: (n: number) => void;
}) {
  const [criterion, setCriterion] = useState<AudienceCriterion>('all');
  const [value, setValue] = useState('');
  const [facets, setFacets] = useState<{ departments: string[]; designations: string[]; locations: string[] }>({ departments: [], designations: [], locations: [] });
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [f, all] = await Promise.all([listFacets(organizationId), listEmployees(organizationId, { activeOnly: true })]);
        setFacets(f); setEmployees(all);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
  }, [organizationId]);

  const matched = useMemo(() => {
    if (!employees) return [];
    if (criterion === 'all') return employees;
    if (criterion === 'department') return value ? employees.filter(e => e.department === value) : [];
    if (criterion === 'designation') return value ? employees.filter(e => e.designation === value) : [];
    if (criterion === 'location') return value ? employees.filter(e => e.location === value) : [];
    return employees.filter(e => manualSelected.has(e.id));
  }, [employees, criterion, value, manualSelected]);

  const newCount = matched.filter(e => !existingEmployeeIds.has(e.id)).length;
  const alreadyIncluded = matched.length - newCount;

  const searchResults = useMemo(() => {
    if (!employees || criterion !== 'selected') return [];
    const term = search.trim().toLowerCase();
    return employees.filter(e => !term || e.employee_name.toLowerCase().includes(term) || e.employee_code.toLowerCase().includes(term));
  }, [employees, criterion, search]);

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      const ids = matched.filter(e => !existingEmployeeIds.has(e.id)).map(e => e.id);
      const created = await buildAudience(surveyId, ids);
      onBuilt(created);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/30 px-6 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Build audience</h2>
        <p className="mb-4 text-sm text-muted-foreground">Choose who this survey invites. You can add more people later.</p>

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {([
            ['all', 'All active employees'], ['department', 'Department'],
            ['designation', 'Designation'], ['location', 'Location'], ['selected', 'Selected employees'],
          ] as [AudienceCriterion, string][]).map(([c, label]) => (
            <button
              key={c} type="button"
              onClick={() => { setCriterion(c); setValue(''); }}
              className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${criterion === c ? 'border-primary bg-primary/5 text-primary' : 'border-border text-foreground hover:bg-muted/40'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {criterion === 'department' && (
          <select value={value} onChange={e => setValue(e.target.value)} className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60">
            <option value="">Choose a department…</option>
            {facets.departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {criterion === 'designation' && (
          <select value={value} onChange={e => setValue(e.target.value)} className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60">
            <option value="">Choose a designation…</option>
            {facets.designations.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {criterion === 'location' && (
          <select value={value} onChange={e => setValue(e.target.value)} className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60">
            <option value="">Choose a location…</option>
            {facets.locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        {criterion === 'selected' && (
          <div className="mt-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search employees…" />
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {searchResults.map(e => (
                <label key={e.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/40">
                  <input
                    type="checkbox" checked={manualSelected.has(e.id)}
                    onChange={() => setManualSelected(s => { const n = new Set(s); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="flex-1 text-foreground">{e.employee_name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{e.employee_code}</span>
                  {existingEmployeeIds.has(e.id) && <span className="text-[10px] text-muted-foreground">already in audience</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground">
          {employees === null ? 'Loading…' : (
            <>
              <strong>{newCount}</strong> employee{newCount === 1 ? '' : 's'} selected
              {alreadyIncluded > 0 && <span className="text-muted-foreground"> · {alreadyIncluded} already in the audience</span>}
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={newCount === 0 || busy} onClick={apply}>
            {busy ? 'Adding…' : `Add ${newCount} to audience`}
          </Button>
        </div>
      </div>
    </div>
  );
}
