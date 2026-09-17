import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SurveyRenderer from '../engine/SurveyRenderer';
import type { SurveyDefinition, Answers } from '../engine/types';
import type { EnginePrivacyMode } from '../engine/privacyNotices';

type State =
  | { status: 'loading' }
  | { status: 'ready'; definition: SurveyDefinition; privacyMode: EnginePrivacyMode }
  | { status: 'submitted' }
  | { status: 'blocked'; message: string }
  | { status: 'error'; message: string };

/**
 * The test-send path: /t/:token. Structurally separate from /r/:token - this
 * resolves and submits against survey_campaign_test_sends only, a table with
 * no foreign key to employees or survey_invitations, so nothing here can
 * touch a real employee's invitation state or write to a survey's real
 * response table. See resolve_test_send()/submit_test_response() and the
 * spec's test-send isolation requirement.
 */
export default function TestInvitePage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const { data, error } = await supabase.rpc('resolve_test_send', { p_token: token });
        if (cancelled) return;
        if (error) { setState({ status: 'error', message: error.message }); return; }
        const r = data as { valid: boolean; reason?: string; definition?: SurveyDefinition; privacy_mode?: EnginePrivacyMode };
        if (!r.valid) { setState({ status: 'blocked', message: blockedMessage(r.reason) }); return; }
        setState({ status: 'ready', definition: r.definition!, privacyMode: r.privacy_mode! });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return <Centered><p className="text-sm text-muted-foreground">Loading…</p></Centered>;
  }

  if (state.status === 'blocked' || state.status === 'submitted') {
    return (
      <Centered>
        <TestBanner />
        <h1 className="mb-2 font-display text-xl text-foreground">
          {state.status === 'submitted' ? 'Test complete' : 'This test link cannot be used'}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {state.status === 'submitted'
            ? 'This confirms the completion experience. No response was recorded - test sends never create real survey data.'
            : state.message}
        </p>
      </Centered>
    );
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <TestBanner />
        <h1 className="mb-2 font-display text-xl text-foreground">Something went wrong</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">This test link could not be opened right now.</p>
      </Centered>
    );
  }

  return (
    <div>
      <TestBannerBar />
      <SurveyRenderer
        definition={state.definition}
        privacyMode={state.privacyMode}
        onSubmit={async (_answers: Answers) => {
          const { data, error } = await supabase.rpc('submit_test_response', { p_token: token });
          if (error) throw new Error(error.message);
          const r = data as { ok: boolean; reason?: string };
          if (!r.ok) throw new Error(blockedMessage(r.reason));
          setState({ status: 'submitted' });
        }}
      />
    </div>
  );
}

function blockedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'COMPLETED':
    case 'ALREADY_SUBMITTED':
      return 'This test has already been completed. Send another test email for a fresh one.';
    case 'UNAVAILABLE':
      return 'This survey is not available right now.';
    case 'INVALID':
    default:
      return 'This test link is not valid.';
  }
}

function TestBannerBar() {
  return (
    <div className="sticky top-0 z-40 bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-amber-950">
      Test email — nothing here is recorded as a real response
    </div>
  );
}

function TestBanner() {
  return (
    <span className="mx-auto mb-4 block w-fit rounded bg-amber-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
      Test
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}
