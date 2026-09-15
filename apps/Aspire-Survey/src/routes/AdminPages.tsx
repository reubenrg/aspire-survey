import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import SurveyEditor from '../admin/SurveyEditor';
import { deleteSurvey, getSurvey, listSurveys, saveSurvey, type SurveyRow } from '../admin/adminStore';
import type { SurveyDefinition } from '../engine/types';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

function blankSurvey(title: string): SurveyDefinition {
  return {
    slug: slugify(title) || 'untitled-survey',
    title,
    welcome: { heading: title, body: ['Thank you for taking part.'], startLabel: 'Begin Survey' },
    thankYou: { heading: 'Thank You!', body: 'Your response has been recorded.' },
    uniqueBy: 'employeeId',
    sections: [{
      id: 'about',
      title: 'About You',
      questions: [{ id: 'employeeId', type: 'text', label: 'Employee ID', required: true }],
    }],
  };
}

export function AdminList() {
  const [rows, setRows] = useState<SurveyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    listSurveys().then(setRows).catch(e => setError(e.message));
  }, []);

  const create = async () => {
    const def = blankSurvey(title.trim() || 'Untitled survey');
    try {
      await saveSurvey(def, false);
      navigate(`/admin/${def.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-1 font-display text-2xl text-foreground">Surveys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Each survey has its own URL and its own response table.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') create(); }}
          placeholder="New survey name"
          className="min-w-56 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
        <Button onClick={create}>Create survey</Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border-l-4 border-l-destructive border border-border bg-destructive/5 px-4 py-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-muted-foreground">No surveys yet.</p>}

      <div className="space-y-2">
        {rows?.map(row => (
          <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                <span className={row.published
                  ? 'rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary'
                  : 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'}>
                  {row.published ? 'Published' : 'Draft'}
                </span>
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                /s/{row.slug} → {row.table_name}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {row.published && (
                <a href={`/s/${row.slug}`} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm">Open</Button>
                </a>
              )}
              <Link to={`/admin/${row.slug}`}><Button variant="outline" size="sm">Edit</Button></Link>
              <Button
                variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                onClick={async () => {
                  if (!confirm(`Delete "${row.title}"?\n\nThis removes the survey definition. Its response table and any answers already collected are left untouched.`)) return;
                  await deleteSurvey(row.slug);
                  setRows(rs => rs?.filter(r => r.id !== row.id) ?? null);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminEditor() {
  const { slug = '' } = useParams();
  const [def, setDef] = useState<SurveyDefinition | null>(null);
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSurvey(slug)
      .then(row => {
        if (!row) { setError(`No survey called "${slug}".`); return; }
        setDef(row.definition);
        setPublished(row.published);
      })
      .catch(e => setError(e.message));
  }, [slug]);

  const save = async () => {
    if (!def) return;
    setSaving(true); setError(null);
    try {
      await saveSurvey(def, published);
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
        <p className="text-sm text-destructive">{error}</p>
        <Link to="/admin" className="mt-3 inline-block text-sm text-primary underline">Back to surveys</Link>
      </div>
    );
  }
  if (!def) return <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      {error && (
        <div className="mx-auto max-w-5xl px-6 pt-4">
          <div className="rounded-md border-l-4 border-l-destructive border border-border bg-destructive/5 px-4 py-3">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        </div>
      )}
      {saved && (
        <div className="mx-auto max-w-5xl px-6 pt-4">
          <div className="rounded-md border-l-4 border-l-primary border border-border bg-primary/5 px-4 py-2">
            <p className="text-xs text-primary">Saved.</p>
          </div>
        </div>
      )}
      <SurveyEditor
        definition={def}
        published={published}
        saving={saving}
        onChange={setDef}
        onPublishedChange={setPublished}
        onSave={save}
      />
    </>
  );
}
