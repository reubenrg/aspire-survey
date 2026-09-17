import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAdminSession } from '../AdminGate';
import { listOrganizations, type Organization } from '../adminStore';
import {
  createEmployee, listEmployees, listFacets, setEmployeeActive, updateEmployee,
  type Employee, type EmployeeInput,
} from '../employeeStore';
import CsvImportWizard from '../CsvImportWizard';
import {
  AccessDenied, DataTable, EmptyState, ErrorNote, FilterSelect, PageHeader,
  SearchInput, SkeletonRows, Td,
} from '../ui';

export default function CustomerEmployees() {
  const { customerId = '' } = useParams();
  const session = useAdminSession();
  const [org, setOrg] = useState<Organization | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [facets, setFacets] = useState<{ departments: string[]; designations: string[]; locations: string[] }>({ departments: [], designations: [], locations: [] });
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const canManage = session.can(customerId, 'editor');

  const load = useCallback(async () => {
    try {
      const [orgs, rows, f] = await Promise.all([
        listOrganizations(), listEmployees(customerId, {
          search, department, location, activeOnly: !showInactive,
        }), listFacets(customerId),
      ]);
      setOrg(orgs.find(o => o.id === customerId) ?? null);
      setEmployees(rows);
      setFacets(f);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEmployees([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, search, department, location, showInactive]);

  useEffect(() => { void session.refreshRole(customerId).then(load); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const activeCount = useMemo(() => (employees ?? []).filter(e => e.is_active).length, [employees]);

  return (
    <>
      <PageHeader
        title={org ? `${org.name} — Employees` : 'Employees'}
        subtitle={employees === null ? 'Loading…' : `${activeCount} active · ${employees.length} shown`}
        actions={canManage ? (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>Import employees</Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>Add employee</Button>
          </>
        ) : undefined}
      />

      {org && (
        <Link to="/admin/customers" className="mb-4 inline-block text-xs text-primary hover:underline">← All customers</Link>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, code or email…" className="w-64" />
        <FilterSelect label="Department" value={department} onChange={setDepartment}
                      options={facets.departments.map(d => ({ value: d, label: d }))} />
        <FilterSelect label="Location" value={location} onChange={setLocation}
                      options={facets.locations.map(l => ({ value: l, label: l }))} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Show inactive
        </label>
      </div>

      {employees === null ? <SkeletonRows rows={5} /> : employees.length === 0 ? (
        <EmptyState
          title={search || department || location ? 'No employees match these filters' : 'No employees yet'}
          body={search || department || location
            ? 'Try a different search term or clear the filters above.'
            : 'Add employees one at a time, or import a whole list from a CSV file.'}
          action={canManage && !(search || department || location)
            ? <Button size="sm" onClick={() => setImportOpen(true)}>Import employees</Button> : undefined}
        />
      ) : (
        <DataTable head={['Employee code', 'Name', 'Email', 'Department', 'Designation', 'Location', 'Status', '']}>
          {employees.map(e => (
            <tr key={e.id} className={`transition-colors hover:bg-muted/40 ${e.is_active ? '' : 'opacity-60'}`}>
              <Td className="font-mono text-xs">{e.employee_code}</Td>
              <Td className="font-medium text-foreground">{e.employee_name}</Td>
              <Td className="text-muted-foreground">{e.email ?? '—'}</Td>
              <Td className="text-muted-foreground">{e.department ?? '—'}</Td>
              <Td className="text-muted-foreground">{e.designation ?? '—'}</Td>
              <Td className="text-muted-foreground">{e.location ?? '—'}</Td>
              <Td>
                <span className={e.is_active
                  ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400'
                  : 'rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'}>
                  {e.is_active ? 'Active' : 'Inactive'}
                </span>
              </Td>
              <Td>
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(e); setDialogOpen(true); }}>Edit</Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={async () => {
                        try { await setEmployeeActive(e.id, customerId, !e.is_active); await load(); }
                        catch (err) { setError(err instanceof Error ? err.message : String(err)); }
                      }}
                    >
                      {e.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      {!canManage && employees !== null && employees.length > 0 && (
        <div className="mt-6"><AccessDenied what="add or change employees" need="editor" /></div>
      )}

      {dialogOpen && (
        <EmployeeDialog
          customerId={customerId}
          employee={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={async () => { setDialogOpen(false); await load(); }}
        />
      )}

      {importOpen && (
        <CsvImportWizard
          customerId={customerId}
          onClose={() => setImportOpen(false)}
          onImported={async () => { setImportOpen(false); await load(); }}
        />
      )}
    </>
  );
}

function EmployeeDialog({
  customerId, employee, onClose, onSaved,
}: { customerId: string; employee: Employee | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EmployeeInput>({
    employee_code: employee?.employee_code ?? '',
    employee_name: employee?.employee_name ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    department: employee?.department ?? '',
    designation: employee?.designation ?? '',
    location: employee?.location ?? '',
    manager_code: employee?.manager_code ?? '',
    is_active: employee?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (employee) await updateEmployee(employee.id, customerId, form);
      else await createEmployee(customerId, form);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const field = (key: keyof EmployeeInput, label: string, required = false, type = 'text') => (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor={`emp-${key}`}>
        {label}{required && ' *'}
      </label>
      <input
        id={`emp-${key}`} type={type} required={required}
        value={String(form[key] ?? '')}
        disabled={key === 'employee_code' && employee !== null}
        onChange={ev => setForm(f => ({ ...f, [key]: ev.target.value }))}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/30 px-6 py-8" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">{employee ? `Edit ${employee.employee_name}` : 'Add employee'}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {employee ? 'The employee code stays fixed once created.' : 'This employee is added to this customer only.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {field('employee_code', 'Employee code', true)}
          {field('employee_name', 'Employee name', true)}
          {field('email', 'Email', false, 'email')}
          {field('phone', 'Phone')}
          {field('department', 'Department')}
          {field('designation', 'Designation')}
          {field('location', 'Location')}
          {field('manager_code', "Manager's employee code")}
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="h-3.5 w-3.5 accent-primary" />
          Active
        </label>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : employee ? 'Save changes' : 'Add employee'}</Button>
        </div>
      </form>
    </div>
  );
}
