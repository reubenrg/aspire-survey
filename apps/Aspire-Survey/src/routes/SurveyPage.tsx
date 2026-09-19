import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import SurveyRenderer from '../engine/SurveyRenderer';
import { fetchAvailability, loadSurvey, recordSurveyStep, submitResponse, SurveyNotFound, type Availability, type SurveyRecord } from '../engine/surveyStore';
import { hiddenFromSearch } from '../engine/progress';
import { UploadContext } from '../engine/uploads';

type State =
  | { status: 'loading' }
  | { status: 'ready'; record: SurveyRecord; availability: Availability }
  | { status: 'missing' }
  | { status: 'error'; message: string };

/** Public route for any survey: /s/:slug */
export default function SurveyPage() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadSurvey(slug)
      .then(async record => {
        const availability = await fetchAvailability(slug);
        if (!cancelled) setState({ status: 'ready', record, availability });
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof SurveyNotFound) setState({ status: 'missing' });
        else setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [slug]);

  if (state.status === 'loading') {
    return <Centered><p className="text-sm text-muted-foreground">Loading…</p></Centered>;
  }

  if (state.status === 'missing') {
    return (
      <Centered>
        <h1 className="text-xl font-display text-foreground mb-2">Survey not available</h1>
        <p className="text-sm text-muted-foreground">
          There is no published survey at this address. Check the link, or ask whoever sent it
          whether it has been published yet.
        </p>
      </Centered>
    );
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <h1 className="text-xl font-display text-foreground mb-2">Could not load this survey</h1>
        <pre className="overflow-auto rounded border-l-4 border-destructive bg-destructive/5 p-3 text-left font-mono text-xs text-destructive">
          {state.message}
        </pre>
      </Centered>
    );
  }

  if (state.record.closedAt || state.availability !== 'open') {
    const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);
    const copy: Record<Availability, [string, string]> = {
      open: ['This survey has closed', 'This survey is not currently accepting responses.'],
      closed: ['This survey has closed', 'This survey is not currently accepting responses.'],
      not_open_yet: ['This survey has not opened yet', when(state.record.opensAt) ? `It opens on ${when(state.record.opensAt)}. Please come back then.` : 'Please come back later.'],
      ended: ['This survey has ended', when(state.record.closesAt) ? `It stopped taking responses on ${when(state.record.closesAt)}.` : 'It is no longer accepting responses.'],
      full: ['This survey is full', 'It has reached its response limit and is no longer accepting responses. Thank you for your interest.'],
    };
    const [title, body] = copy[state.record.closedAt ? 'closed' : state.availability];
    return (
      <Centered>
        <h1 className="text-xl font-display text-foreground mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </Centered>
    );
  }

  return (
    <UploadContext.Provider value={{ slug: state.record.slug }}>
    <SurveyRenderer
      definition={state.record.definition}
      privacyMode={state.record.privacyMode}
      progressKey={`survey:${state.record.slug}:v${state.record.currentVersion}`}
      onStep={step => recordSurveyStep(state.record.slug, step)}
      hiddenValues={hiddenFromSearch(state.record.definition, window.location.search)}
      onSubmit={answers => submitResponse(state.record, answers)}
    />
    </UploadContext.Provider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}
