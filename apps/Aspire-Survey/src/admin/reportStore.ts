import { supabase } from '../lib/supabase';
import { toCsv } from './csvExport';
import { toDomainError, rpcErrorFrom } from './domainError';

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
  if (error) throw toDomainError(error, 'load this report');
  if (!data) return null;
  const stats = data as ReportStats;
  const err = rpcErrorFrom(stats.error, {
    not_authorised: 'You need the analyst role or higher to see results for this survey.',
    no_table: 'This survey has no response table yet. Run its generated SQL first.',
  });
  if (err) throw err;
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
  if (error) throw toDomainError(error, 'read the audit log', { '42501': 'Only an owner can read the audit log.' });
  return (data ?? []) as AuditEntry[];
}

export interface AuditFilters {
  organizationId?: string;
  userEmail?: string;
  actionType?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Real database paging (Part 16) for the Activity screen: never fetches the
 * whole table, and the same owner-only RLS as fetchAuditLog decides what a
 * given caller can even see, so a workspace-scoped owner naturally gets
 * only their own organization's rows.
 */
export async function fetchAuditPage(
  filters: AuditFilters, limit: number, offset: number,
): Promise<{ rows: AuditEntry[]; total: number }> {
  let q = supabase
    .from('audit_logs')
    .select('id, user_email, action_type, details, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (filters.organizationId) q = q.eq('organization_id', filters.organizationId);
  if (filters.userEmail) q = q.ilike('user_email', `%${filters.userEmail}%`);
  if (filters.actionType) q = q.eq('action_type', filters.actionType);
  if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);
  if (filters.dateTo) q = q.lte('created_at', filters.dateTo);
  const { data, error, count } = await q;
  if (error) throw toDomainError(error, 'read the audit log', { '42501': 'Only an owner can read the audit log.' });
  return { rows: (data ?? []) as AuditEntry[], total: count ?? 0 };
}

/** Matches this table's declared column grants: authenticated can never select these, so they'd never appear in `data` below - listed only so coarsening/redaction code has one place to point at. */
const IDENTITY_COLUMNS = ['employee_id', 'resp_department', 'resp_location', 'resp_designation'];

/** Same defensive cap analyticsStore.ts's paginated export already uses, applied here too now that this path pulls in one shot rather than paging. */
const EXPORT_ROW_CAP = 20000;

/**
 * Pull response rows and hand back a CSV.
 *
 * Reads the table directly (via the column grant, not a security-definer
 * function), so it succeeds only for analyst and above; a viewer gets a
 * permission error from Postgres rather than an empty file that looks like
 * "no responses yet". Column grants already exclude employee_id/
 * resp_department/resp_location/resp_designation for every privacy mode, so
 * a raw select can't surface those - but the table itself always stores
 * `submitted_at` at full precision, and only survey_response_page()/_one()
 * apply the hour-coarsening ANONYMOUS_TRACKED promises. Reproduced here so
 * this export path can't quietly undercut that guarantee. The audit entry
 * is written before the download starts, so a failed write stops the
 * export rather than leaving an unrecorded one.
 */
export async function exportResponsesCsv(
  slug: string,
  tableName: string,
  organizationId: string | null,
  privacyMode: 'ANONYMOUS' | 'ANONYMOUS_TRACKED' | 'CONFIDENTIAL',
): Promise<{ csv: string; rows: number }> {
  const { data, error } = await supabase.from(tableName).select('*').order('submitted_at').limit(EXPORT_ROW_CAP);
  if (error) {
    throw toDomainError(error, 'export responses', { '42501': 'You need the analyst role or higher to export responses.' });
  }

  let rows = (data ?? []) as Record<string, unknown>[];
  if (privacyMode === 'ANONYMOUS_TRACKED') {
    rows = rows.map(r => {
      const submittedAt = r.submitted_at;
      if (typeof submittedAt !== 'string') return r;
      const d = new Date(submittedAt);
      d.setUTCMinutes(0, 0, 0);
      return { ...r, submitted_at: d.toISOString() };
    });
  }
  // Defense in depth: strip these even though the grant already excludes
  // them from `data`, so this function is safe on its own terms too.
  rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !IDENTITY_COLUMNS.includes(k))));

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
    throw toDomainError(error, 'close this survey', { '42501': 'You need the editor role or higher to close a survey.' });
  }
  await recordAudit(organizationId, closed ? 'SURVEY_CLOSED' : 'SURVEY_REOPENED', { survey: slug });
}
