'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isSubscriptionActive, useAuthStore } from '@/lib/stores/auth';
import { resolveEffectiveRole, resolveStoreUser } from '@/lib/auth/store-role';
import type { Store, StoreUser, UserProfile } from '@/types';

let authSubscription: { unsubscribe: () => void } | null = null;
let loadUserDataPromise: Promise<void> | null = null;
let lastLoadedUserId: string | null = null;

async function loadUserData(
  userId: string,
  supabase: ReturnType<typeof createClient>,
  metadata?: { full_name?: string },
) {
  if (loadUserDataPromise && lastLoadedUserId === userId) {
    return loadUserDataPromise;
  }

  lastLoadedUserId = userId;

  loadUserDataPromise = (async () => {
    const store = useAuthStore.getState();

    try {
      let { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!profile) {
        await supabase.from('user_profiles').insert({
          id: userId,
          full_name: metadata?.full_name ?? null,
        });
        const refetch = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        profile = refetch.data;
      }

      const userProfile: UserProfile = {
        ...(profile || {
          id: userId,
          preferred_language: 'en',
          is_super_admin: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        id: userId,
      };

      const { data: { session } } = await supabase.auth.getSession();
      const platformRole =
        session?.user?.app_metadata?.platform_role ??
        (session?.user?.app_metadata?.role === 'super_admin' ? 'super_admin' : null);
      if (platformRole) {
        userProfile.is_super_admin = true;
      }

      const { data: storeUsers } = await supabase
        .from('store_users')
        .select(`
          *,
          store:stores(*)
        `)
        .eq('user_id', userId)
        .eq('is_active', true);

      const { data: ownedStores } = await supabase
        .from('stores')
        .select('*')
        .eq('owner_id', userId);

      const memberStores = (storeUsers ?? [])
        .map((su) => su.store)
        .filter(Boolean) as Store[];
      const owned = ownedStores ?? [];

      const storeById = new Map<string, Store>();
      for (const s of [...memberStores, ...owned]) {
        storeById.set(s.id, s);
      }
      const stores = Array.from(storeById.values());

      const persistedStoreId = store.currentStore?.id;
      const currentStore =
        stores.find((s) => s.id === persistedStoreId) || stores[0] || null;

      let storeUser: StoreUser | null = null;
      if (currentStore) {
        const membership = storeUsers?.find((su) => su.store_id === currentStore.id) as
          | StoreUser
          | undefined;
        storeUser = resolveStoreUser(userId, currentStore, membership ?? null);
      }

      useAuthStore.setState({
        user: userProfile,
        stores,
        currentStore,
        storeUser,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      console.error('Error loading user data:', error);
      useAuthStore.setState({ isLoading: false, isInitialized: true });
    } finally {
      loadUserDataPromise = null;
    }
  })();

  return loadUserDataPromise;
}

function initAuthListener(supabase: ReturnType<typeof createClient>) {
  if (authSubscription) return;

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') {
      if (session?.user) {
        void loadUserData(session.user.id, supabase, session.user.user_metadata);
      } else {
        useAuthStore.setState({ isLoading: false, isInitialized: true });
      }
      return;
    }

    if (event === 'SIGNED_IN' && session?.user) {
      lastLoadedUserId = null;
      void loadUserData(session.user.id, supabase, session.user.user_metadata);
      return;
    }

    if (event === 'SIGNED_OUT') {
      lastLoadedUserId = null;
      loadUserDataPromise = null;
      useAuthStore.getState().reset();
    }
  });

  authSubscription = subscription;
}

/** Mount once at app root — single auth listener, deduplicated user loading. */
export function useAuthBootstrap() {
  useEffect(() => {
    const supabase = createClient();
    initAuthListener(supabase);

    return () => {
      authSubscription?.unsubscribe();
      authSubscription = null;
      lastLoadedUserId = null;
      loadUserDataPromise = null;
    };
  }, []);
}

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const currentStore = useAuthStore((s) => s.currentStore);
  const storeUser = useAuthStore((s) => s.storeUser);
  const stores = useAuthStore((s) => s.stores);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const router = useRouter();
  const supabase = createClient();

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    lastLoadedUserId = null;
    loadUserDataPromise = null;
    useAuthStore.getState().reset();
    router.push('/login');
  }, [supabase, router]);

  const switchStore = useCallback(
    async (storeId: string) => {
      const state = useAuthStore.getState();
      const targetStore = state.stores.find((s) => s.id === storeId);
      if (!targetStore || !state.user?.id) return;

      const { data: storeUserRow } = await supabase
        .from('store_users')
        .select('*')
        .eq('store_id', storeId)
        .eq('user_id', state.user.id)
        .maybeSingle();

      useAuthStore.setState({
        currentStore: targetStore,
        storeUser: resolveStoreUser(
          state.user.id,
          targetStore,
          (storeUserRow as StoreUser | null) ?? null,
        ),
      });
    },
    [supabase],
  );

  const reloadUserData = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      lastLoadedUserId = null;
      useAuthStore.setState({ isLoading: true });
      await loadUserData(authUser.id, supabase, authUser.user_metadata);
    }
  }, [supabase]);

  return {
    user,
    currentStore,
    storeUser,
    stores,
    isLoading,
    isInitialized,
    role: resolveEffectiveRole(user?.id, currentStore, storeUser),
    isSuperAdmin: user?.is_super_admin ?? false,
    isSubscriptionActive: isSubscriptionActive(currentStore),
    signOut,
    switchStore,
    loadUserData: reloadUserData,
  };
}
