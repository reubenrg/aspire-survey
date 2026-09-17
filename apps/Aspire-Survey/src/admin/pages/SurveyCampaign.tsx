import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import { getSurvey, listOrganizations, type Organization, type SurveyRow } from '../adminStore';
import { regenerateInvitation, revokeInvitations, inviteUrl } from '../audienceStore';
import {
  cancelCampaign, createCampaign, fetchCampaignRecipients, fetchDistributionAudience,
  fetchLatestCampaign, fetchRecipientSummary, isProductionEmailDomainVerified, markCampaignCompleted,
  markCampaignTested, scheduleCampaignSend, sendCampaignNow, sendReminders, sendTestEmail,
  syncCampaignRecipients, updateCampaignComposer, type Campaign, type CampaignRecipientRow,
  type RecipientSummary,
} from '../campaignStore';
import { eligibleRecipients } from '../campaignEligibility';
import { renderCampaignEmail } from '../emailTemplate';
import { PRIVACY_MODE_LABEL } from '../labels';
import {
  ConfirmDialog, ErrorNote, InvitationStatusPill, PageHeader, PrivacyModePill, Skeleton,
} from '../ui';

const CAMPAIGN_STATUS_LABEL: Record<Campaign['status'], string> = {
  DRAFT: 'Draft', TESTED: 'Tested', SCHEDULED: 'Scheduled', SENDING: 'Sending…', SENT: 'Sent',
  PARTIALLY_FAILED: 'Partially failed', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};

const MERGE_HELP = '{{employee_first_name}}, {{survey_title}}, {{customer_name}}, {{due_date}}';

export default function SurveyCampaign() {
  const { slug = '' } = useParams();
  const session = useAdminSession();

  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [audience, setAudience] = useState<Awaited<ReturnType<typeof fetchDistributionAudience>> | null>(null);
  const [summary, setSummary] = useState<RecipientSummary | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipientRow[] | null>(null);
  const [domainVerified, setDomainVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const [c, aud, verified] = await Promise.all([
        fetchLatestCampaign(found.id),
        fetchDistributionAudience(found.id),
        isProductionEmailDomainVerified(),
      ]);
      setCampaign(c);
      setAudience(aud);
      setDomainVerified(verified);
      if (c && c.status !== 'CANCELLED') {
        const [s, r] = await Promise.all([fetchRecipientSummary(c.id), fetchCampaignRecipients(c.id)]);
        setSummary(s); setRecipients(r);
      } else {
        setSummary(null); setRecipients(null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const canEdit = survey ? session.can(survey.organization_id, 'editor') : false;
  const eligibility = useMemo(() => (audience ? eligibleRecipients(audience) : null), [audience]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
  if (!survey || !audience || !eligibility) {
    return (
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="bg-background px-4 py-3.5"><Skeleton className="h-12 w-full" /></div>)}
      </div>
    );
  }

  const activeCampaign = campaign && campaign.status !== 'CANCELLED' ? campaign : null;

  return (
    <>
      <PageHeader
        title="Distribution"
        subtitle={`${survey.title}${org ? ` · ${org.name}` : ''}`}
        actions={<Link to={`/admin/surveys/${survey.slug}`} className="text-sm text-muted-foreground hover:text-foreground">← Back to survey</Link>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PrivacyModePill mode={survey.privacy_mode} />
        {activeCampaign && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {CAMPAIGN_STATUS_LABEL[activeCampaign.status]}
          </span>
        )}
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCell label="Audience" value={audience.length} />
        <SummaryCell label="Valid email" value={eligibility.valid.length} />
        <SummaryCell label="Missing email" value={eligibility.missingEmail.length} warn={eligibility.missingEmail.length > 0} />
        <SummaryCell label="Invalid email" value={eligibility.invalidEmail.length} warn={eligibility.invalidEmail.length > 0} />
        <SummaryCell label="Already invited" value={eligibility.alreadyInvited.length} />
        <SummaryCell label="New recipients" value={eligibility.newRecipients.length} />
      </div>

      {!domainVerified && (
        <div className="mt-4 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-4 py-3">
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-500">
            Production email domain is not verified. Test emails are available; bulk employee email sending is disabled.
          </p>
        </div>
      )}

      {!activeCampaign ? (
        <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="mb-1 text-sm font-medium text-foreground">No campaign yet</p>
          <p className="mb-4 text-sm text-muted-foreground">
            {eligibility.valid.length === 0
              ? 'Build this survey\'s audience on the Audience page first.'
              : 'Create a campaign to compose, test and send an invitation email to this survey\'s audience.'}
          </p>
          {canEdit && eligibility.valid.length > 0 && (
            <Button disabled={busy} onClick={() => act(async () => {
              const c = await createCampaign({
                surveyId: survey.id, surveyVersion: survey.current_version,
                organizationId: survey.organization_id!, privacyMode: survey.privacy_mode,
              });
              await syncCampaignRecipients(c.id, audience.map(e => e.id));
            })}>
              Create campaign
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <ComposerSection campaign={activeCampaign} survey={survey} orgName={org?.name ?? 'this customer'} canEdit={canEdit} busy={busy} onSave={patch => act(() => updateCampaignComposer(activeCampaign.id, survey.organization_id!, patch))} />
          <TestSection campaign={activeCampaign} canEdit={canEdit} busy={busy} onSent={() => act(() => markCampaignTested(activeCampaign.id))} />
          <SendSection
            campaign={activeCampaign} canEdit={canEdit} busy={busy} domainVerified={domainVerified}
            eligibleCount={eligibility.valid.length} orgName={org?.name ?? 'this customer'}
            onSend={() => act(async () => { const r = await sendCampaignNow(activeCampaign.id); if (!r.ok && r.error) throw new Error(r.error); })}
            onSchedule={date => act(() => scheduleCampaignSend(activeCampaign.id, date))}
            onCancel={() => act(() => cancelCampaign(activeCampaign.id))}
          />
          {summary && recipients && (
            <MonitorSection
              summary={summary} recipients={recipients} canEdit={canEdit} busy={busy}
              onReminders={() => act(async () => { const r = await sendReminders(activeCampaign.id); if (!r.ok && r.error) throw new Error(r.error); })}
              onRetryFailed={() => act(async () => { const r = await sendCampaignNow(activeCampaign.id); if (!r.ok && r.error) throw new Error(r.error); })}
              onCopyLink={async invitationId => {
                const link = await regenerateInvitation(invitationId);
                await navigator.clipboard.writeText(inviteUrl(link.token));
              }}
              onRevoke={invitationId => act(() => revokeInvitations([invitationId]).then(() => undefined))}
              onMarkCompleted={() => act(() => markCampaignCompleted(activeCampaign.id))}
            />
          )}
        </div>
      )}
    </>
  );
}

function SummaryCell({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-background px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${warn ? 'text-amber-600 dark:text-amber-500' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────

function ComposerSection({
  campaign, survey, orgName, canEdit, busy, onSave,
}: {
  campaign: Campaign; survey: SurveyRow; orgName: string; canEdit: boolean; busy: boolean;
  onSave: (patch: Parameters<typeof updateCampaignComposer>[2]) => void;
}) {
  const editable = canEdit && (campaign.status === 'DRAFT' || campaign.status === 'TESTED');
  const [senderName, setSenderName] = useState(campaign.sender_name);
  const [replyTo, setReplyTo] = useState(campaign.reply_to ?? '');
  const [subject, setSubject] = useState(campaign.subject);
  const [previewText, setPreviewText] = useState(campaign.preview_text ?? '');
  const [bodyText, setBodyText] = useState(campaign.body_text);
  const [ctaLabel, setCtaLabel] = useState(campaign.cta_label);
  const [dueDate, setDueDate] = useState(campaign.due_date ?? '');
  const [dirty, setDirty] = useState(false);

  const preview = useMemo(() => renderCampaignEmail(
    { subject, previewText, bodyText, ctaLabel, ctaUrl: `${window.location.origin}/r/sample-token`, senderName },
    {
      employeeFirstName: 'Priya', surveyTitle: survey.title, customerName: orgName,
      dueDate: dueDate ? new Date(dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
    },
  ), [subject, previewText, bodyText, ctaLabel, senderName, survey.title, orgName, dueDate]);

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium text-foreground">1. Email</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Merge variables available: <code className="font-mono">{MERGE_HELP}</code>. Plain text only - no HTML is accepted or rendered from this box.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="From name">
            <input disabled={!editable} value={senderName} onChange={e => { setSenderName(e.target.value); setDirty(true); }} className={inputCls} />
          </Field>
          <Field label="Reply-to (optional)">
            <input disabled={!editable} value={replyTo} onChange={e => { setReplyTo(e.target.value); setDirty(true); }} placeholder="you@yourcompany.com" className={inputCls} />
          </Field>
          <Field label="Subject">
            <input disabled={!editable} value={subject} onChange={e => { setSubject(e.target.value); setDirty(true); }} className={inputCls} />
          </Field>
          <Field label="Preview text (optional)">
            <input disabled={!editable} value={previewText} onChange={e => { setPreviewText(e.target.value); setDirty(true); }} className={inputCls} />
          </Field>
          <Field label="Body">
            <textarea disabled={!editable} rows={8} value={bodyText} onChange={e => { setBodyText(e.target.value); setDirty(true); }} className={inputCls} />
          </Field>
          <Field label="Button text">
            <input disabled={!editable} value={ctaLabel} onChange={e => { setCtaLabel(e.target.value); setDirty(true); }} className={inputCls} />
          </Field>
          <Field label="Due date (optional)">
            <input type="date" disabled={!editable} value={dueDate} onChange={e => { setDueDate(e.target.value); setDirty(true); }} className={inputCls} />
          </Field>
          {editable && (
            <Button size="sm" disabled={busy || !dirty} onClick={() => {
              onSave({ sender_name: senderName, reply_to: replyTo || null, subject, preview_text: previewText || null, body_text: bodyText, cta_label: ctaLabel, due_date: dueDate || null });
              setDirty(false);
            }}>
              Save
            </Button>
          )}
          {!editable && <p className="text-xs text-muted-foreground">This campaign has moved past Draft/Tested - the email is locked to what was actually sent.</p>}
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Preview - {preview.subject}</p>
          <div className="overflow-hidden rounded-lg border border-border">
            <iframe title="Email preview" className="h-[420px] w-full bg-white" srcDoc={preview.html} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-foreground">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
const inputCls = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30 disabled:opacity-60';

// ── Test ─────────────────────────────────────────────────────────────────

function TestSection({ campaign, canEdit, busy, onSent }: { campaign: Campaign; canEdit: boolean; busy: boolean; onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const send = async () => {
    setSending(true); setResult(null);
    try {
      const r = await sendTestEmail(campaign.id, email.trim());
      setResult(r);
      if (r.ok) onSent();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium text-foreground">2. Test</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Sends the real email formatting to a test address using a synthetic link. It never touches a real employee's
        invitation, never marks anyone opened/started/completed, and never creates a real response.
      </p>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourcompany.com" className={`${inputCls} max-w-xs`} />
          <Button size="sm" disabled={busy || sending || !email.trim()} onClick={send}>{sending ? 'Sending…' : 'Send test email'}</Button>
        </div>
      )}
      {result && (
        <p className={`mt-2 text-xs ${result.ok ? 'text-primary' : 'text-destructive'}`}>
          {result.ok ? 'Test email sent.' : `Test email failed: ${result.error}`}
        </p>
      )}
    </section>
  );
}

// ── Send ─────────────────────────────────────────────────────────────────

function SendSection({
  campaign, canEdit, busy, domainVerified, eligibleCount, orgName, onSend, onSchedule, onCancel,
}: {
  campaign: Campaign; canEdit: boolean; busy: boolean; domainVerified: boolean; eligibleCount: number; orgName: string;
  onSend: () => void; onSchedule: (date: string) => void; onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const canSend = canEdit && (campaign.status === 'DRAFT' || campaign.status === 'TESTED' || campaign.status === 'SCHEDULED' || campaign.status === 'PARTIALLY_FAILED');

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium text-foreground">3. Send</h2>
      {!domainVerified && (
        <p className="mb-3 text-xs text-amber-700 dark:text-amber-500">
          Bulk sending is disabled until a founder verifies a custom email domain (see the notice above).
        </p>
      )}
      {canSend && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !domainVerified} onClick={() => setConfirming(true)}>
            {campaign.status === 'PARTIALLY_FAILED' ? 'Retry failed recipients' : `Send to ${eligibleCount} recipients`}
          </Button>
          <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} className={`${inputCls} w-auto`} />
          <Button size="sm" variant="outline" disabled={busy || !scheduleAt} onClick={() => onSchedule(new Date(scheduleAt).toISOString())}>Schedule</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel} className="text-destructive hover:text-destructive">Cancel campaign</Button>
        </div>
      )}
      {campaign.status === 'SCHEDULED' && campaign.scheduled_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          Scheduled for {new Date(campaign.scheduled_at).toLocaleString()}. Automatic firing at this time is not yet implemented -
          an editor needs to return and send manually once that time arrives.
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title="Send campaign"
          body={
            <div className="space-y-1">
              <p><strong>Customer:</strong> {orgName}</p>
              <p><strong>Privacy mode:</strong> {PRIVACY_MODE_LABEL[campaign.privacy_mode]}</p>
              <p><strong>Recipients:</strong> {eligibleCount}</p>
              <p><strong>Sender:</strong> {campaign.sender_name} &lt;{campaign.sender_email}&gt;</p>
              <p><strong>Subject:</strong> {campaign.subject}</p>
              {campaign.due_date && <p><strong>Due:</strong> {campaign.due_date}</p>}
            </div>
          }
          confirmLabel={`Send to ${eligibleCount} recipients`}
          busy={busy}
          onConfirm={() => { setConfirming(false); onSend(); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

// ── Monitor ──────────────────────────────────────────────────────────────

function MonitorSection({
  summary, recipients, canEdit, busy, onReminders, onRetryFailed, onCopyLink, onRevoke, onMarkCompleted,
}: {
  summary: RecipientSummary; recipients: CampaignRecipientRow[]; canEdit: boolean; busy: boolean;
  onReminders: () => void; onRetryFailed: () => void;
  onCopyLink: (invitationId: string) => void; onRevoke: (invitationId: string) => void;
  onMarkCompleted: () => void;
}) {
  const completionRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium text-foreground">4. Monitor</h2>
      <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
        <SummaryCell label="Sent" value={summary.sent} />
        <SummaryCell label="Failed" value={summary.failed} warn={summary.failed > 0} />
        <SummaryCell label="Opened" value={summary.opened} />
        <SummaryCell label="Completed" value={summary.completed} />
        <SummaryCell label="Completion" value={completionRate} />
      </div>

      {canEdit && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {summary.failed > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={onRetryFailed}>Retry failed only</Button>}
          <Button size="sm" variant="outline" disabled={busy} onClick={onReminders}>Send reminders</Button>
          {summary.failed === 0 && summary.total > 0 && summary.sent + summary.delivered > 0 && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onMarkCompleted}>Mark campaign completed</Button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Delivery</th>
              <th className="px-3 py-2 font-medium">Participation</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recipients.map(r => (
              <tr key={r.recipient_id}>
                <td className="px-3 py-2 text-foreground">{r.employee_name}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.email ?? '—'}</td>
                <td className="px-3 py-2"><DeliveryPill status={r.delivery_status} /></td>
                <td className="px-3 py-2"><InvitationStatusPill status={r.invitation_status} /></td>
                <td className="px-3 py-2 text-right">
                  {canEdit && r.invitation_status !== 'REVOKED' && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onCopyLink(r.invitation_id)}>Copy link</Button>
                      {r.invitation_status !== 'COMPLETED' && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onRevoke(r.invitation_id)}>Revoke</Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {recipients.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">No recipients yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DeliveryPill({ status }: { status: CampaignRecipientRow['delivery_status'] }) {
  const tone: Record<CampaignRecipientRow['delivery_status'], string> = {
    NOT_SENT: 'bg-muted text-muted-foreground',
    QUEUED: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    SENT: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
    DELIVERED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    BOUNCED: 'bg-destructive/10 text-destructive',
    FAILED: 'bg-destructive/10 text-destructive',
  };
  const label: Record<CampaignRecipientRow['delivery_status'], string> = {
    NOT_SENT: 'Not sent', QUEUED: 'Queued', SENT: 'Sent', DELIVERED: 'Delivered', BOUNCED: 'Bounced', FAILED: 'Failed',
  };
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone[status]}`}>{label[status]}</span>;
}
