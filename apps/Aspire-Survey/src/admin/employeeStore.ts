import { supabase } from '../lib/supabase';
import type { MappedEmployeeRow } from './csv';

export interface Employee {
  id: string;
  organization_id: string;
  employee_code: string;
  employee_name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  location: string | null;
  manager_code: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface EmployeeFilters {
  search?: string;
  department?: string;
  location?: string;
  activeOnly?: boolean; // when false, includes inactive too
}

const COLUMNS =
  'id, organization_id, employee_code, employee_name, email, phone, department, designation, location, manager_code, is_active, updated_at';

function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code === '42501') throw new Error(`You do not have permission to ${action}.`);
  throw new Error(error.message || `Could not ${action}.`);
}

/**
 * Filters run in the database (ilike / eq), not after fetching everything, so
 * a large directory never has to travel to the browser just to be searched.
 */
export async function listEmployees(
  organizationId: string, filters: EmployeeFilters = {},
): Promise<Employee[]> {
  let q = supabase.from('employees').select(COLUMNS).eq('organization_id', organizationId);
  if (filters.activeOnly) q = q.eq('is_active', true);
  if (filters.department) q = q.eq('department', filters.department);
  if (filters.location) q = q.eq('location', filters.location);
  if (filters.search?.trim()) {
    const term = filters.search.trim().replace(/[%,]/g, '');
    q = q.or(`employee_name.ilike.%${term}%,employee_code.ilike.%${term}%,email.ilike.%${term}%`);
  }
  const { data, error } = await q.order('employee_name');
  if (error) fail(error, 'view employees');
  return (data ?? []) as Employee[];
}

/** Distinct department/designation/location values, for filter dropdowns. */
export async function listFacets(
  organizationId: string,
): Promise<{ departments: string[]; designations: string[]; locations: string[] }> {
  const { data, error } = await supabase
    .from('employees')
    .select('department, designation, location')
    .eq('organization_id', organizationId);
  if (error) fail(error, 'view employee filters');
  const departments = new Set<string>();
  const designations = new Set<string>();
  const locations = new Set<string>();
  for (const row of (data ?? []) as { department: string | null; designation: string | null; location: string | null }[]) {
    if (row.department) departments.add(row.department);
    if (row.designation) designations.add(row.designation);
    if (row.location) locations.add(row.location);
  }
  return {
    departments: [...departments].sort(),
    designations: [...designations].sort(),
    locations: [...locations].sort(),
  };
}

export interface EmployeeInput {
  employee_code: string;
  employee_name: string;
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  location?: string;
  manager_code?: string;
  is_active: boolean;
}

function translateEmployeeError(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501') return new Error(`You do not have permission to ${action}.`);
  if (error.code === '23505') {
    return new Error('An employee with this code already exists in this workspace.');
  }
  if (error.code === '23514' || error.code === '23502') {
    return new Error('Employee code and name are required.');
  }
  return new Error(error.message || `Could not ${action}.`);
}

export async function createEmployee(organizationId: string, input: EmployeeInput): Promise<Employee> {
  const code = input.employee_code.trim();
  const name = input.employee_name.trim();
  if (!code) throw new Error('Employee code is required.');
  if (!name) throw new Error('Employee name is required.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new Error('That email address does not look right.');
  }

  const { data, error } = await supabase
    .from('employees')
    .insert({
      organization_id: organizationId,
      employee_code: code,
      employee_name: name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      department: input.department?.trim() || null,
      designation: input.designation?.trim() || null,
      location: input.location?.trim() || null,
      manager_code: input.manager_code?.trim() || null,
      is_active: input.is_active,
    })
    .select(COLUMNS)
    .single();
  if (error) throw translateEmployeeError(error, 'add this employee');
  return data as Employee;
}

/**
 * Employee code is fixed after creation: invitations and any collected
 * responses reference the employee by id already, but the code is what a
 * human recognises them by, and quietly changing it under an in-flight
 * audience invites confusion. Everything else may be edited.
 */
export async function updateEmployee(
  id: string,
  patch: Partial<Omit<EmployeeInput, 'employee_code'>>,
): Promise<void> {
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email.trim())) {
    throw new Error('That email address does not look right.');
  }
  const { error } = await supabase
    .from('employees')
    .update({
      ...(patch.employee_name !== undefined ? { employee_name: patch.employee_name.trim() } : {}),
      ...(patch.email !== undefined ? { email: patch.email?.trim() || null } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone?.trim() || null } : {}),
      ...(patch.department !== undefined ? { department: patch.department?.trim() || null } : {}),
      ...(patch.designation !== undefined ? { designation: patch.designation?.trim() || null } : {}),
      ...(patch.location !== undefined ? { location: patch.location?.trim() || null } : {}),
      ...(patch.manager_code !== undefined ? { manager_code: patch.manager_code?.trim() || null } : {}),
      ...(patch.is_active !== undefined ? { is_active: patch.is_active } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw translateEmployeeError(error, 'update this employee');
}

export async function setEmployeeActive(id: string, active: boolean): Promise<void> {
  return updateEmployee(id, { is_active: active });
}

export async function existingEmployeeCodes(organizationId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('employees')
    .select('employee_code')
    .eq('organization_id', organizationId);
  if (error) fail(error, 'check the directory for duplicates');
  return new Set((data ?? []).map(r => (r as { employee_code: string }).employee_code.toLowerCase()));
}

export interface ImportResult {
  imported: number;
  failed: { row: MappedEmployeeRow; message: string }[];
}

/**
 * Inserts only the rows the caller has already decided are ready. One insert
 * per row rather than a single bulk insert, so one bad row (a duplicate that
 * slipped in between validation and import, say) cannot fail the whole batch
 * silently - the caller gets back exactly which rows landed.
 */
export async function importEmployees(
  organizationId: string, rows: MappedEmployeeRow[],
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, failed: [] };
  for (const row of rows) {
    try {
      await createEmployee(organizationId, {
        employee_code: row.employee_code,
        employee_name: row.employee_name,
        email: row.email || undefined,
        department: row.department || undefined,
        designation: row.designation || undefined,
        location: row.location || undefined,
        is_active: true,
      });
      result.imported++;
    } catch (e) {
      result.failed.push({ row, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
