import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import type { SurveyDefinition } from '../../engine/types';
import { fetchAudienceSummary } from '../audienceStore';
import { PRIVACY_MODE_LABEL, usesInvitationLinks, type PrivacyMode } from '../labels';
import type { BuilderIssue } from '../builderValidation';

interface Props {
  surveyId: string;
  surveyTitle: string;
  customerName: string;
  privacyMode: PrivacyMode;
  nextVersion: number;
  definition: SurveyDefinition;
  blockingIssues: BuilderIssue[];
  busy: boolean;
  onCancel: () => void;
  onPublish: () => void;
}

/**
 * The deliberate publish step (Sprint 3 Part 11 / Sprint 2B Part 19): shows
 * exactly what is about to go live before it does, and refuses to let
 * Publish be clicked while a blocking validation issue exists.
 */
export default function PublishDialog({
  surveyId, surveyTitle, customerName, privacyMode, nextVersion, definition,
  blockingIssues, busy, onCancel, onPublish,
}: Props) {
  const [audience, setAudience] = useState<number | null>(null);

  useEffect(() => {
    if (!usesInvitationLinks(privacyMode)) return;
    let cancelled = false;
    fetchAudienceSummary(surveyId).then(s => { if (!cancelled) setAudience(s.audience); }).catch(() => { if (!cancelled) setAudience(null); });
    return () => { cancelled = true; };
  }, [surveyId, privacyMode]);

  const questions = definition.sections.flatMap(s => s.questions);
  const required = questions.filter(q => q.required).length;
  const canPublish = blockingIssues.length === 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">Publish “{surveyTitle}”</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          This makes the current draft the version respondents see.
        </p>

        <dl className="mb-4 space-y-1.5 text-sm">
          <Row label="Customer" value={customerName} />
          <Row label="Privacy mode" value={PRIVACY_MODE_LABEL[privacyMode]} />
          <Row label="Version" value={`v${nextVersion}`} />
          <Row label="Sections" value={String(definition.sections.length)} />
          <Row label="Questions" value={String(questions.length)} />
          <Row label="Required questions" value={String(required)} />
          {usesInvitationLinks(privacyMode) && (
            <Row label="Audience" value={audience === null ? 'loading…' : `${audience} invited`} />
          )}
        </dl>

        {blockingIssues.length > 0 && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-destructive">
              Can't publish yet — {blockingIssues.length} issue{blockingIssues.length === 1 ? '' : 's'} to fix:
            </p>
            <ul className="space-y-1">
              {blockingIssues.slice(0, 5).map((issue, i) => (
                <li key={i} className="text-xs text-destructive">{issue.message}</li>
              ))}
              {blockingIssues.length > 5 && (
                <li className="text-xs text-destructive">…and {blockingIssues.length - 5} more.</li>
              )}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" disabled={!canPublish || busy} onClick={onPublish}>
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
