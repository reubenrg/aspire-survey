import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { createWebhook, deleteWebhook, fetchDeliveries, listWebhooks, setWebhookActive, testWebhook, type Delivery, type Webhook } from '../webhookStore';
import { relativeTime } from '../ui';

interface Props { surveyId: string; slug: string; published: boolean; readOnly: boolean }

/**
 * Send each new response to another app. Works with Zapier ("Catch Hook"), Make, and
 * Teams / Slack incoming webhooks (choose "chat message"), or any endpoint of your own.
 */
export default function WebhooksSection({ surveyId, slug, published, readOnly }: Props) {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'json' | 'text'>('json');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  const load = useCallback(async () => {
    try { setHooks(await listWebhooks(surveyId)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setHooks([]); }
  }, [surveyId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const showDeliveries = async (id: string) => {
    setOpen(id);
    try { setDeliveries(await fetchDeliveries(id)); } catch { setDeliveries([]); }
  };

  return (
    <section>
      <h3 className="mb-1 text-sm font-medium text-foreground">Send responses to another app</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Each new response is posted to your address within seconds, without ever delaying the respondent. Works with Zapier
        (“Catch Hook”), Make, Microsoft Teams and Slack incoming webhooks, or your own endpoint. Names, employee IDs and
        departments of respondents are never included.
      </p>
      {!published && (
        <p className="mb-3 rounded-md border border-border border-l-4 border-l-amber-500 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          Publish the survey first: webhooks start once its response table exists.
        </p>
      )}

      {secret && (
        <div className="mb-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5" role="status">
          <p className="text-xs font-medium text-foreground">Signing secret - copy it now, it will not be shown again</p>
          <code className="mt-1 block break-all rounded bg-background px-2 py-1 font-mono text-[11px] text-foreground">{secret}</code>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Every request carries <code>X-Aspire-Signature: sha256=…</code>, the HMAC-SHA256 of the raw request body using this secret.
            Verify it if your endpoint needs to be sure a request really came from here.
          </p>
          <button type="button" onClick={() => setSecret(null)} className="mt-1.5 text-xs font-medium text-primary hover:underline">I have copied it</button>
        </div>
      )}

      {hooks === null ? <p className="text-xs text-muted-foreground">Loading…</p> : (
        <ul className="space-y-2">
          {hooks.map(h => (
            <li key={h.id} className="rounded-md border border-border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px] text-foreground">{h.url}</p>
                  <p className="text-[11px] text-muted-foreground">{h.format === 'text' ? 'Chat message' : 'Full JSON'} · {h.is_active ? 'active' : 'paused'} · added {relativeTime(h.created_at)}</p>
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await testWebhook(h.id); await new Promise(r => setTimeout(r, 2500)); await showDeliveries(h.id); })}>Send test</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await setWebhookActive(h.id, !h.is_active); await load(); })}>{h.is_active ? 'Pause' : 'Resume'}</Button>
                    <Button size="sm" variant="ghost" disabled={busy} className="text-destructive hover:text-destructive"
                      onClick={() => { if (confirm('Remove this webhook? Responses will stop being sent to it.')) void run(async () => { await deleteWebhook(h.id); await load(); }); }}>Remove</Button>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => (open === h.id ? setOpen(null) : void showDeliveries(h.id))} className="mt-1 text-[11px] text-muted-foreground hover:text-foreground">
                {open === h.id ? '▾ Hide recent deliveries' : '▸ Recent deliveries'}
              </button>
              {open === h.id && (
                deliveries.length === 0 ? <p className="mt-1 text-[11px] text-muted-foreground">Nothing sent yet.</p> : (
                  <ul className="mt-1 space-y-0.5">
                    {deliveries.map((d, i) => (
                      <li key={i} className="flex justify-between text-[11px] tabular-nums">
                        <span className="text-muted-foreground">{relativeTime(d.at)}{d.is_test ? ' · test' : ''}</span>
                        <span className={d.status && d.status < 300 ? 'text-primary' : d.status === null && !d.error ? 'text-muted-foreground' : 'text-destructive'}>
                          {d.status ? `HTTP ${d.status}` : d.error ? d.error : 'pending…'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </li>
          ))}
          {hooks.length === 0 && <li className="text-xs text-muted-foreground">No webhooks yet.</li>}
        </ul>
      )}

      {!readOnly && (hooks?.length ?? 0) < 5 && (
        <div className="mt-3 space-y-2 rounded-md border border-dashed border-border p-2.5">
          <input
            value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…"
            aria-label="Webhook address"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary/60"
          />
          <div className="flex items-center gap-2">
            <select value={format} onChange={e => setFormat(e.target.value as 'json' | 'text')} aria-label="Format"
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary/60">
              <option value="json">Full JSON (Zapier, Make, custom)</option>
              <option value="text">Chat message (Teams, Slack)</option>
            </select>
            <Button size="sm" disabled={busy || !url.trim() || !published} onClick={() => void run(async () => {
              const r = await createWebhook(slug, url, format);
              setSecret(r.secret); setUrl(''); await load();
            })}>Add webhook</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
