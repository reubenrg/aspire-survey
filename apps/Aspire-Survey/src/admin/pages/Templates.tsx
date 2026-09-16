import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import {
  duplicateTemplate, fetchTemplates, setTemplateActive, type SurveyTemplate,
} from '../templateStore';
import { matchesTemplateSearch } from '../libraryFilters';
import { LIBRARY_CATEGORIES } from './QuestionLibrary';
import { PRIVACY_MODE_LABEL } from '../labels';
import { DataTable, EmptyState, ErrorNote, FilterSelect, PageHeader, RowMenu, SearchInput, SkeletonRows, Td } from '../ui';

/**
 * A template is a structure only - questions, sections, logic, and a
 * suggested privacy mode. It never holds responses, invitations or any
 * customer-specific data (Part 6), and creating a survey from one is a
 * one-time copy (Part 8/24): nothing links back afterward.
 */
export default function Templates() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SurveyTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [preview, setPreview] = useState<SurveyTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await fetchTemplates(!showInactive);
      setRows(all);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [showInactive]);

  useEffect(() => { void load(); }, [load]);

  const visible = (rows ?? []).filter(t => matchesTemplateSearch(t, { search, category }));

  return (
    <>
      <PageHeader
        title="Survey Templates"
        subtitle={rows === null ? 'Loading…' : `${visible.length} of ${rows.length} template${rows.length === 1 ? '' : 's'}`}
        actions={<Button onClick={() => navigate('/admin/surveys/new?start=template')}>Use a template</Button>}
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search templates…" className="w-56" />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={LIBRARY_CATEGORIES.map(c => ({ value: c, label: c }))} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Show inactive
        </label>
      </div>

      {rows === null ? <SkeletonRows rows={4} /> : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No templates yet' : 'No templates match these filters'}
          body={rows.length === 0 ? 'Templates are built from an existing survey — open one in the Builder and use "Save as Template".' : 'Try a different search term or category.'}
        />
      ) : (
        <DataTable head={['Template', 'Category', 'Default privacy mode', 'Sections', 'Questions', 'Status', '']}>
          {visible.map(t => {
            const questionCount = t.definition.sections.reduce((n, s) => n + s.questions.length, 0);
            return (
              <tr key={t.id} className={`transition-colors hover:bg-muted/40 ${t.is_active ? '' : 'opacity-60'}`}>
                <Td>
                  <span className="block truncate font-medium text-foreground">{t.name}</span>
                  {t.description && <span className="block truncate text-xs text-muted-foreground">{t.description}</span>}
                </Td>
                <Td className="text-muted-foreground">{t.category ?? '—'}</Td>
                <Td className="text-muted-foreground">{PRIVACY_MODE_LABEL[t.default_privacy_mode]}</Td>
                <Td className="tabular-nums">{t.definition.sections.length}</Td>
                <Td className="tabular-nums">{questionCount}</Td>
                <Td>
                  <span className={t.is_active
                    ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400'
                    : 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </span>
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <RowMenu items={[
                      { label: 'Preview structure', onSelect: () => setPreview(t) },
                      { label: 'Use this template', onSelect: () => navigate(`/admin/surveys/new?start=template&template=${t.id}`) },
                      { label: 'Duplicate', onSelect: async () => { try { await duplicateTemplate(t); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } } },
                      {
                        label: t.is_active ? 'Deactivate' : 'Reactivate', destructive: t.is_active,
                        onSelect: async () => { try { await setTemplateActive(t.id, t.organization_id, !t.is_active); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } },
                      },
                    ]} />
                  </div>
                </Td>
              </tr>
            );
          })}
        </DataTable>
      )}

      {preview && <TemplatePreviewDialog template={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function TemplatePreviewDialog({ template, onClose }: { template: SurveyTemplate; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/30 px-6 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">{template.name}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{template.description || 'Structure preview — no responses or customer data are part of a template.'}</p>
        <div className="max-h-96 space-y-4 overflow-y-auto border-t border-border pt-3">
          {template.definition.sections.map(s => (
            <div key={s.id}>
              <p className="text-sm font-medium text-foreground">{s.title}</p>
              <ul className="mt-1 space-y-0.5">
                {s.questions.map(q => <li key={q.id} className="text-xs text-muted-foreground">• {q.label || <em>Untitled</em>}</li>)}
                {s.questions.length === 0 && <li className="text-xs text-muted-foreground">No questions in this section.</li>}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end"><Button variant="ghost" onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}
