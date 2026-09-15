import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import SurveyRenderer from '../engine/SurveyRenderer';
import {
  resolveInvitation, submitInvitedResponse, type ResolvedInvitation, type SubmitProblem,
} from '../engine/invitationStore';

type State =
  | { status: 'loading' }
  | { status: 'ready'; invitation: ResolvedInvitation }
  | { status: 'submitted' }
  | { status: 'blocked'; message: string }
  | { status: 'error'; message: string };

/**
 * The respondent side of a magic link: /r/:token. Never shows a token,
 * an employee's own name or code, or a raw database error — every dead
 * end here is a plain sentence, because whoever reads it followed a link
 * from an email or message and has no context on what went wrong.
 */
export default function InvitePage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    resolveInvitation(token)
      .then(result => {
        if (cancelled) return;
        if (result.ok) setState({ status: 'ready', invitation: result.invitation });
        else setState({ status: 'blocked', message: blockedMessage(result.reason) });
      })
      .catch(err => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'loading') {
    return <Centered><p className="text-sm text-muted-foreground">Loading…</p></Centered>;
  }

  if (state.status === 'blocked' || state.status === 'submitted') {
    return (
      <Centered>
        <h1 className="mb-2 font-display text-xl text-foreground">
          {state.status === 'submitted' ? 'Thank you' : 'This link cannot be used'}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {state.status === 'submitted'
            ? 'Your response has already been submitted.'
            : state.message}
        </p>
      </Centered>
    );
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <h1 className="mb-2 font-display text-xl text-foreground">Something went wrong</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This survey could not be opened right now. Please try the link again in a moment, or contact
          whoever sent it to you.
        </p>
      </Centered>
    );
  }

  return (
    <SurveyRenderer
      definition={state.invitation.definition}
      onSubmit={async answers => {
        const result = await submitInvitedResponse(token, answers);
        if (result.ok) { setState({ status: 'submitted' }); return; }
        if (result.reason === 'ALREADY_SUBMITTED' || result.reason === 'COMPLETED') {
          setState({ status: 'submitted' });
          return;
        }
        throw new Error(blockedMessage(result.reason));
      }}
    />
  );
}

function blockedMessage(reason: SubmitProblem): string {
  switch (reason) {
    case 'REVOKED':
      return 'This invitation is no longer valid.';
    case 'EXPIRED':
      return 'This invitation has expired. Please contact the survey administrator if you need a new invitation.';
    case 'COMPLETED':
    case 'ALREADY_SUBMITTED':
      return 'Your response has already been submitted.';
    case 'CLOSED':
    case 'UNAVAILABLE':
      return 'This survey is not currently accepting responses.';
    case 'EMPTY':
    case 'NO_TABLE':
      return 'This survey is not set up correctly yet. Please contact whoever sent you this link.';
    case 'INVALID':
    default:
      return 'This invitation link is not valid. Check that you copied the whole link, or ask for a new one.';
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}
