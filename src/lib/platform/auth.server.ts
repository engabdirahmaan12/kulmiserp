import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { getPlatformRole, type PlatformRole } from '@/lib/platform/roles';

export type { PlatformRole };

export type PlatformPermission =
  | 'stores.view'
  | 'stores.manage'
  | 'stores.delete'
  | 'stores.impersonate'
  | 'stores.reset_password'
  | 'subscriptions.manage'
  | 'plans.manage'
  | 'payments.view'
  | 'payments.manage'
  | 'ai.manage'
  | 'audit.view'
  | 'notifications.view'
  | 'security.manage'
  | 'users.manage';

const ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  super_admin: [
    'stores.view', 'stores.manage', 'stores.delete', 'stores.impersonate', 'stores.reset_password',
    'subscriptions.manage', 'plans.manage', 'payments.view', 'payments.manage',
    'ai.manage', 'audit.view', 'notifications.view', 'security.manage', 'users.manage',
  ],
  platform_admin: [
    'stores.view', 'stores.manage', 'stores.impersonate', 'stores.reset_password',
    'subscriptions.manage', 'plans.manage', 'payments.view', 'payments.manage',
    'ai.manage', 'audit.view', 'notifications.view',
  ],
  support_staff: [
    'stores.view', 'subscriptions.manage', 'payments.view', 'audit.view', 'notifications.view',
  ],
};

export function hasPlatformPermission(role: PlatformRole, permission: PlatformPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function createServiceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export interface PlatformUser {
  user: User;
  role: PlatformRole;
}

export async function requirePlatformUser(
  permission?: PlatformPermission,
): Promise<PlatformUser | null> {
  const user = await getSessionUser();
  const role = getPlatformRole(user);
  if (!role || !user) return null;
  if (permission && !hasPlatformPermission(role, permission)) return null;
  return { user, role };
}

export async function requirePlatformUserFromRequest(
  req: NextRequest,
  permission?: PlatformPermission,
): Promise<PlatformUser | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  const role = getPlatformRole(user);
  if (!role || !user) return null;
  if (permission && !hasPlatformPermission(role, permission)) return null;
  return { user, role };
}

export async function logPlatformAction(params: {
  actor: User;
  role: PlatformRole;
  action: string;
  resourceType: string;
  resourceId?: string;
  storeId?: string;
  oldData?: unknown;
  newData?: unknown;
  req?: NextRequest;
}) {
  const admin = createServiceClient();
  await admin.rpc('log_platform_audit', {
    p_actor_id: params.actor.id,
    p_actor_email: params.actor.email ?? null,
    p_actor_role: params.role,
    p_action: params.action,
    p_resource_type: params.resourceType,
    p_resource_id: params.resourceId ?? null,
    p_store_id: params.storeId ?? null,
    p_old_data: params.oldData ?? null,
    p_new_data: params.newData ?? null,
    p_ip_address: params.req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    p_user_agent: params.req?.headers.get('user-agent') ?? null,
  });
}
