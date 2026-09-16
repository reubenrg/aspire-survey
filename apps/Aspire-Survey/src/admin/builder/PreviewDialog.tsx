import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import SurveyRenderer from '../../engine/SurveyRenderer';
import type { SurveyDefinition } from '../../engine/types';
import { usesInvitationLinks, type PrivacyMode } from '../labels';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const WIDTH: Record<Viewport, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

/**
 * An accurate respondent preview of the current draft: the real
 * SurveyRenderer, not a second implementation, wrapped so it can never
 * create a response. onSubmit resolves without writing anything anywhere,
 * and there is no privacy_mode / token in scope here at all to accidentally
 * wire up - a preview submission has no destination by construction.
 */
export default function PreviewDialog({
  definition, privacyMode, onClose,
}: { definition: SurveyDefinition; privacyMode: PrivacyMode; onClose: () => void }) {
  const [viewport, setViewport] = useState<Viewport>('desktop');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-foreground/40" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 bg-foreground px-4 py-2 text-background">
        <div className="flex items-center gap-3">
          <span className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black">
            Preview mode
          </span>
          <span className="text-xs text-background/70">Nothing you submit here is saved.</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-background/30">
            {(['desktop', 'tablet', 'mobile'] as Viewport[]).map(v => (
              <button
                key={v} type="button" onClick={() => setViewport(v)}
                className={cn(
                  'px-2.5 py-1 text-[11px] capitalize transition-colors',
                  viewport === v ? 'bg-background text-foreground' : 'text-background/80 hover:bg-background/10',
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="border-background/30 bg-transparent text-background hover:bg-background/10" onClick={onClose}>
            Close preview
          </Button>
        </div>
      </div>

      {usesInvitationLinks(privacyMode) && (
        <div className="bg-amber-500/10 px-4 py-1.5 text-center text-[11px] text-amber-800 dark:text-amber-400">
          This preview does not simulate an employee invitation. No invitation link is generated or consumed.
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-6">
        <div className="mx-auto overflow-hidden rounded-lg border border-border bg-background shadow-xl transition-[max-width]" style={{ maxWidth: WIDTH[viewport] }}>
          {/* The real renderer, so nothing here can drift from what a respondent actually
              sees - including its own thank-you step, which fires with no response ever
              written: onSubmit simply resolves and creates nothing. */}
          <SurveyRenderer
            key={JSON.stringify(definition)}
            definition={definition}
            onSubmit={async () => { /* preview only: intentionally a no-op */ }}
          />
        </div>
      </div>
    </div>
  );
}
