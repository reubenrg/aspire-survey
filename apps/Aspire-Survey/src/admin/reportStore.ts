import { supabase } from '../lib/supabase';

export interface ReportStats {
  total: number;
  first_at: string | null;
  last_at: string | null;
  by_version: Record<string, number>;
  by_day: { day: string; n: number }[];
  error?: string;
}

export interface ReportColumn {
  question_id: string;
  label: string;
  column_name: string;
  question_type: string;
  chartable: boolean;
}

export interface Breakdown {
  value: string;
  n: number;
}

export interface AuditEntry {
  id: string;
  user_email: string;
  action_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export async function fetchStats(slug: string): Promise<ReportStats | null> {
  const { data, error } = await supabase.rpc('survey_report_stats', { p_slug: slug });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const stats = data as ReportStats;
  if (stats.error === 'not_authorised') {
    throw new Error('You need the analyst role or higher to see results for this survey.');
  }
  if (stats.error === 'no_table') {
    throw new Error('This survey has no response table yet. Run its generated SQL first.');
  }
  return stats;
}

export async function fetchReportColumns(slug: string): Promise<ReportColumn[]> {
  const { data, error } = await supabase.rpc('survey_report_columns', { p_slug: slug });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportColumn[];
}

export async function fetchBreakdown(slug: string, column: string): Promise<Breakdown[]> {
  const { data, error } = await supabase.rpc('survey_report_breakdown', {
    p_slug: slug, p_column: column,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Breakdown[];
}

/**
 * Write an audit entry. Identity comes from the JWT inside the function, so the
 * caller cannot attribute an action to somebody else, and there is no insert
 * grant on the table, so this is the only way in.
 *
 * Nothing about this is automatic. There is no trigger: a browser export is
 * invisible to the database, so the log entry has to be written deliberately by
 * whatever performs the export.
 */
export async function recordAudit(
  organizationId: string | null,
  actionType: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.rpc('record_audit', {
    p_organization_id: organizationId,
    p_action_type: actionType,
    p_details: details,
  });
  if (error) throw new Error(error.message);
}

export async function fetchAuditLog(organizationId: string | null, limit = 100): Promise<AuditEntry[]> {
  let q = supabase
    .from('audit_logs')
    .select('id, user_email, action_type, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (organizationId) q = q.eq('organization_id', organizationId);
  const { data, error } = await q;
  if (error) {
    if (error.code === '42501') throw new Error('Only an owner can read the audit log.');
    throw new Error(error.message);
  }
  return (data ?? []) as AuditEntry[];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map(h => csvCell(row[h])).join(','));
  // \r\n so the file opens cleanly in Excel, which is where these end up.
  return lines.join('\r\n');
}

/**
 * Pull every response row and hand back a CSV.
 *
 * Reads the table directly, so it succeeds only for analyst and above; a viewer
 * gets a permission error from Postgres rather than an empty file that looks
 * like "no responses yet". The audit entry is written before the download
 * starts, so a failed write stops the export rather than leaving an
 * unrecorded one.
 */
export async function exportResponsesCsv(
  slug: string,
  tableName: string,
  organizationId: string | null,
): Promise<{ csv: string; rows: number }> {
  const { data, error } = await supabase.from(tableName).select('*').order('submitted_at');
  if (error) {
    if (error.code === '42501') {
      throw new Error('You need the analyst role or higher to export responses.');
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  await recordAudit(organizationId, 'DATA_EXPORTED', {
    survey: slug,
    table: tableName,
    rows: rows.length,
    format: 'csv',
  });

  return { csv: toCsv(rows), rows: rows.length };
}

export function downloadFile(filename: string, contents: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Toggle a survey between open and closed, recording it. */
export async function setClosed(
  slug: string, organizationId: string | null, closed: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('surveys')
    .update({ closed_at: closed ? new Date().toISOString() : null })
    .eq('slug', slug);
  if (error) {
    if (error.code === '42501') throw new Error('You need the editor role or higher to close a survey.');
    throw new Error(error.message);
  }
  await recordAudit(organizationId, closed ? 'SURVEY_CLOSED' : 'SURVEY_REOPENED', { survey: slug });
}
