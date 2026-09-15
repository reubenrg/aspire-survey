import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { atLeast, fetchRole, type Role } from './adminStore';

interface AdminSession {
  email: string;
  /** Role that applies everywhere, from a membership row with no organization. */
  globalRole: Role | null;
  /** Role for one organization, taking the higher of its own and the global one. */
  roleIn: (organizationId: string | null) => Role | null;
  can: (organizationId: string | null, minimum: Role) => boolean;
  refreshRole: (organizationId: string) => Promise<void>;
}

const AdminSessionContext = createContext<AdminSession | null>(null);

/** Throws outside the gate, which is intentional: nothing should read a role unauthenticated. */
export function useAdminSession(): AdminSession {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error('useAdminSession must be used inside AdminGate.');
  return ctx;
}

/**
 * Wraps the admin area. Nothing inside renders until Supabase reports a session
 * AND that account holds a membership.
 *
 * This gate is convenience, not the security boundary: anyone can edit what the
 * browser runs. What actually protects the data is row level security, which
 * checks the same roles server-side on every read and write. Someone who
 * defeats this screen sees an empty dashboard, because the policies return
 * nothing to them.
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [globalRole, setGlobalRole] = useState<Role | null>(null);
  const [roles, setRoles] = useState<Record<string, Role | null>>({});
  const [roleChecked, setRoleChecked] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Resolve the global role once per sign-in; per-organization roles are fetched
  // on demand and cached, since a person may hold different roles per client.
  useEffect(() => {
    if (!session) { setRoleChecked(false); setGlobalRole(null); setRoles({}); return; }
    let cancelled = false;
    fetchRole(null)
      .then(r => { if (!cancelled) { setGlobalRole(r); setRoleChecked(true); } })
      .catch(e => { if (!cancelled) { setRoleError(e.message); setRoleChecked(true); } });
    return () => { cancelled = true; };
  }, [session]);

  if (!ready) return <Centered><Muted>Checking sign-in…</Muted></Centered>;
  if (!session) return <SignIn />;
  if (!roleChecked) return <Centered><Muted>Checking your access…</Muted></Centered>;

  const email = session.user.email ?? '';

  const value: AdminSession = {
    email,
    globalRole,
    roleIn: orgId => {
      if (orgId === null) return globalRole;
      const own = roles[orgId] ?? null;
      if (own === null) return globalRole;
      if (globalRole === null) return own;
      return atLeast(own, globalRole) ? own : globalRole;
    },
    can: (orgId, minimum) => atLeast(value.roleIn(orgId), minimum),
    refreshRole: async orgId => {
      const r = await fetchRole(orgId);
      setRoles(prev => ({ ...prev, [orgId]: r }));
    },
  };

  return (
    <AdminSessionContext.Provider value={value}>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
            <a href="/admin" className="font-display text-sm text-foreground">Survey Admin</a>
            <div className="flex items-center gap-3">
              {globalRole && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-foreground">
                  {globalRole}
                </span>
              )}
              <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
              <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>Sign out</Button>
            </div>
          </div>
        </header>
        {roleError && (
          <div className="mx-auto max-w-5xl px-6 pt-4">
            <Alert>{roleError}</Alert>
          </div>
        )}
        {children}
      </div>
    </AdminSessionContext.Provider>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setState('sending');
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    });
    if (err) { setError(err.message); setState('idle'); return; }
    setState('sent');
  };

  if (state === 'sent') {
    return (
      <Centered>
        <h1 className="mb-2 font-display text-xl text-foreground">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          A sign-in link is on its way to <strong>{email}</strong>. Open it on this device. The link
          can be used once and expires shortly.
        </p>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 className="mb-2 font-display text-xl text-foreground">Survey Admin</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Sign in with your email. We send a one-time link, so there is no password to remember or leak.
      </p>
      <form onSubmit={send} className="space-y-3 text-left">
        <label className="block text-sm font-medium text-foreground" htmlFor="admin-email">Email</label>
        <input
          id="admin-email" type="email" required value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
    </Centered>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border border-l-4 border-l-destructive bg-destructive/5 px-4 py-3">
      <p className="text-xs text-destructive">{children}</p>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  );
}
