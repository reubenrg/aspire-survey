import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { slugify } from '../adminStore';
import {
  createCustomer, fetchCustomers, fetchSurveySummaries, setCustomerActive, updateCustomer,
  type Customer, type SurveySummary,
} from '../platformStore';
import { useAdminSession } from '../AdminGate';
import {
  AccessDenied, DataTable, EmptyState, ErrorNote, PageHeader, SkeletonRows,
  StatusPill, Td, relativeTime,
} from '../ui';

export default function Customers() {
  const session = useAdminSession();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [surveys, setSurveys] = useState<SurveySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const canManage = session.can(null, 'owner');

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([fetchCustomers(), fetchSurveySummaries()]);
      setCustomers(c); setSurveys(s); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCustomers([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const map: Record<string, { total: number; live: number; responses: number }> = {};
    for (const s of surveys) {
      const k = s.organization_id ?? '__unfiled';
      map[k] ??= { total: 0, live: 0, responses: 0 };
      map[k].total += 1;
      if (s.status === 'LIVE') map[k].live += 1;
      map[k].responses += s.responses;
    }
    return map;
  }, [surveys]);

  const visible = (customers ?? []).filter(c => showInactive || c.is_active);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Each customer is a workspace. Surveys, access and reporting all belong to one."
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
                     className="h-3.5 w-3.5 accent-primary" />
              Show inactive
            </label>
            {canManage && <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>New customer</Button>}
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {dialogOpen && (
        <CustomerDialog
          customer={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={async () => { setDialogOpen(false); await load(); }}
        />
      )}

      {customers === null ? <SkeletonRows rows={4} />
        : visible.length === 0 ? (
          <EmptyState
            title={showInactive ? 'No customers' : 'No active customers'}
            body="A customer is the folder a survey lives in. Create one before building a survey, so its access and reporting are scoped correctly from the start."
            action={canManage ? <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>New customer</Button> : undefined}
          />
        ) : (
          <DataTable head={['Customer', 'Status', 'Surveys', 'Live', 'Responses', 'Updated', '']}>
            {visible.map(c => {
              const k = counts[c.id] ?? { total: 0, live: 0, responses: 0 };
              return (
                <tr key={c.id} className="transition-colors hover:bg-muted/40">
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-6 w-6 shrink-0 rounded"
                        style={{ background: c.brand_color || 'var(--muted, #e5e7eb)' }}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{c.name}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">/{c.slug}</span>
                      </div>
                    </div>
                  </Td>
                  <Td><StatusPill status={c.is_active ? 'ACTIVE' : 'INACTIVE'} /></Td>
                  <Td className="tabular-nums">{k.total}</Td>
                  <Td className="tabular-nums">{k.live}</Td>
                  <Td className="tabular-nums">{k.responses.toLocaleString()}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{relativeTime(c.updated_at)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Link to={`/admin/customers/${c.id}/employees`}><Button variant="ghost" size="sm">Employees</Button></Link>
                      <Link to="/admin/surveys"><Button variant="ghost" size="sm">Surveys</Button></Link>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => { setEditing(c); setDialogOpen(true); }}>Edit</Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={async () => {
                              try { await setCustomerActive(c.id, !c.is_active); await load(); }
                              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                            }}
                          >
                            {c.is_active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        )}

      {!canManage && customers !== null && (
        <div className="mt-6">
          <AccessDenied what="create or change customers" need="owner" />
        </div>
      )}

      <p className="mt-4 max-w-prose text-xs leading-relaxed text-muted-foreground">
        Customers are deactivated rather than deleted. Removing one would sever the link between a
        survey and the responses already collected under it, so that path is deliberately not offered.
      </p>
    </>
  );
}

function CustomerDialog({
  customer, onClose, onSaved,
}: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(customer?.name ?? '');
  const [color, setColor] = useState(customer?.brand_color ?? '#2961B6');
  const [logo, setLogo] = useState(customer?.logo_url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (customer) {
        await updateCustomer(customer.id, {
          name: name.trim(), brand_color: color || null, logo_url: logo.trim() || null,
        });
      } else {
        await createCustomer({ name, brandColor: color, logoUrl: logo.trim() || undefined });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 px-6" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="mb-1 font-display text-lg text-foreground">
          {customer ? `Edit ${customer.name}` : 'New customer'}
        </h2>
        <p className="mb-5 text-sm text-muted-foreground">
          {customer
            ? 'The web address stays the same, so existing survey links keep working.'
            : 'Surveys, team access and reporting are all scoped to this customer.'}
        </p>

        <div className="space-y-4">
          <Field label="Name" hint={!customer && name.trim() ? `Web address: /${slugify(name) || '—'}` : undefined}>
            <input
              autoFocus required value={name} onChange={e => setName(e.target.value)}
              placeholder="S2M Health" className={inputCls}
            />
          </Field>

          <Field label="Brand colour" hint="Used to identify the customer at a glance in lists.">
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                     className="h-9 w-12 cursor-pointer rounded border border-border bg-background" />
              <input value={color} onChange={e => setColor(e.target.value)}
                     className={inputCls + ' font-mono text-xs'} />
            </div>
          </Field>

          <Field label="Logo URL (optional)">
            <input value={logo} onChange={e => setLogo(e.target.value)}
                   placeholder="https://…" className={inputCls} />
          </Field>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : customer ? 'Save changes' : 'Create customer'}</Button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-ring/30';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
