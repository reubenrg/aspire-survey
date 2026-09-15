import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import SurveyRenderer from '../engine/SurveyRenderer';
import { loadSurvey, submitResponse, SurveyNotFound, type SurveyRecord } from '../engine/surveyStore';

type State =
  | { status: 'loading' }
  | { status: 'ready'; record: SurveyRecord }
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
      .then(record => { if (!cancelled) setState({ status: 'ready', record }); })
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

  return (
    <SurveyRenderer
      definition={state.record.definition}
      onSubmit={answers => submitResponse(state.record, answers)}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}
