import { useEffect, useState } from 'react';
import { useAdminSession } from './AdminGate';
import { listOrganizations, type Organization } from './adminStore';

/**
 * Every organization the caller can at least see, with roles pre-fetched so
 * `session.can(orgId, …)` is answerable synchronously right after loading.
 * Shared by any screen that needs to pick a customer.
 */
export function useOrganizations() {
  const session = useAdminSession();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgs = await listOrganizations();
        if (cancelled) return;
        setOrganizations(orgs);
        await Promise.all(orgs.map(o => session.refreshRole(o.id)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { organizations, loading, error };
}
