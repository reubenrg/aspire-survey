import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import { listMembers, addMember, updateMember, setMemberActive, type TeamMember } from '../teamStore';
import { listOrganizations, type Organization } from '../adminStore';
import { atLeast, isOwnerEscalation, type Role } from '../labels';
import { AccessDenied, DataTable, EmptyState, ErrorNote, PageHeader, RolePill, SkeletonRows, Td } from '../ui';

const ROLES: Role[] = ['viewer', 'analyst', 'editor', 'owner'];

const ROLE_EXPLANATION: Record<Role, string> = {
  owner: 'Full platform and workspace administration: manage team, settings, and everything editors/analysts/viewers can.',
  editor: 'Create and manage surveys, employees and audiences in authorised workspaces.',
  analyst: 'Access authorised analytics and reporting. Cannot manage surveys, team or settings.',
  viewer: 'Read-only access where granted.',
};

/**
 * Reflects the actual RBAC model exactly - viewer/analyst/editor/owner, the
 * same four ranks used everywhere else in this system. "Can view identified
 * confidential responses" is shown as its own, separate permission (Part
 * 11): it is not a rank, and granting it never implies a role change.
 */
export default function Team() {
  const session = useAdminSession();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);

  const load = useCallback(async () => {
    try {
      const [ms, os] = await Promise.all([listMembers(), listOrganizations()]);
      setMembers(ms);
      setOrgs(os);
      setError(null);
      setDenied(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission/i.test(msg)) { setDenied(true); return; }
      setError(msg);
      setMembers([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Can the current viewer manage at least one workspace's team? Used to gate the Add button.
  const canManageAny = orgs.some(o => session.can(o.id, 'owner')) || session.can(null, 'owner');

  const orgName = useMemo(() => new Map(orgs.map(o => [o.id, o.name])), [orgs]);

  if (denied) {
    return (
      <>
        <PageHeader title="Team" subtitle="Who has access, and at what level." />
        <AccessDenied what="view or manage team access" need="owner" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={members === null ? 'Loading…' : `${members.length} member${members.length === 1 ? '' : 's'}`}
        actions={canManageAny ? <Button onClick={() => setAddOpen(true)}>Add member</Button> : undefined}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map(r => (
          <div key={r} className="rounded-lg border border-border p-3">
            <RolePill role={r} />
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{ROLE_EXPLANATION[r]}</p>
          </div>
        ))}
      </div>

      {members === null ? <SkeletonRows rows={4} /> : members.length === 0 ? (
        <EmptyState title="No team members yet" body="Add the first member to a workspace to get started." />
      ) : (
        <DataTable head={['Email', 'Role', 'Workspace', 'Identity permission', 'Status', '']}>
          {members.map(m => {
            const canManage = session.can(m.organization_id, 'owner');
            return (
              <tr key={m.id} className={`transition-colors hover:bg-muted/40 ${m.is_active ? '' : 'opacity-60'}`}>
                <Td className="font-medium text-foreground">{m.email}</Td>
                <Td><RolePill role={m.role} /></Td>
                <Td className="text-muted-foreground">{m.organization_id ? (m.organization_name ?? orgName.get(m.organization_id) ?? '—') : 'All workspaces (global)'}</Td>
                <Td>
                  {m.can_view_identity
                    ? <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-400">Can view identified responses</span>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </Td>
                <Td>
                  <span className={m.is_active
                    ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400'
                    : 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'}>
                    {m.is_active ? 'Active' : 'Deactivated'}
                  </span>
                </Td>
                <Td>
                  {canManage && m.email.toLowerCase() !== session.email.toLowerCase() && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>Edit</Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={async () => {
                          try { await setMemberActive(m.id, !m.is_active); await load(); }
                          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                        }}
                      >
                        {m.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  )}
                  {m.email.toLowerCase() === session.email.toLowerCase() && (
                    <span className="text-[11px] text-muted-foreground">This is you</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </DataTable>
      )}

      {addOpen && (
        <AddMemberDialog orgs={orgs} session={session}
          onClose={() => setAddOpen(false)}
          onAdded={async () => { setAddOpen(false); await load(); }}
        />
      )}
      {editing && (
        <EditMemberDialog member={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </>
  );
}

function AddMemberDialog({
  orgs, session, onClose, onAdded,
}: { orgs: Organization[]; session: ReturnType<typeof useAdminSession>; onClose: () => void; onAdded: () => void }) {
  const manageable = orgs.filter(o => session.can(o.id, 'owner'));
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState<string>(manageable[0]?.id ?? '');
  const [role, setRole] = useState<Role>('viewer');
  const [canViewIdentity, setCanViewIdentity] = useState(false);
  const [confirmOwner, setConfirmOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('An email address is required.'); return; }
    if (role === 'owner' && !confirmOwner) { setError('Confirm that this person should have full Owner access before adding them.'); return; }
    setBusy(true); setError(null);
    try {
      await addMember(email.trim(), orgId || null, role, canViewIdentity);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Add team member</h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          This creates the membership record and its permissions. It does not send an email invitation —
          share access with them directly for now.
        </p>

        <div className="space-y-3">
          <Field label="Email"><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputCls} /></Field>
          {session.can(null, 'owner') && (
            <Field label="Workspace" hint="Leave as global to grant access across every workspace.">
              <select value={orgId} onChange={e => setOrgId(e.target.value)} className={inputCls}>
                <option value="">Global (all workspaces)</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Role">
            <select value={role} onChange={e => { setRole(e.target.value as Role); setConfirmOwner(false); }} className={inputCls}>
              {ROLES.map(r => <option key={r} value={r}>{r === 'owner' ? 'owner — Full platform administration' : r}</option>)}
            </select>
          </Field>
          {role === 'owner' && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-300">Owner — Full platform administration</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-400">
                Owner can manage team membership, roles, and platform settings across every workspace this covers. Only grant it to someone who should have that level of control.
              </p>
              <label className="mt-2 flex items-start gap-2 text-[11px] font-medium text-amber-800 dark:text-amber-400">
                <input type="checkbox" checked={confirmOwner} onChange={e => setConfirmOwner(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-amber-600" />
                I understand this grants full Owner access.
              </label>
            </div>
          )}
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input type="checkbox" checked={canViewIdentity} onChange={e => setCanViewIdentity(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
            Can view identified responses on Confidential surveys
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || (role === 'owner' && !confirmOwner)}>{busy ? 'Adding…' : 'Add member'}</Button>
        </div>
      </form>
    </div>
  );
}

function EditMemberDialog({
  member, onClose, onSaved,
}: { member: TeamMember; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<Role>(member.role);
  const [canViewIdentity, setCanViewIdentity] = useState(member.can_view_identity);
  const [confirmOwner, setConfirmOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const escalatingToOwner = isOwnerEscalation(member.role, role);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (escalatingToOwner && !confirmOwner) { setError('Confirm that this person should have full Owner access before saving.'); return; }
    setBusy(true); setError(null);
    try {
      await updateMember(member.id, { role, canViewIdentity });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Edit {member.email}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{member.organization_id ? member.organization_name : 'Global access'}</p>

        <div className="space-y-3">
          <Field label="Role">
            <select value={role} onChange={e => setRole(e.target.value as Role)} className={inputCls}>
              {ROLES.map(r => <option key={r} value={r}>{r === 'owner' ? 'owner — Full platform administration' : r}</option>)}
            </select>
            {!atLeast(role, 'analyst') && member.role !== role && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-500">This lowers their access.</p>
            )}
          </Field>
          {escalatingToOwner && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-300">Owner — Full platform administration</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-400">
                Owner can manage team membership, roles, and platform settings across every workspace this covers.
              </p>
              <label className="mt-2 flex items-start gap-2 text-[11px] font-medium text-amber-800 dark:text-amber-400">
                <input type="checkbox" checked={confirmOwner} onChange={e => setConfirmOwner(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-amber-600" />
                I understand this grants full Owner access.
              </label>
            </div>
          )}
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input type="checkbox" checked={canViewIdentity} onChange={e => setCanViewIdentity(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
            Can view identified responses on Confidential surveys
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || (escalatingToOwner && !confirmOwner)}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </form>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
