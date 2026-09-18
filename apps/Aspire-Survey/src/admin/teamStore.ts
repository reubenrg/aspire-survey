import { supabase } from '../lib/supabase';
import type { Role } from './labels';

export interface TeamMember {
  id: string;
  email: string;
  organization_id: string | null; // null = global
  organization_name: string | null;
  role: Role;
  can_view_identity: boolean;
  is_active: boolean;
  created_at: string;
}

function translate(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501') return new Error(`You do not have permission to ${action}.`);
  if (error.code === '23505') return new Error('This person is already a team member in this scope.');
  return new Error(error.message || `Could not ${action}.`);
}

/** Visibility is decided entirely inside list_team_members(): a global viewer+ sees everyone, an org-scoped member sees only their own workspaces. */
export async function listMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc('list_team_members');
  if (error) throw translate(error, 'view the team');
  return (data ?? []) as TeamMember[];
}

export async function addMember(
  email: string, organizationId: string | null, role: Role, canViewIdentity: boolean,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_team_member', {
    p_email: email, p_organization_id: organizationId, p_role: role, p_can_view_identity: canViewIdentity,
  });
  if (error) throw translate(error, 'add this team member');
  return data as string;
}

export async function updateMember(id: string, patch: { role?: Role; canViewIdentity?: boolean }): Promise<void> {
  const { error } = await supabase.rpc('update_team_member', {
    p_member_id: id, p_role: patch.role ?? null, p_can_view_identity: patch.canViewIdentity ?? null,
  });
  if (error) throw translate(error, 'update this team member');
}

export async function setMemberActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_team_member_active', { p_member_id: id, p_active: active });
  if (error) throw translate(error, active ? 'reactivate this member' : 'deactivate this member');
}
