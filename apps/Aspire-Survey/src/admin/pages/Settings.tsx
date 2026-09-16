import { useCallback, useEffect, useState } from 'react';
import { useAdminSession } from '../AdminGate';
import { fetchSettings, updateSetting, CONFIDENTIALITY_THRESHOLD_FLOOR, type PlatformSettings } from '../settingsStore';
import { isSupabaseConfigured } from '../../lib/supabase';
import { LIBRARY_CATEGORIES } from './QuestionLibrary';
import { AccessDenied, ErrorNote, PageHeader, Skeleton } from '../ui';
import { Button } from '../../components/ui/button';

/**
 * Read-only diagnostics for authentication (Part 18): whether Supabase is
 * configured at all, and that magic-link sign-in is the method - never a
 * secret, SMTP password or API key, which this screen has no access to and
 * would never show even if it did.
 */
export default function Settings() {
  const session = useAdminSession();
  const canEdit = session.can(null, 'owner');

  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await fetchSettings());
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission/i.test(msg)) { setDenied(true); return; }
      setError(msg);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (denied) {
    return (
      <>
        <PageHeader title="Settings" subtitle="Platform-wide configuration." />
        <AccessDenied what="view platform settings" need="owner" />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Platform-wide configuration and defaults." />
      {error && <ErrorNote>{error}</ErrorNote>}

      {settings === null ? (
        <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (
        <div className="max-w-2xl space-y-6">
          <SettingsSection title="General">
            <SettingRow
              label="Platform name" value={settings.platform_name} canEdit={canEdit}
              onSave={async v => { await updateSetting('platform_name', v); await load(); }}
            />
          </SettingsSection>

          <SettingsSection title="Survey defaults">
            <StaticRow label="Default categories offered when creating a survey" value={LIBRARY_CATEGORIES.join(', ')} />
            <SettingRow
              label="Default invitation expiry (days)" value={String(settings.default_invitation_expiry_days)} canEdit={canEdit} numeric
              onSave={async v => { await updateSetting('default_invitation_expiry_days', Number(v)); await load(); }}
            />
          </SettingsSection>

          <SettingsSection title="Privacy">
            <div>
              <p className="mb-1 text-xs font-medium text-foreground">Default confidentiality threshold</p>
              <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                The minimum group size shown in any segment breakdown (department, location, designation) or narrow
                cross-filter. This is a floor the database itself enforces on every analytics call — it can be
                raised here, but it can never be lowered below <strong>{CONFIDENTIALITY_THRESHOLD_FLOOR}</strong>,
                regardless of what this setting says. Existing published survey reports are governed by this same
                enforced floor, not by whatever value happened to be configured when they were generated.
              </p>
              <ThresholdEditor value={settings.default_confidentiality_threshold} canEdit={canEdit}
                onSave={async v => { await updateSetting('default_confidentiality_threshold', v); await load(); }} />
            </div>
            <StaticRow label="Raw response access" value="Analyst role or above, per workspace. Identified responses on Confidential surveys additionally require the separate identity-view permission." />
          </SettingsSection>

          <SettingsSection title="Branding">
            <StaticRow label="Admin platform branding" value={settings.platform_name} />
            <StaticRow label="Customer branding" value="Logo and brand colour are set per customer, from the Customers screen." />
          </SettingsSection>

          <SettingsSection title="Authentication">
            <StaticRow label="Sign-in method" value="Magic link (one-time email link) — no passwords stored." />
            <StaticRow label="Supabase connection" value={isSupabaseConfigured ? 'Configured' : 'Not configured'} />
          </SettingsSection>
        </div>
      )}

      {!canEdit && settings && (
        <div className="mt-6 max-w-2xl"><AccessDenied what="change these settings" need="owner" /></div>
      )}
    </>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="mb-3 text-sm font-medium text-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{value}</p>
    </div>
  );
}

function SettingRow({
  label, value, canEdit, numeric, onSave,
}: { label: string; value: string; canEdit: boolean; numeric?: boolean; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-medium text-foreground">{label}</p><p className="text-xs text-muted-foreground">{value}</p></div>
        {canEdit && <Button variant="ghost" size="sm" onClick={() => { setDraft(value); setEditing(true); }}>Edit</Button>}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <input type={numeric ? 'number' : 'text'} value={draft} onChange={e => setDraft(e.target.value)}
               className="w-full max-w-xs rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60" />
        <Button size="sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { await onSave(draft); setEditing(false); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
        }}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ThresholdEditor({ value, canEdit, onSave }: { value: number; canEdit: boolean; onSave: (v: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(draft);
  const belowFloor = Number.isFinite(n) && n < CONFIDENTIALITY_THRESHOLD_FLOOR;

  return (
    <div>
      <div className="flex items-center gap-2">
        <input type="number" min={CONFIDENTIALITY_THRESHOLD_FLOOR} disabled={!canEdit} value={draft} onChange={e => setDraft(e.target.value)}
               className="w-24 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary/60 disabled:opacity-60" />
        {canEdit && (
          <Button size="sm" disabled={busy || belowFloor} onClick={async () => {
            setBusy(true); setError(null);
            try { await onSave(n); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
          }}>{busy ? 'Saving…' : 'Save'}</Button>
        )}
      </div>
      {belowFloor && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-500">
          Values below {CONFIDENTIALITY_THRESHOLD_FLOOR} are rejected — that floor is enforced by the database and cannot be weakened here.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
