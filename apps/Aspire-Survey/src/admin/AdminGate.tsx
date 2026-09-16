import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';
import { AspireMark } from '../components/AspireMark';
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

  // The browser tab title otherwise falls back to index.html's static
  // <title>, which this one Vite build also serves for the frozen legacy
  // S2M respondent routes - setting it dynamically here, scoped to exactly
  // what AdminGate wraps (every /admin/* route, sign-in screen included),
  // gives Admin the right title without touching that shared default.
  useEffect(() => {
    const previous = document.title;
    document.title = 'Aspire Surveys';
    return () => { document.title = previous; };
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
      {roleError && (
        <div className="mx-auto max-w-5xl px-6 pt-4"><Alert>{roleError}</Alert></div>
      )}
      {children}
    </AdminSessionContext.Provider>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

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

  // Same one-time code that the emailed link already carries - Supabase issues
  // both from a single signInWithOtp call. Typing it in works across devices
  // (request on a phone, enter on a desktop) and for anyone who finds clicking
  // a link in their mail client awkward - screen-reader users in particular,
  // since a short numeric field reads and fills far more predictably than a
  // hidden magic-link href. Supabase's email OTP length is configurable
  // between 6 and 10 digits, so the field enforces that range (a submit
  // below 6 digits is disabled) without asserting an exact length anywhere
  // in the copy.
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(null);
    setVerifying(true);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setVerifying(false);
    if (err) { setCodeError(err.message); return; }
    // No further action needed: verifyOtp sets the session on success, and
    // AdminGate's onAuthStateChange listener picks it up and re-renders past
    // this screen automatically.
  };

  if (state === 'sent') {
    return (
      <Centered>
        <AspireMark className="mx-auto mb-4 h-10 w-10 text-primary" />
        <h1 className="mb-2 font-display text-xl text-foreground">Check your email</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          We sent a sign-in link and a one-time code to <strong>{email}</strong>. Click the link on
          this device, or enter the code below — either one signs you in. Both expire shortly and
          work once.
        </p>
        <form onSubmit={verify} className="space-y-3 text-left">
          <label className="block text-sm font-medium text-foreground" htmlFor="admin-otp">Verification code</label>
          <input
            id="admin-otp" type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]*" maxLength={10} required value={code}
            onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Code from your email"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30"
          />
          {codeError && <p className="text-xs text-destructive">{codeError}</p>}
          <Button type="submit" className="w-full" disabled={verifying || code.length < 6}>
            {verifying ? 'Verifying…' : 'Verify code'}
          </Button>
        </form>
      </Centered>
    );
  }

  return (
    <Centered>
      <AspireMark className="mx-auto mb-4 h-10 w-10 text-primary" />
      <h1 className="mb-2 font-display text-xl text-foreground">Aspire Surveys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Sign in with your email. We send a one-time link and a verification code, so there is no
        password to remember or leak.
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
          {state === 'sending' ? 'Sending…' : 'Send OTP'}
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
