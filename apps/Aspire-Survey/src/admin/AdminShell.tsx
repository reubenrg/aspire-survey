import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { useAdminSession } from './AdminGate';
import { RolePill } from './ui';

/**
 * Sections in workflow order rather than alphabetical: you pick a customer,
 * build a survey, collect responses, then analyse. Library and Templates sit
 * below as shared assets; Team, Activity and Settings are administration.
 */
const SECTIONS: { to: string; label: string; glyph: string; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', glyph: '▦', end: true },
  { to: '/admin/customers', label: 'Customers', glyph: '◈' },
  { to: '/admin/surveys', label: 'Surveys', glyph: '▤' },
  { to: '/admin/responses', label: 'Responses', glyph: '▥' },
  { to: '/admin/analytics', label: 'Analytics', glyph: '▧' },
  { to: '/admin/library', label: 'Question Library', glyph: '▢' },
  { to: '/admin/team', label: 'Team', glyph: '◉' },
  { to: '/admin/activity', label: 'Activity', glyph: '◷' },
  { to: '/admin/settings', label: 'Settings', glyph: '⚙' },
];

const COLLAPSE_KEY = 'aspire-admin-sidebar-collapsed';

export default function AdminShell() {
  const session = useAdminSession();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* private mode */ }
  }, [collapsed]);

  return (
    <div className="flex min-h-screen bg-muted/20">
      <aside className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-56',
      )}>
        <div className={cn('flex h-14 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'px-4')}>
          {collapsed ? (
            <span className="font-display text-sm text-primary">A</span>
          ) : (
            <div className="min-w-0">
              <p className="truncate font-display text-sm leading-tight text-foreground">Aspire Survey</p>
              <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">Admin</p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {SECTIONS.map(s => (
              <li key={s.to}>
                <NavLink
                  to={s.to}
                  end={s.end}
                  title={collapsed ? s.label : undefined}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className="text-xs leading-none opacity-70">{s.glyph}</span>
                  {!collapsed && <span className="truncate">{s.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex w-full items-center justify-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? '»' : '« Collapse'}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-6 backdrop-blur">
          <WorkspaceContext />
          <div className="flex items-center gap-3">
            <RolePill role={session.globalRole} />
            <span className="hidden text-xs text-muted-foreground sm:inline">{session.email}</span>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>Sign out</Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Names the scope the person is working in. A global owner sees every customer,
 * so saying "all customers" is more honest than implying a single active one.
 */
function WorkspaceContext() {
  const session = useAdminSession();
  const scope = session.globalRole
    ? 'All customers'
    : 'Customers you have access to';
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-foreground">{scope}</p>
      <p className="truncate text-[11px] text-muted-foreground">Aspire Survey workspace</p>
    </div>
  );
}
