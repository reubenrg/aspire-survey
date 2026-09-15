import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui/button';

/**
 * Wraps the admin area. Nothing inside renders until Supabase reports a
 * session.
 *
 * This gate is convenience, not the security boundary: anyone can edit what
 * the browser runs. What actually protects the data is row level security on
 * `surveys`, which only accepts writes from an account on the allowlist. A
 * signed-in user who is not an allowlisted admin gets this far and then sees
 * their save rejected, which is the correct place for that to fail.
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return <Centered><p className="text-sm text-muted-foreground">Checking sign-in…</p></Centered>;
  }
  if (!session) return <SignIn />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <a href="/admin" className="font-display text-sm text-foreground">Survey Admin</a>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{session.user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>Sign out</Button>
          </div>
        </div>
      </header>
      {children}
    </div>
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
          A sign-in link is on its way to <strong>{email}</strong>. Open it on this device. The
          link can be used once and expires shortly.
        </p>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 className="mb-2 font-display text-xl text-foreground">Survey Admin</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Sign in with your email. We send a one-time link, so there is no password to remember or
        leak.
      </p>
      <form onSubmit={send} className="space-y-3 text-left">
        <label className="block text-sm font-medium text-foreground" htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          required
          value={email}
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

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  );
}
