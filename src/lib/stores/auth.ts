import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Store, StoreUser, UserProfile } from '@/types';

interface AuthState {
  user: UserProfile | null;
  currentStore: Store | null;
  storeUser: StoreUser | null;
  stores: Store[];
  isLoading: boolean;
  isInitialized: boolean;

  setUser: (user: UserProfile | null) => void;
  setCurrentStore: (store: Store | null) => void;
  setStoreUser: (storeUser: StoreUser | null) => void;
  setStores: (stores: Store[]) => void;
  setLoading: (loading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  reset: () => void;
  switchStore: (storeId: string) => void;
}

export function isSubscriptionActive(store: Store | null): boolean {
  if (!store) return false;
  if (store.subscription_status === 'active') return true;
  if (store.subscription_status === 'trial') {
    const trialEnd = store.trial_ends_at ? new Date(store.trial_ends_at) : null;
    return trialEnd ? trialEnd > new Date() : false;
  }
  return false;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      currentStore: null,
      storeUser: null,
      stores: [],
      isLoading: true,
      isInitialized: false,

      setUser: (user) => set({ user }),
      setCurrentStore: (currentStore) => set({ currentStore }),
      setStoreUser: (storeUser) => set({ storeUser }),
      setStores: (stores) => set({ stores }),
      setLoading: (isLoading) => set({ isLoading }),
      setInitialized: (isInitialized) => set({ isInitialized }),
      reset: () =>
        set({
          user: null,
          currentStore: null,
          storeUser: null,
          stores: [],
          isLoading: false,
          isInitialized: true,
        }),

      switchStore: (storeId: string) => {
        const { stores } = get();
        const target = stores.find((s) => s.id === storeId);
        if (target) set({ currentStore: target });
      },
    }),
    {
      name: 'kulmis-auth',
      partialize: (state) => ({
        currentStore: state.currentStore,
        user: state.user,
      }),
    },
  ),
);
