import { useState } from 'react';
import { Button } from '../../components/ui/button';
import type { SurveyDefinition } from '../../engine/types';
import InlineListEditor from './InlineListEditor';
import WebhooksSection from './WebhooksSection';
import { saveSchedule, type BuilderSurvey } from '../builderStore';

interface Props {
  survey: BuilderSurvey;
  def: SurveyDefinition;
  readOnly: boolean;
  responseCount: number;
  onChangeDef: (def: SurveyDefinition) => void;
  onSaved: () => void;
  onClose: () => void;
}

/** ISO timestamp -> the "YYYY-MM-DDTHH:mm" string a datetime-local input wants, in the viewer's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/**
 * Survey-level settings. Two kinds, deliberately kept apart because they behave
 * differently:
 *  - Schedule and response limit apply to the live survey the moment they are
 *    saved; they are not part of a published version.
 *  - Hidden fields and save-progress are part of the survey definition, so they
 *    go through the draft and take effect on Publish like any other edit.
 */
export default function SurveySettingsDialog({ survey, def, readOnly, responseCount, onChangeDef, onSaved, onClose }: Props) {
  const [opens, setOpens] = useState(toLocalInput(survey.opens_at));
  const [closes, setCloses] = useState(toLocalInput(survey.closes_at));
  const [limit, setLimit] = useState(survey.max_responses ? String(survey.max_responses) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hidden = (def.hiddenFields ?? []).filter(h => h !== 'quiz_score');
  const scoring = def.scoring;
  // quiz_score is kept in hiddenFields automatically; authors never edit it by hand.
  const withHidden = (items: string[], on: boolean) => {
    const list = [...items.filter(h => h !== 'quiz_score'), ...(on ? ['quiz_score'] : [])];
    return list.length ? list : undefined;
  };
  const setScoring = (next: SurveyDefinition['scoring']) =>
    onChangeDef({ ...def, scoring: next, hiddenFields: withHidden(hidden, !!next?.enabled) });
  const example = `${window.location.origin}/s/${survey.slug}${hidden.length ? `?${hidden.map(h => `${h}=…`).join('&')}` : ''}`;

  const problem = (() => {
    if (opens && closes && new Date(opens) >= new Date(closes)) return 'The closing time must be after the opening time.';
    if (limit !== '' && (!Number.isInteger(Number(limit)) || Number(limit) < 1)) return 'The response limit must be a whole number of 1 or more.';
    if (limit !== '' && Number(limit) <= responseCount && responseCount > 0) {
      return `This survey already has ${responseCount} response${responseCount === 1 ? '' : 's'}, so a limit of ${limit} would close it immediately. Use a higher number, or close the survey instead.`;
    }
    return null;
  })();

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      await saveSchedule(survey.id, {
        opens_at: fromLocalInput(opens), closes_at: fromLocalInput(closes),
        max_responses: limit === '' ? null : Number(limit),
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-4" role="dialog" aria-modal="true" aria-labelledby="ss-title">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 id="ss-title" className="font-display text-lg text-foreground">Survey settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="space-y-7 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-1 text-sm font-medium text-foreground">Schedule and response limit</h3>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Applies immediately, to the live survey. Leave a box empty for no limit. The response limit counts every
              response and is accurate to within a few when many people submit at the same moment.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Opens">
                <input type="datetime-local" disabled={readOnly} value={opens} onChange={e => setOpens(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Closes">
                <input type="datetime-local" disabled={readOnly} value={closes} onChange={e => setCloses(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <div className="mt-3 max-w-[14rem]">
              <Field label="Stop after this many responses">
                <input type="number" min={1} disabled={readOnly} value={limit} onChange={e => setLimit(e.target.value)} placeholder="No limit" className={inputCls} />
              </Field>
            </div>
            {(problem || error) && <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{problem ?? error}</p>}
            {saved && !problem && <p className="mt-3 text-xs text-primary">Saved. The change is live.</p>}
            {!readOnly && (
              <div className="mt-3">
                <Button size="sm" disabled={busy || !!problem} onClick={save}>{busy ? 'Saving…' : 'Save schedule and limit'}</Button>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium text-foreground">Hidden fields</h3>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Values carried in the survey link and stored with each response, without asking the respondent - for example
              which email campaign or region a response came from. List the parameter names here, then add them to your links.
            </p>
            <InlineListEditor
              readOnly={readOnly}
              items={hidden}
              min={0}
              placeholder="parameter_name, e.g. source"
              addLabel="+ Add hidden field"
              onChange={items => onChangeDef({ ...def, hiddenFields: withHidden(items, !!scoring?.enabled) })}
            />
            {hidden.length > 0 && (
              <p className="mt-2 break-all rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">{example}</p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Part of the survey definition: it takes effect when you Publish. A hidden field is stored as text, up to 500 characters.</p>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium text-foreground">Scoring (quiz)</h3>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox" disabled={readOnly} className="mt-0.5 h-4 w-4 accent-primary"
                checked={!!scoring?.enabled}
                onChange={e => setScoring(e.target.checked ? { enabled: true, showResult: true, bands: scoring?.bands } : undefined)}
              />
              <span>
                Score each response
                <span className="block text-[11px] leading-relaxed text-muted-foreground">
                  Give points to answer choices (open a question and set its Points), and the total is stored with each response.
                  Computed in the respondent's browser, so it is fine for a quiz or self-assessment but not tamper-proof.
                </span>
              </span>
            </label>
            {scoring?.enabled && (
              <div className="mt-3 space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox" disabled={readOnly} className="h-3.5 w-3.5 accent-primary" checked={!!scoring.showResult}
                    onChange={e => setScoring({ ...scoring, showResult: e.target.checked })}
                  />
                  Show the respondent their score and result on the thank-you screen
                </label>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground">Result bands</p>
                  <p className="mb-2 text-[11px] text-muted-foreground">A score gets the band with the highest starting score it reaches. You can also put {'{{score}}'}, {'{{maxscore}}'} and {'{{result}}'} in the thank-you message.</p>
                  <div className="space-y-2">
                    {(scoring.bands ?? []).map((b, i) => (
                      <div key={i} className="grid grid-cols-[5rem_1fr_auto] items-start gap-2">
                        <input
                          type="number" step="any" disabled={readOnly} value={Number.isFinite(b.min) ? b.min : ''} aria-label="From score"
                          onChange={e => setScoring({ ...scoring, bands: (scoring.bands ?? []).map((x, n) => (n === i ? { ...x, min: e.target.value === '' ? NaN : Number(e.target.value) } : x)) })}
                          className={inputCls}
                        />
                        <div className="space-y-1.5">
                          <input
                            disabled={readOnly} value={b.label} placeholder="Label, e.g. Expert" aria-label="Band label"
                            onChange={e => setScoring({ ...scoring, bands: (scoring.bands ?? []).map((x, n) => (n === i ? { ...x, label: e.target.value } : x)) })}
                            className={inputCls}
                          />
                          <input
                            disabled={readOnly} value={b.message ?? ''} placeholder="Message (optional)" aria-label="Band message"
                            onChange={e => setScoring({ ...scoring, bands: (scoring.bands ?? []).map((x, n) => (n === i ? { ...x, message: e.target.value || undefined } : x)) })}
                            className={inputCls}
                          />
                        </div>
                        {!readOnly && (
                          <button type="button" aria-label="Remove band" onClick={() => setScoring({ ...scoring, bands: (scoring.bands ?? []).filter((_, n) => n !== i) })}
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {!readOnly && (
                    <button
                      type="button" className="mt-2 rounded border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      onClick={() => setScoring({ ...scoring, bands: [...(scoring.bands ?? []), { min: (scoring.bands ?? []).length === 0 ? 0 : NaN, label: '' }] })}
                    >
                      + Add a band
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">Part of the survey definition: it takes effect when you Publish.</p>
              </div>
            )}
          </section>

          <WebhooksSection surveyId={survey.id} slug={survey.slug} published={survey.published} readOnly={readOnly} />

          <section>
            <h3 className="mb-1 text-sm font-medium text-foreground">Save and continue later</h3>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox" disabled={readOnly} className="mt-0.5 h-4 w-4 accent-primary"
                checked={def.saveProgress !== false}
                onChange={e => onChangeDef({ ...def, saveProgress: e.target.checked ? undefined : false })}
              />
              <span>
                Let respondents leave and finish later
                <span className="block text-[11px] leading-relaxed text-muted-foreground">
                  Progress is kept only in the respondent's own browser, on that device, for 30 days. Nothing is sent to us until they
                  submit, so it never weakens an anonymous survey. Takes effect on Publish.
                </span>
              </span>
            </label>
          </section>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/30 disabled:opacity-60';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
