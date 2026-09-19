import { supabase } from '../lib/supabase';
import { recordAudit } from './reportStore';
import { toCsv } from './csvExport';
import { toDomainError, rpcErrorFrom, NotAuthorised } from './domainError';

export { NotAuthorised };

function translate(error: { code?: string; message: string }, action: string): Error {
  return toDomainError(error, action);
}

/** Every RPC here returns {error: '...'} on the failure paths a database function can reach; this turns those into the same exceptions a REST-level failure would throw. */
function raiseIfError(payload: { error?: string } | null | undefined, action: string): void {
  const err = rpcErrorFrom(payload?.error, {
    not_authorised: `You do not have permission to ${action}.`,
    not_found: 'This survey could not be found.',
    no_table: 'This survey has no response table yet.',
  });
  if (err) throw err;
}

// ── Overview (Part 5) ────────────────────────────────────────────────────

export interface AnalyticsOverview {
  responses: number;
  first_response: string | null;
  latest_response: string | null;
  privacy_mode: 'ANONYMOUS' | 'ANONYMOUS_TRACKED' | 'CONFIDENTIAL';
  audience: number | null;
  completed: number | null;
  completion_rate: number | null; // null when not meaningful (ANONYMOUS)
}

export async function fetchOverview(slug: string, version?: number): Promise<AnalyticsOverview> {
  const { data, error } = await supabase.rpc('survey_analytics_overview', { p_slug: slug, p_version: version ?? null });
  if (error) throw translate(error, 'view analytics');
  raiseIfError(data, 'view analytics');
  return data as AnalyticsOverview;
}

// ── Raw responses (Parts 3-4) ────────────────────────────────────────────

export interface ResponsePage {
  rows: Record<string, unknown>[];
  total: number;
  identityIncluded: boolean;
  timestampsCoarsened: boolean;
}

export interface ResponseFilters {
  search?: string;
  version?: number;
  dateFrom?: string;
  dateTo?: string;
}

export async function fetchResponsePage(
  slug: string, limit: number, offset: number, filters: ResponseFilters = {},
): Promise<ResponsePage> {
  const { data, error } = await supabase.rpc('survey_response_page', {
    p_slug: slug, p_limit: limit, p_offset: offset,
    p_search: filters.search || null, p_version: filters.version ?? null,
    p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
  });
  if (error) throw translate(error, 'view responses');
  raiseIfError(data, 'view responses');
  const d = data as { rows: Record<string, unknown>[]; total: number; identity_included: boolean; timestamps_coarsened: boolean };
  return { rows: d.rows, total: d.total, identityIncluded: d.identity_included, timestampsCoarsened: d.timestamps_coarsened };
}

export async function fetchResponseOne(slug: string, id: string): Promise<{ row: Record<string, unknown>; identityIncluded: boolean }> {
  const { data, error } = await supabase.rpc('survey_response_one', { p_slug: slug, p_id: id });
  if (error) throw translate(error, 'view this response');
  raiseIfError(data, 'view this response');
  const d = data as { row: Record<string, unknown>; identity_included: boolean };
  return { row: d.row, identityIncluded: d.identity_included };
}

// ── Question analysis (Part 6) ───────────────────────────────────────────

export interface ChoiceDistribution { column: string; value: string; n: number; pct: number }

export async function fetchColumnsDistribution(slug: string, columns: string[], version?: number): Promise<ChoiceDistribution[]> {
  if (columns.length === 0) return [];
  const { data, error } = await supabase.rpc('survey_columns_distribution', { p_slug: slug, p_columns: columns, p_version: version ?? null });
  if (error) throw translate(error, 'view question analysis');
  return ((data ?? []) as { column_name: string; value: string; n: number; pct: number }[])
    .map(r => ({ column: r.column_name, value: r.value, n: r.n, pct: Number(r.pct) }));
}

export interface MultiselectDistribution { value: string; n: number; pctOfRespondents: number; respondents: number }

export async function fetchMultiselectDistribution(slug: string, column: string, version?: number): Promise<MultiselectDistribution[]> {
  const { data, error } = await supabase.rpc('survey_multiselect_distribution', { p_slug: slug, p_column: column, p_version: version ?? null });
  if (error) throw translate(error, 'view question analysis');
  return ((data ?? []) as { value: string; n: number; pct_of_respondents: number; respondents: number }[])
    .map(r => ({ value: r.value, n: r.n, pctOfRespondents: Number(r.pct_of_respondents), respondents: r.respondents }));
}

export async function fetchTextCount(slug: string, column: string, version?: number): Promise<number> {
  const { data, error } = await supabase.rpc('survey_text_count', { p_slug: slug, p_column: column, p_version: version ?? null });
  if (error) throw translate(error, 'view question analysis');
  return Number(data ?? 0);
}

// ── Trend (Part 7) ───────────────────────────────────────────────────────

export interface TrendPoint { bucketStart: string; n: number }

export async function fetchTrend(slug: string, version?: number): Promise<TrendPoint[]> {
  const { data, error } = await supabase.rpc('survey_response_trend', { p_slug: slug, p_version: version ?? null });
  if (error) throw translate(error, 'view the response trend');
  return ((data ?? []) as { bucket_start: string; n: number }[]).map(r => ({ bucketStart: r.bucket_start, n: r.n }));
}

// ── Segmentation with confidentiality threshold (Parts 8-11) ────────────

export type SegmentDimension = 'department' | 'location' | 'designation';

export interface SegmentGroup { value: string; n: number }
export interface SegmentSummary {
  applicable: boolean;
  reason?: string;
  groupBy: SegmentDimension | null;
  threshold?: number;
  groups?: SegmentGroup[];
  suppressedGroups?: number;
  suppressedResponses?: number;
  count?: number | null;
  suppressed?: boolean;
}

export async function fetchSegmentSummary(
  slug: string,
  opts: { groupBy?: SegmentDimension; department?: string; location?: string; designation?: string; version?: number } = {},
): Promise<SegmentSummary> {
  const { data, error } = await supabase.rpc('survey_segment_summary', {
    p_slug: slug, p_group_by: opts.groupBy ?? null,
    p_department: opts.department || null, p_location: opts.location || null, p_designation: opts.designation || null,
    p_version: opts.version ?? null,
  });
  if (error) throw translate(error, 'view segment breakdown');
  raiseIfError(data, 'view segment breakdown');
  const d = data as {
    applicable: boolean; reason?: string; group_by: SegmentDimension | null; threshold?: number;
    groups?: SegmentGroup[]; suppressed_groups?: number; suppressed_responses?: number;
    count?: number | null; suppressed?: boolean;
  };
  return {
    applicable: d.applicable, reason: d.reason, groupBy: d.group_by, threshold: d.threshold,
    groups: d.groups, suppressedGroups: d.suppressed_groups, suppressedResponses: d.suppressed_responses,
    count: d.count, suppressed: d.suppressed,
  };
}

// ── CSV export with audit (Parts 15-16) ──────────────────────────────────

const EXPORT_PAGE_SIZE = 500;
const EXPORT_MAX_ROWS = 20000; // matches the database function's own defensive cap

/**
 * Exports through survey_response_page in batches - real database paging
 * even for a "give me everything matching these filters" export (Part 24:
 * never download the whole table just to compute something client-side).
 * Identity is included or not by the exact same permission check the raw
 * table view uses; there is no separate "identified export" toggle to get
 * wrong, because the row-shaping decision is made once, in the function.
 */
export async function exportResponsesCsv(
  slug: string, organizationId: string | null, filters: ResponseFilters = {},
): Promise<{ csv: string; rows: number; identityIncluded: boolean }> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let identityIncluded = false;
  for (;;) {
    const page = await fetchResponsePage(slug, EXPORT_PAGE_SIZE, offset, filters);
    identityIncluded = page.identityIncluded;
    all.push(...page.rows);
    offset += EXPORT_PAGE_SIZE;
    if (all.length >= page.total || page.rows.length === 0 || all.length >= EXPORT_MAX_ROWS) break;
  }

  // The audit event records that an export happened, by whom, of what shape -
  // never the response contents themselves (Part 16).
  await recordAudit(organizationId, 'DATA_EXPORTED', {
    survey: slug, format: 'csv', rows: all.length,
    identity_included: identityIncluded,
    export_type: identityIncluded ? 'identified' : 'de-identified',
  });

  return { csv: toCsv(all), rows: all.length, identityIncluded };
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

// ── Numeric, ranking and cross-tab analysis (analytics v2) ───────────────

export interface NumericSummary {
  column: string; n: number; mean: number; median: number; min: number; max: number; stddev: number;
}

export async function fetchNumericSummary(slug: string, columns: string[], version?: number): Promise<NumericSummary[]> {
  if (columns.length === 0) return [];
  const { data, error } = await supabase.rpc('survey_numeric_summary', { p_slug: slug, p_columns: columns, p_version: version ?? null });
  if (error) throw translate(error, 'view question analysis');
  return ((data ?? []) as { column_name: string; n: number; mean: number; median: number; min_value: number; max_value: number; stddev: number }[])
    .map(r => ({
      column: r.column_name, n: Number(r.n), mean: Number(r.mean), median: Number(r.median),
      min: Number(r.min_value), max: Number(r.max_value), stddev: Number(r.stddev),
    }));
}

export interface RankingSummaryRow { value: string; respondents: number; avgPosition: number; firstChoice: number }

export async function fetchRankingSummary(slug: string, column: string, version?: number): Promise<RankingSummaryRow[]> {
  const { data, error } = await supabase.rpc('survey_ranking_summary', { p_slug: slug, p_column: column, p_version: version ?? null });
  if (error) throw translate(error, 'view question analysis');
  return ((data ?? []) as { value: string; respondents: number; avg_position: number; first_choice: number }[])
    .map(r => ({ value: r.value, respondents: Number(r.respondents), avgPosition: Number(r.avg_position), firstChoice: Number(r.first_choice) }));
}

export interface CrosstabCell { row: string; col: string; n: number }
export interface Crosstab {
  threshold: number;
  cells: CrosstabCell[];
  suppressedCells: number;
  suppressedResponses: number | null;
  total: number | null;
}

export async function fetchCrosstab(slug: string, rowColumn: string, colColumn: string, version?: number): Promise<Crosstab> {
  const { data, error } = await supabase.rpc('survey_crosstab', {
    p_slug: slug, p_row: rowColumn, p_col: colColumn, p_version: version ?? null, p_threshold: 5,
  });
  if (error) throw translate(error, 'view the cross-tab');
  const d = data as { error?: string; threshold: number; cells: CrosstabCell[]; suppressed_cells: number; suppressed_responses: number | null; total: number | null };
  if (d?.error === 'invalid_column') throw new Error('Those two questions cannot be compared. Choose two single-answer questions.');
  raiseIfError(d, 'view the cross-tab');
  return {
    threshold: d.threshold, cells: d.cells ?? [], suppressedCells: d.suppressed_cells,
    suppressedResponses: d.suppressed_responses, total: d.total,
  };
}
