import type { User } from '@supabase/supabase-js';

export type PlatformRole = 'super_admin' | 'platform_admin' | 'support_staff';

export const PLATFORM_ROLES: PlatformRole[] = ['super_admin', 'platform_admin', 'support_staff'];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: 'Super Admin',
  platform_admin: 'Platform Admin',
  support_staff: 'Support Staff',
};

export const STORE_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  trial: 'Trial',
  expired: 'Expired',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  disabled: 'Disabled',
};

export const PLAN_SLUG_LABELS: Record<string, string> = {
  free_trial: 'Free',
  basic: 'Starter',
  business: 'Professional',
  enterprise: 'Enterprise',
};

export function getPlatformRole(user: User | null | undefined): PlatformRole | null {
  if (!user) return null;
  const platformRole = user.app_metadata?.platform_role as PlatformRole | undefined;
  if (platformRole && PLATFORM_ROLES.includes(platformRole)) return platformRole;
  if (user.app_metadata?.role === 'super_admin') return 'super_admin';
  return null;
}

export function isPlatformUser(user: User | null | undefined): boolean {
  return getPlatformRole(user) !== null;
}
