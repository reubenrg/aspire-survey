import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { supabase } from '../../lib/supabase';
import { parseBulkQuestions } from '../../engine/bulkParse';
import { extractJsonObject, sanitizeGeneratedDefinition } from '../../engine/aiDefinition';
import { QUESTION_TYPE_LABELS } from '../../engine/questionFactory';
import { validateSurveyStructure } from '../builderValidation';
import type { SurveyDefinition } from '../../engine/types';

const AI_ERRORS: Record<string, string> = {
  AI_NOT_CONFIGURED: 'AI drafting is not switched on yet. An administrator needs to add the ANTHROPIC_API_KEY secret to the generate-survey function in Supabase.',
  AI_KEY_REJECTED: 'The AI key was rejected. An administrator needs to check the ANTHROPIC_API_KEY secret.',
  AI_UNAVAILABLE: 'The AI service could not be reached. Please try again in a moment.',
  RATE_LIMITED: 'You have reached the limit of 20 AI drafts per hour. Try again later, or build the survey by hand.',
  PROMPT_TOO_SHORT: 'Describe the survey in a little more detail (at least a sentence).',
  PROMPT_TOO_LONG: 'Please keep the description under 2000 characters.',
  NOT_AUTHORISED: 'Only editors can draft surveys with AI.',
  NOT_SIGNED_IN: 'Please sign in again.',
};

interface Props {
  mode: 'paste' | 'ai';
  definition: SurveyDefinition | null;
  onDefinition: (def: SurveyDefinition | null) => void;
}

/**
 * The two "draft it for me" starting points: paste questions from a document, or
 * describe the survey and let AI draft it. Either way the result is shown for review,
 * validated exactly like a hand-built survey, and can be edited freely afterwards.
 */
export default function GeneratedStart({ mode, definition, onDefinition }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);

  const issues = useMemo(() => (definition ? validateSurveyStructure(definition) : []), [definition]);
  const errors = issues.filter(i => i.severity === 'error');

  const fromPaste = (value: string) => {
    setText(value);
    const { questions, warnings } = parseBulkQuestions(value, { sectionId: 'questions', startIndex: 0 });
    setDropped(warnings);
    if (questions.length === 0) { onDefinition(null); return; }
    onDefinition({
      slug: 'pasted-survey', title: 'Untitled survey',
      welcome: { heading: 'Welcome', body: ['Thank you for taking part.'], startLabel: 'Begin Survey' },
      thankYou: { heading: 'Thank you', body: 'Your response has been recorded.' },
      sections: [{ id: 'questions', title: 'Questions', questions }],
    });
  };

  const generate = async () => {
    setBusy(true); setError(null); setDropped([]); onDefinition(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-survey', { body: { prompt: text } });
      if (fnError) {
        let code = '';
        try { code = ((await (fnError as { context?: Response }).context?.json()) as { error?: string })?.error ?? ''; } catch { /* no body */ }
        throw new Error(AI_ERRORS[code] ?? 'The AI could not draft a survey just now. Please try again.');
      }
      const raw = extractJsonObject(String((data as { text?: string })?.text ?? ''));
      const result = sanitizeGeneratedDefinition(raw);
      if ('error' in result) throw new Error(result.error);
      setDropped(result.dropped);
      onDefinition(result.definition);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const count = definition ? definition.sections.reduce((n, s) => n + s.questions.length, 0) : 0;

  return (
    <div className="mt-4 space-y-3">
      {mode === 'paste' ? (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            One question per block, a blank line between blocks, answer choices on the lines beneath. End a question with <code>*</code> to make it
            required, or with <code>(dropdown)</code>, <code>(ranking)</code>, <code>(long)</code> and so on to force a type.
          </p>
          <textarea
            value={text} onChange={e => fromPaste(e.target.value)} rows={10} aria-label="Questions"
            placeholder={'How satisfied are you with our service? *\nVery satisfied\nSatisfied\nNeutral\nDissatisfied\n\nAnything we could do better?'}
            className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30"
          />
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Describe who the survey is for and what you want to learn. The AI drafts the questions; you review and edit everything before it is
            created. Do not include personal data or anything confidential in the description.
          </p>
          <textarea
            value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={2000} aria-label="Describe the survey"
            placeholder="e.g. A 5-minute pulse survey for warehouse staff about safety culture and management support, with a way for people to raise concerns."
            className="w-full rounded-md border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30"
          />
          <div className="flex items-center gap-3">
            <Button type="button" disabled={busy || text.trim().length < 10} onClick={() => void generate()}>{busy ? 'Drafting…' : definition ? 'Draft again' : 'Draft the survey'}</Button>
            <span className="text-[11px] text-muted-foreground">{text.length} / 2000</span>
          </div>
        </>
      )}

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

      {definition && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-foreground">{definition.title !== 'Untitled survey' ? definition.title : 'Preview'}</p>
            <p className="text-[11px] text-muted-foreground">{count} question{count === 1 ? '' : 's'} in {definition.sections.length} section{definition.sections.length === 1 ? '' : 's'}. You can change all of it in the Builder.</p>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto px-3 py-2.5">
            {definition.sections.map(s => (
              <div key={s.id}>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.title}</p>
                <ol className="mt-1 space-y-1">
                  {s.questions.map(q => (
                    <li key={q.id} className="flex items-start justify-between gap-2 text-sm text-foreground">
                      <span>{q.label}{q.required && <span className="text-primary"> *</span>}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{QUESTION_TYPE_LABELS[q.type]}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}

      {dropped.length > 0 && (
        <ul className="space-y-1">
          {dropped.map((d, i) => (
            <li key={i} className="rounded border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-500">Left out or adjusted: {d}</li>
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <ul className="space-y-1">
          {errors.map((e, i) => <li key={i} className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">{e.message}</li>)}
        </ul>
      )}
    </div>
  );
}
