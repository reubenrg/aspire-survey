import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { fetchVersionHistory, type BuilderSurvey, type VersionHistoryEntry } from '../builderStore';
import { relativeTime } from '../ui';

/**
 * Published version, current draft, and history — the existing
 * survey_versions table is the only source; nothing here is invented.
 * Historical entries are shown read-only: there is no action anywhere in
 * this panel that can mutate a past version.
 */
export default function VersionHistoryPanel({
  survey, hasUnpublishedChanges, onClose,
}: { survey: BuilderSurvey; hasUnpublishedChanges: boolean; onClose: () => void }) {
  const [history, setHistory] = useState<VersionHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVersionHistory(survey.id, survey.current_version, survey.published)
      .then(h => { if (!cancelled) setHistory(h); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [survey.id, survey.current_version, survey.published]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-foreground/20" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-display text-sm text-foreground">Version history</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="space-y-2 p-3">
          {hasUnpublishedChanges && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
              <div className="mb-0.5 flex items-center justify-between">
                <span className="text-xs font-medium text-primary">Current draft</span>
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">Unpublished changes</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {survey.draft_updated_by ?? 'Someone'} · last saved {relativeTime(survey.draft_updated_at)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Not visible to respondents until published.</p>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          {history === null && !error && <p className="text-xs text-muted-foreground">Loading…</p>}

          {history?.length === 0 && !hasUnpublishedChanges && (
            <p className="text-xs text-muted-foreground">No versions published yet.</p>
          )}

          {history?.map(v => (
            <div key={v.version_number} className="rounded-md border border-border px-3 py-2.5">
              <div className="mb-0.5 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">v{v.version_number}</span>
                {v.isCurrentlyPublished && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    Published
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {v.created_by ?? 'Unknown editor'} · {relativeTime(v.created_at)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-auto border-t border-border p-3">
          <Button variant="ghost" size="sm" className="w-full" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
