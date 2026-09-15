import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import SurveyEditor from '../admin/SurveyEditor';
import { Alert, useAdminSession } from '../admin/AdminGate';
import {
  createOrganization, deleteSurvey, getSurvey, groupByOrganization, listOrganizations,
  listSurveys, saveSurvey, slugify,
  type Organization, type OrganizationGroup, type SurveyRow,
} from '../admin/adminStore';
import type { SurveyDefinition } from '../engine/types';

function blankSurvey(title: string): SurveyDefinition {
  return {
    slug: slugify(title) || 'untitled-survey',
    title,
    welcome: { heading: title, body: ['Thank you for taking part.'], startLabel: 'Begin Survey' },
    thankYou: { heading: 'Thank You!', body: 'Your response has been recorded.' },
    uniqueBy: 'employeeId',
    sections: [{
      id: 'about',
      title: 'About You',
      questions: [{ id: 'employeeId', type: 'text', label: 'Employee ID', required: true }],
    }],
  };
}

export function AdminList() {
  const session = useAdminSession();
  const [groups, setGroups] = useState<OrganizationGroup[] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [surveys, orgs] = await Promise.all([listSurveys(), listOrganizations()]);
      setOrganizations(orgs);
      setGroups(groupByOrganization(surveys, orgs));
      await Promise.all(orgs.map(o => session.refreshRole(o.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGroups([]);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const total = useMemo(
    () => groups?.reduce((n, g) => n + g.surveys.length, 0) ?? 0,
    [groups],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-foreground">Surveys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total === 0 ? 'No surveys yet.' : `${total} survey${total === 1 ? '' : 's'} across ${organizations.length} organisation${organizations.length === 1 ? '' : 's'}.`}
            {' '}Each survey has its own URL and its own response table.
          </p>
        </div>
        {session.can(null, 'owner') && (
          <Button variant="outline" onClick={() => setNewOrgOpen(true)}>New organisation</Button>
        )}
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {newOrgOpen && (
        <NewOrganizationDialog
          onClose={() => setNewOrgOpen(false)}
          onCreated={async org => {
            setNewOrgOpen(false);
            await session.refreshRole(org.id);
            await load();
          }}
        />
      )}

      {groups === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="space-y-4">
        {groups?.map(group => {
          const key = group.organization?.id ?? '__unfiled';
          const isCollapsed = collapsed[key] ?? false;
          const canEdit = session.can(group.organization?.id ?? null, 'editor');
          const canDelete = session.can(group.organization?.id ?? null, 'owner');

          return (
            <section key={key} className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setCollapsed(c => ({ ...c, [key]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <span className={cn('text-xs text-muted-foreground transition-transform', isCollapsed ? '' : 'rotate-90')}>▶</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {group.organization?.name ?? 'Unfiled'}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {group.organization ? `/${group.organization.slug}` : 'no organisation set'}
                    {' · '}{group.surveys.length} survey{group.surveys.length === 1 ? '' : 's'}
                  </span>
                </span>
                <RolePill role={session.roleIn(group.organization?.id ?? null)} />
              </button>

              {!isCollapsed && (
                <div className="border-t border-border p-3">
                  {group.organization && canEdit && (
                    <NewSurveyRow
                      organization={group.organization}
                      onCreated={slug => navigate(`/admin/${slug}`)}
                      onError={setError}
                    />
                  )}
                  {group.surveys.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">No surveys in this folder yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {group.surveys.map(row => (
                        <SurveyRowItem
                          key={row.id} row={row} canDelete={canDelete}
                          onDeleted={() => load()} onError={setError}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RolePill({ role }: { role: string | null }) {
  if (!role) return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">no access</span>;
  return (
    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
      {role}
    </span>
  );
}

function SurveyRowItem({
  row, canDelete, onDeleted, onError,
}: { row: SurveyRow; canDelete: boolean; onDeleted: () => void; onError: (m: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
          <span className={row.published
            ? 'rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'
            : 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'}>
            {row.published ? 'Published' : 'Draft'}
          </span>
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          /s/{row.slug} → {row.table_name}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {row.published && (
          <a href={`/s/${row.slug}`} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm">Open</Button>
          </a>
        )}
        <Link to={`/admin/${row.slug}`}><Button variant="outline" size="sm">Edit</Button></Link>
        {canDelete && (
          <Button
            variant="ghost" size="sm" className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!confirm(`Delete "${row.title}"?\n\nThis removes the survey definition. Its response table and any answers already collected are left untouched.`)) return;
              try { await deleteSurvey(row.slug); onDeleted(); }
              catch (e) { onError(e instanceof Error ? e.message : String(e)); }
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function NewSurveyRow({
  organization, onCreated, onError,
}: { organization: Organization; onCreated: (slug: string) => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const def = blankSurvey(title.trim() || 'Untitled survey');
    setBusy(true);
    try {
      await saveSurvey(def, false, organization.id);
      onCreated(def.slug);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void create(); }}
        placeholder={`New survey in ${organization.name}`}
        className="min-w-52 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
      />
      <Button size="sm" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create survey'}</Button>
    </div>
  );
}

function NewOrganizationDialog({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (org: Organization) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      onCreated(await createOrganization(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">New organisation</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          A folder for one client's surveys. Everyone's access is granted per organisation.
        </p>
        <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="org-name">Name</label>
        <input
          id="org-name" autoFocus required value={name}
          onChange={e => setName(e.target.value)}
          placeholder="S2M Health"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
        {name.trim() && (
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">slug: {slugify(name) || '—'}</p>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </div>
      </form>
    </div>
  );
}

export function AdminEditor() {
  const { slug = '' } = useParams();
  const session = useAdminSession();
  const [row, setRow] = useState<SurveyRow | null>(null);
  const [def, setDef] = useState<SurveyDefinition | null>(null);
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSurvey(slug)
      .then(async found => {
        if (!found) { setError(`No survey called "${slug}".`); return; }
        setRow(found);
        setDef(found.definition);
        setPublished(found.published);
        if (found.organization_id) await session.refreshRole(found.organization_id);
      })
      .catch(e => setError(e.message));
  }, [slug, session]);

  const canEdit = session.can(row?.organization_id ?? null, 'editor');

  const save = async () => {
    if (!def) return;
    setSaving(true); setError(null);
    try {
      await saveSurvey(def, published, row?.organization_id ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error && !def) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Alert>{error}</Alert>
        <Link to="/admin" className="mt-3 inline-block text-sm text-primary underline">Back to surveys</Link>
      </div>
    );
  }
  if (!def) return <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-3 px-6 pt-4">
        {error && <Alert>{error}</Alert>}
        {!canEdit && (
          <div className="rounded-md border border-border border-l-4 border-l-muted-foreground bg-muted/40 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              You have read-only access to this organisation. Changes cannot be saved.
            </p>
          </div>
        )}
        {saved && (
          <div className="rounded-md border border-border border-l-4 border-l-primary bg-primary/5 px-4 py-2">
            <p className="text-xs text-primary">Saved.</p>
          </div>
        )}
      </div>
      <SurveyEditor
        definition={def}
        published={published}
        saving={saving}
        readOnly={!canEdit}
        onChange={setDef}
        onPublishedChange={setPublished}
        onSave={save}
      />
    </>
  );
}
