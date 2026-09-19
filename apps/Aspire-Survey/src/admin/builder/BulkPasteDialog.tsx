import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { parseBulkQuestions } from '../../engine/bulkParse';
import { QUESTION_TYPE_LABELS } from '../../engine/questionFactory';
import type { Question, SurveyDefinition } from '../../engine/types';

const EXAMPLE = `How likely are you to shop with us again? *
Extremely likely
Neutral
Not likely
[other] Something else

Which of these do you use? (checkbox)
Email
Chat
Phone

Rate our service
Product
Support
> Excellent
> Average
> Poor

Anything else you would like to tell us?`;

interface Props {
  def: SurveyDefinition;
  sectionIndex: number;
  onAdd: (questions: Question[]) => void;
  onClose: () => void;
}

/**
 * Paste a block of questions from a document and see, live, exactly what will be
 * created before anything is added. The parsing rules live in engine/bulkParse.ts.
 */
export default function BulkPasteDialog({ def, sectionIndex, onAdd, onClose }: Props) {
  const [text, setText] = useState('');
  const section = def.sections[sectionIndex];

  const result = useMemo(() => {
    const existing = new Set(def.sections.flatMap(s => s.questions.map(q => q.id)));
    return parseBulkQuestions(text, { sectionId: section.id, startIndex: section.questions.length, existingIds: existing });
  }, [text, def, section]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-4" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div>
            <h2 id="bulk-title" className="font-display text-lg text-foreground">Paste questions</h2>
            <p className="text-xs text-muted-foreground">Into “{section.title || `Section ${sectionIndex + 1}`}”. One question per block; leave a blank line between blocks.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-2">
          <div className="border-b border-border p-4 md:border-b-0 md:border-r">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste or type your questions here…"
              rows={16}
              autoFocus
              className="h-full min-h-[16rem] w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                Add <code>*</code> for required · <code>(dropdown)</code>, <code>(ranking)</code>, <code>(long)</code>… to force a type ·
                <code> [other]</code> / <code>[na]</code> for extra choices · <code>&gt;</code> lines make a matrix scale
              </span>
              <button type="button" onClick={() => setText(EXAMPLE)} className="shrink-0 font-medium text-primary hover:underline">Use an example</button>
            </div>
          </div>

          <div className="p-4">
            <p className="mb-2 text-xs font-medium text-foreground">
              {result.questions.length === 0 ? 'Preview' : `${result.questions.length} question${result.questions.length === 1 ? '' : 's'} will be added`}
            </p>
            {result.questions.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                Nothing yet. Paste some questions, or try the example.
              </p>
            ) : (
              <ol className="space-y-2">
                {result.questions.map((q, i) => (
                  <li key={q.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-foreground">{i + 1}. {q.label}{q.required && <span className="text-primary"> *</span>}</p>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {QUESTION_TYPE_LABELS[q.type]}
                      </span>
                    </div>
                    {'options' in q && <p className="mt-1 text-[11px] text-muted-foreground">{q.options.join(' · ')}</p>}
                    {q.type === 'matrix' && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{q.rows.length} row{q.rows.length === 1 ? '' : 's'} × {q.scale.join(' · ')}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {result.warnings.length > 0 && (
              <ul className="mt-3 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="rounded border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-500">{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={result.questions.length === 0} onClick={() => { onAdd(result.questions); onClose(); }}>
            Add {result.questions.length || ''} question{result.questions.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>
  );
}
