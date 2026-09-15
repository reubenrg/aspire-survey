/**
 * CSV parsing and validation for the employee import wizard.
 *
 * Hand-rolled rather than a dependency, in the same spirit as the CSV writer
 * in reportStore.ts: the format needed (quoted fields, embedded commas,
 * escaped quotes, CRLF or LF) is small and worth owning outright, especially
 * since validation - not parsing - is where the real work is.
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** Parses RFC4180-ish CSV: quoted fields, "" as an escaped quote, CRLF or LF. */
export function parseCsv(text: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Strip a leading BOM, which Excel likes to add.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { pushField(); continue; }
    if (c === '\r') continue;
    if (c === '\n') { pushRow(); continue; }
    field += c;
  }
  // Final field/row, unless the file ended cleanly on a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  const nonEmpty = rows.filter(r => !(r.length === 1 && r[0] === ''));
  const [headers = [], ...body] = nonEmpty;
  return { headers: headers.map(h => h.trim()), rows: body };
}

// ── Column mapping ───────────────────────────────────────────────────────

export type EmployeeField =
  | 'employee_code' | 'employee_name' | 'email' | 'department' | 'designation' | 'location';

export const EMPLOYEE_FIELDS: { field: EmployeeField; label: string; required: boolean }[] = [
  { field: 'employee_code', label: 'Employee code', required: true },
  { field: 'employee_name', label: 'Employee name', required: true },
  { field: 'email', label: 'Email', required: false },
  { field: 'department', label: 'Department', required: false },
  { field: 'designation', label: 'Designation', required: false },
  { field: 'location', label: 'Location', required: false },
];

/** Column mapping: target employee field -> source CSV header, or '' for unmapped. */
export type ColumnMapping = Partial<Record<EmployeeField, string>>;

/** Best-effort guess so most files need no manual mapping at all. */
export function guessMapping(headers: string[]): ColumnMapping {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
  const synonyms: Record<EmployeeField, string[]> = {
    employee_code: ['employeecode', 'empcode', 'code', 'id', 'employeeid'],
    employee_name: ['employeename', 'name', 'fullname'],
    email: ['email', 'emailaddress', 'workemail'],
    department: ['department', 'dept'],
    designation: ['designation', 'title', 'role', 'jobtitle'],
    location: ['location', 'site', 'office', 'city'],
  };
  const mapping: ColumnMapping = {};
  for (const { field } of EMPLOYEE_FIELDS) {
    const match = headers.find(h => synonyms[field].includes(norm(h)));
    if (match) mapping[field] = match;
  }
  return mapping;
}

export interface MappedEmployeeRow {
  rowNumber: number; // 1-based, counting the header as row 0 (so row 1 = first data row)
  employee_code: string;
  employee_name: string;
  email: string;
  department: string;
  designation: string;
  location: string;
}

export function applyMapping(table: CsvTable, mapping: ColumnMapping): MappedEmployeeRow[] {
  const index = (field: EmployeeField): number => {
    const h = mapping[field];
    return h ? table.headers.indexOf(h) : -1;
  };
  const idx: Record<EmployeeField, number> = {
    employee_code: index('employee_code'),
    employee_name: index('employee_name'),
    email: index('email'),
    department: index('department'),
    designation: index('designation'),
    location: index('location'),
  };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  return table.rows.map((r, i) => ({
    rowNumber: i + 1,
    employee_code: cell(r, idx.employee_code),
    employee_name: cell(r, idx.employee_name),
    email: cell(r, idx.email),
    department: cell(r, idx.department),
    designation: cell(r, idx.designation),
    location: cell(r, idx.location),
  }));
}

// ── Validation ───────────────────────────────────────────────────────────

export type RowOutcome = 'ready' | 'needs_attention' | 'skip';

export interface ValidatedRow {
  row: MappedEmployeeRow;
  outcome: RowOutcome;
  problems: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isBlankRow(row: MappedEmployeeRow): boolean {
  return !row.employee_code && !row.employee_name && !row.email
    && !row.department && !row.designation && !row.location;
}

/**
 * Validates a mapped batch against itself and against the directory already
 * on file. Never mutates anything - existing employees are matched only to
 * flag them, so an import can never silently overwrite a record.
 */
export function validateRows(
  rows: MappedEmployeeRow[],
  existingCodes: Set<string>, // lower-cased employee_code already in this workspace
): ValidatedRow[] {
  const seenInFile = new Map<string, number>(); // lower code -> first row number

  return rows.map(row => {
    const problems: string[] = [];

    if (isBlankRow(row)) {
      return { row, outcome: 'skip' as const, problems: ['Blank row'] };
    }

    if (!row.employee_code) problems.push('Missing employee code');
    if (!row.employee_name) problems.push('Missing employee name');
    if (row.email && !EMAIL_RE.test(row.email)) problems.push('Email looks malformed');

    const code = row.employee_code.toLowerCase();
    if (code) {
      const firstRow = seenInFile.get(code);
      if (firstRow !== undefined) {
        problems.push(`Duplicate employee code in this file (also row ${firstRow})`);
      } else {
        seenInFile.set(code, row.rowNumber);
      }
      if (existingCodes.has(code)) {
        problems.push('Employee code already exists in the directory');
      }
    }

    if (problems.length === 0) return { row, outcome: 'ready' as const, problems };

    // A duplicate or missing identity can't be safely imported at all; anything
    // else (a bad email, say) is worth a human's attention but not fatal.
    const fatal = problems.some(p =>
      p.startsWith('Missing') || p.includes('Duplicate') || p.includes('already exists'));
    return { row, outcome: (fatal ? 'skip' : 'needs_attention') as RowOutcome, problems };
  });
}

export function unsupportedColumns(headers: string[], mapping: ColumnMapping): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return headers.filter(h => !mapped.has(h));
}

export function summarizeValidation(rows: ValidatedRow[]) {
  return {
    ready: rows.filter(r => r.outcome === 'ready').length,
    needsAttention: rows.filter(r => r.outcome === 'needs_attention').length,
    skip: rows.filter(r => r.outcome === 'skip').length,
  };
}
