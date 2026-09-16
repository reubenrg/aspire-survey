import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SurveyEditor from '../admin/SurveyEditor';
import { Alert, useAdminSession } from '../admin/AdminGate';
import { countResponses, getSurvey, saveSurvey, type SurveyRow } from '../admin/adminStore';
import type { SurveyDefinition } from '../engine/types';

/**
 * The question-by-question builder, reached from the Survey Management table
 * or the survey detail hub (Edit survey). The Surveys list itself, customer
 * folders and survey creation moved to the Sprint 2B screens at /admin/surveys
 * and /admin/surveys/new; this file now holds only the builder.
 */
export function AdminEditor() {
  const { slug = '' } = useParams();
  const session = useAdminSession();
  const [row, setRow] = useState<SurveyRow | null>(null);
  const [def, setDef] = useState<SurveyDefinition | null>(null);
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The definition responses were collected under. Compared against edits so a
  // change that would strand stored answers is caught before it is saved.
  const [baseline, setBaseline] = useState<SurveyDefinition | null>(null);
  const [responseCount, setResponseCount] = useState<number | null>(null);

  useEffect(() => {
    getSurvey(slug)
      .then(async found => {
        if (!found) { setError(`No survey called "${slug}".`); return; }
        setRow(found);
        setDef(found.definition);
        setBaseline(found.definition);
        setPublished(found.published);
        if (found.organization_id) await session.refreshRole(found.organization_id);
        setResponseCount(await countResponses(found.slug));
      })
      .catch(e => setError(e.message));
  }, [slug, session]);

  const canEdit = session.can(row?.organization_id ?? null, 'editor');

  const save = async () => {
    if (!def) return;
    setSaving(true); setError(null);
    try {
      const version = await saveSurvey(def, published, row?.organization_id ?? null, {
        surveyId: row?.id,
        previous: baseline ?? undefined,
        currentVersion: row?.current_version,
      });
      // The saved definition becomes the new baseline, so the guard measures
      // the next edit against what is actually stored rather than the original.
      setBaseline(def);
      setRow(r => (r ? { ...r, current_version: version, definition: def } : r));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error && !def) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Alert>{error}</Alert>
        <Link to="/admin/surveys" className="mt-3 inline-block text-sm text-primary underline">Back to surveys</Link>
      </div>
    );
  }
  if (!def) return <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-3 px-6 pt-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Link to={`/admin/surveys/${slug}`} className="text-primary hover:underline">← Survey overview</Link>
          <Link to={`/admin/${slug}/report`} className="text-primary hover:underline">View results and export →</Link>
        </div>
        {error && <Alert>{error}</Alert>}
        {!canEdit && (
          <div className="rounded-md border border-border border-l-4 border-l-muted-foreground bg-muted/40 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              You have read-only access to this organisation. Changes cannot be saved.
            </p>
          </div>
        )}
        {saved && (
          <div className="rounded-md border border-border border-l-4 border-l-primary bg-primary/5 px-4 py-2">
            <p className="text-xs text-primary">Saved.</p>
          </div>
        )}
      </div>
      <SurveyEditor
        definition={def}
        published={published}
        saving={saving}
        readOnly={!canEdit}
        baseline={baseline ?? undefined}
        responseCount={responseCount}
        currentVersion={row?.current_version}
        privacyMode={row?.privacy_mode}
        onChange={setDef}
        onPublishedChange={setPublished}
        onSave={save}
      />
    </>
  );
}
