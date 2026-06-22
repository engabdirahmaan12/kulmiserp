import type { Store, StoreUser, UserRole } from '@/types';

/** Synthetic membership when user owns the store via stores.owner_id but has no store_users row. */
export function createOwnerStoreUser(userId: string, storeId: string): StoreUser {
  return {
    id: `owner-${storeId}`,
    store_id: storeId,
    user_id: userId,
    role: 'owner',
    custom_permissions: {},
    is_active: true,
    created_at: new Date().toISOString(),
  };
}

export function resolveStoreUser(
  userId: string | undefined,
  store: Store | null,
  membership: StoreUser | null | undefined,
): StoreUser | null {
  if (!userId || !store) return null;
  if (membership?.is_active !== false && membership?.role) return membership;
  if (store.owner_id === userId) return createOwnerStoreUser(userId, store.id);
  return membership ?? null;
}

export function resolveEffectiveRole(
  userId: string | undefined,
  store: Store | null,
  storeUser: StoreUser | null,
): UserRole | null {
  if (storeUser?.role) return storeUser.role;
  if (userId && store?.owner_id === userId) return 'owner';
  return null;
}

export function isStoreOwner(
  userId: string | undefined,
  store: Store | null,
): boolean {
  return !!userId && !!store && store.owner_id === userId;
}
