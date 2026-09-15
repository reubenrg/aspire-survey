import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import {
  EMPLOYEE_FIELDS, applyMapping, guessMapping, parseCsv, summarizeValidation,
  unsupportedColumns, validateRows,
  type ColumnMapping, type CsvTable, type EmployeeField, type MappedEmployeeRow, type ValidatedRow,
} from './csv';
import { existingEmployeeCodes, importEmployees, type ImportResult } from './employeeStore';

type Stage = 'upload' | 'map' | 'preview' | 'importing' | 'done';

/**
 * Upload → map columns → validate → preview → import. Every stage is visible
 * before anything is written, and nothing here ever overwrites an existing
 * employee - a duplicate code is flagged and skipped, never merged.
 */
export default function CsvImportWizard({
  customerId, onClose, onImported,
}: { customerId: string; onClose: () => void; onImported: () => void }) {
  const [stage, setStage] = useState<Stage>('upload');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) throw new Error('This file has no header row.');
      if (parsed.rows.length === 0) throw new Error('This file has a header row but no data rows.');
      setFileName(file.name);
      setTable(parsed);
      setMapping(guessMapping(parsed.headers));
      setExistingCodes(await existingEmployeeCodes(customerId));
      setStage('map');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const mapped: MappedEmployeeRow[] = useMemo(
    () => (table ? applyMapping(table, mapping) : []),
    [table, mapping],
  );
  const validated: ValidatedRow[] = useMemo(
    () => validateRows(mapped, existingCodes),
    [mapped, existingCodes],
  );
  const summary = useMemo(() => summarizeValidation(validated), [validated]);
  const unsupported = table ? unsupportedColumns(table.headers, mapping) : [];
  const mappingComplete = Boolean(mapping.employee_code && mapping.employee_name);

  const runImport = async () => {
    setStage('importing');
    try {
      const ready = validated.filter(r => r.outcome === 'ready').map(r => r.row);
      const res = await importEmployees(customerId, ready);
      setResult(res);
      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('preview');
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/30 px-6 py-8" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-background p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-foreground">Import employees</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {error && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

        {stage === 'upload' && (
          <div>
            <p className="mb-4 text-sm text-muted-foreground">
              A CSV file with one row per employee. The first row must be column headers.
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center transition-colors hover:bg-muted/40">
              <span className="text-sm font-medium text-foreground">Choose a CSV file</span>
              <span className="mt-1 text-xs text-muted-foreground">or drag it here</span>
              <input
                type="file" accept=".csv,text/csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              />
            </label>
          </div>
        )}

        {stage === 'map' && table && (
          <div>
            <p className="mb-1 text-sm text-foreground">
              <strong>{fileName}</strong> · {table.rows.length} row{table.rows.length === 1 ? '' : 's'}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">Match each field to a column from your file.</p>

            <div className="space-y-2.5">
              {EMPLOYEE_FIELDS.map(({ field, label, required }) => (
                <div key={field} className="flex items-center gap-3">
                  <label className="w-40 shrink-0 text-xs font-medium text-foreground" htmlFor={`map-${field}`}>
                    {label}{required && ' *'}
                  </label>
                  <select
                    id={`map-${field}`}
                    value={mapping[field] ?? ''}
                    onChange={e => setMapping(m => ({ ...m, [field]: e.target.value || undefined }))}
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60"
                  >
                    <option value="">— not mapped —</option>
                    {table.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <SampleTable table={table} mapping={mapping} />

            {unsupported.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Columns not used: {unsupported.join(', ')}
              </p>
            )}

            <div className="mt-5 flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setStage('upload')}>Back</Button>
              <Button type="button" disabled={!mappingComplete} onClick={() => setStage('preview')}>
                Continue
              </Button>
            </div>
            {!mappingComplete && (
              <p className="mt-2 text-right text-[11px] text-muted-foreground">
                Employee code and employee name must both be mapped.
              </p>
            )}
          </div>
        )}

        {stage === 'preview' && (
          <div>
            <p className="mb-3 text-sm text-foreground">Ready to import</p>
            <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border text-center text-sm">
              <div className="bg-background px-3 py-2.5">
                <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">{summary.ready}</p>
                <p className="text-[11px] text-muted-foreground">Ready to import</p>
              </div>
              <div className="bg-background px-3 py-2.5">
                <p className="text-lg font-semibold text-amber-700 dark:text-amber-500 tabular-nums">{summary.needsAttention}</p>
                <p className="text-[11px] text-muted-foreground">Needs attention</p>
              </div>
              <div className="bg-background px-3 py-2.5">
                <p className="text-lg font-semibold text-muted-foreground tabular-nums">{summary.skip}</p>
                <p className="text-[11px] text-muted-foreground">Will be skipped</p>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Row</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Code</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {validated.map(v => (
                    <tr key={v.row.rowNumber} className="border-t border-border/60">
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{v.row.rowNumber}</td>
                      <td className="px-2 py-1.5 font-mono">{v.row.employee_code || '—'}</td>
                      <td className="px-2 py-1.5">{v.row.employee_name || '—'}</td>
                      <td className="px-2 py-1.5">
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          v.outcome === 'ready' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : v.outcome === 'needs_attention' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-500'
                              : 'bg-muted text-muted-foreground',
                        )}>
                          {v.outcome === 'ready' ? 'Ready' : v.outcome === 'needs_attention' ? 'Needs attention' : 'Skipped'}
                        </span>
                        {v.problems.length > 0 && (
                          <span className="ml-1.5 text-muted-foreground">{v.problems.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setStage('map')}>Back</Button>
              <Button type="button" disabled={summary.ready === 0} onClick={runImport}>
                Import {summary.ready} employee{summary.ready === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {stage === 'importing' && <p className="py-8 text-center text-sm text-muted-foreground">Importing…</p>}

        {stage === 'done' && result && (
          <div>
            <p className="mb-1 text-sm text-foreground">
              Imported <strong>{result.imported}</strong> employee{result.imported === 1 ? '' : 's'}.
            </p>
            {result.failed.length > 0 && (
              <>
                <p className="mb-2 mt-3 text-xs font-medium text-destructive">
                  {result.failed.length} row{result.failed.length === 1 ? '' : 's'} could not be imported:
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-xs text-muted-foreground">
                  {result.failed.map(f => (
                    <li key={f.row.rowNumber}>Row {f.row.rowNumber} ({f.row.employee_code || '—'}): {f.message}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-5 flex justify-end">
              <Button type="button" onClick={onImported}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SampleTable({ table, mapping }: { table: CsvTable; mapping: ColumnMapping }) {
  const mappedFields = EMPLOYEE_FIELDS.filter(f => mapping[f.field]);
  if (mappedFields.length === 0) return null;
  const sample = table.rows.slice(0, 3);

  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sample rows</p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>{mappedFields.map(f => <th key={f.field} className="px-2 py-1.5 text-left font-medium text-muted-foreground">{f.label}</th>)}</tr>
          </thead>
          <tbody>
            {sample.map((row, i) => (
              <tr key={i} className="border-t border-border/60">
                {mappedFields.map(f => {
                  const col = mapping[f.field as EmployeeField];
                  const idx = col ? table.headers.indexOf(col) : -1;
                  return <td key={f.field} className="px-2 py-1.5 text-foreground">{idx >= 0 ? row[idx] : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
