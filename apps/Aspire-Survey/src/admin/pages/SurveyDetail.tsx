import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import { countResponses, getSurvey, listOrganizations, setArchived, setPublished, type Organization, type SurveyRow } from '../adminStore';
import { setClosed } from '../reportStore';
import { fetchAudienceSummary, type AudienceCounts } from '../audienceStore';
import { completionRate, genericLinkWarning, PRIVACY_MODE_DESCRIPTION, usesInvitationLinks } from '../labels';
import { ErrorNote, PageHeader, PrivacyModePill, Skeleton, Stat, StatRow, SurveyStatusPill } from '../ui';

/**
 * The hub someone lands on after clicking a survey: the numbers that matter
 * and the handful of actions that follow from this survey's actual state,
 * rather than the full question-by-question builder. Editing questions is a
 * deliberate extra click away, at the existing /admin/:slug builder.
 */
export default function SurveyDetail() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const session = useAdminSession();
  const [row, setRow] = useState<SurveyRow | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [responses, setResponses] = useState<number | null>(null);
  const [audience, setAudience] = useState<AudienceCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await getSurvey(slug);
      if (!found) { setError(`No survey called "${slug}".`); return; }
      setRow(found);
      setError(null);
      if (found.organization_id) {
        await session.refreshRole(found.organization_id);
        const orgs = await listOrganizations();
        setOrg(orgs.find(o => o.id === found.organization_id) ?? null);
      }
      const [n, aud] = await Promise.all([
        countResponses(found.slug),
        fetchAudienceSummary(found.id).catch(() => null),
      ]);
      setResponses(n);
      setAudience(aud);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  if (error && !row) {
    return (
      <>
        <ErrorNote>{error}</ErrorNote>
        <Link to="/admin/surveys" className="text-sm text-primary hover:underline">Back to surveys</Link>
      </>
    );
  }
  if (!row) {
    return (
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="bg-background px-4 py-3.5"><Skeleton className="h-12 w-full" /></div>)}
      </div>
    );
  }

  const status = row.archived_at ? 'ARCHIVED' as const : row.closed_at ? 'CLOSED' as const : row.published ? 'LIVE' as const : 'DRAFT' as const;
  const canEdit = session.can(row.organization_id, 'editor');
  const rate = audience ? completionRate(audience.completed, audience.audience) : 0;
  const generic = genericLinkWarning(row.privacy_mode);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title={row.title}
        subtitle={`/s/${row.slug}${org ? ` · ${org.name}` : ''}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(`/admin/surveys/${row.slug}/builder`)}>Edit survey</Button>
            <Button variant="outline" onClick={() => navigate(`/admin/surveys/${row.slug}/audience`)}>Manage audience</Button>
            {status === 'LIVE' && (
              <Button
                variant="outline"
                disabled={status !== 'LIVE' || generic !== null || busy}
                title={generic ?? undefined}
                onClick={() => window.open(`/s/${row.slug}`, '_blank', 'noreferrer')}
              >
                Preview
              </Button>
            )}
            {canEdit && status === 'DRAFT' && (
              <Button disabled={busy} onClick={() => act(() => setPublished(row.slug, true))}>Publish</Button>
            )}
            {canEdit && status === 'LIVE' && (
              <Button variant="outline" disabled={busy} onClick={() => act(() => setClosed(row.slug, row.organization_id, true))}>Close</Button>
            )}
            {canEdit && status === 'CLOSED' && (
              <Button variant="outline" disabled={busy} onClick={() => act(() => setClosed(row.slug, row.organization_id, false))}>Reopen</Button>
            )}
            {canEdit && status !== 'ARCHIVED' && (
              <Button variant="ghost" disabled={busy} onClick={() => act(() => setArchived(row.slug, true))}>Archive</Button>
            )}
            {canEdit && status === 'ARCHIVED' && (
              <Button variant="ghost" disabled={busy} onClick={() => act(() => setArchived(row.slug, false))}>Unarchive</Button>
            )}
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SurveyStatusPill status={status} />
        <PrivacyModePill mode={row.privacy_mode} />
        {row.category && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{row.category}</span>}
      </div>

      {generic && (
        <div className="mb-4 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-3 py-2.5">
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-500">{generic}</p>
        </div>
      )}

      <StatRow>
        <Stat label="Response count" value={responses ?? '—'} />
        <Stat label="Audience" value={usesInvitationLinks(row.privacy_mode) ? (audience?.audience ?? 0) : '—'}
              hint={usesInvitationLinks(row.privacy_mode) ? undefined : 'not used for anonymous surveys'} />
        <Stat label="Completion" value={usesInvitationLinks(row.privacy_mode) && audience && audience.audience > 0 ? `${rate}%` : '—'} />
        <Stat label="Version" value={`v${row.current_version}`} hint={`last updated ${new Date(row.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`} />
      </StatRow>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Privacy mode</p>
          <p className="text-sm leading-relaxed text-foreground">{PRIVACY_MODE_DESCRIPTION[row.privacy_mode]}</p>
        </div>
        {row.purpose && (
          <div className="rounded-lg border border-border p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Internal purpose</p>
            <p className="text-sm leading-relaxed text-foreground">{row.purpose}</p>
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Link to={`/admin/${row.slug}/report`}><Button variant="outline" size="sm">View responses</Button></Link>
        <Link to={`/admin/${row.slug}`} className="text-xs text-muted-foreground hover:text-foreground">
          Open in original editor (SQL, translations) →
        </Link>
        {!canEdit && (
          <span className="self-center text-xs text-muted-foreground">You have read-only access to this customer.</span>
        )}
      </div>
    </>
  );
}
