'use client';

import { useAuthStore } from '@/lib/stores/auth';
import { resolveEffectiveRole } from '@/lib/auth/store-role';
import { hasPermission } from '@/types';

export function usePermission() {
  const { storeUser, currentStore, user } = useAuthStore();
  const role = resolveEffectiveRole(user?.id, currentStore, storeUser);

  const can = (module: string, action: string): boolean => {
    if (!role) return false;
    return hasPermission(
      role,
      module,
      action,
      storeUser?.custom_permissions
    );
  };

  const canRead = (module: string) => can(module, 'read');
  const canWrite = (module: string) => can(module, 'write');
  const canDelete = (module: string) => can(module, 'delete');

  return { can, canRead, canWrite, canDelete, role };
}
