'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/auth';
import { fetchStoreIntelligence } from '@/lib/intelligence/engine';
import { fetchStoreAlerts } from '@/lib/intelligence/alerts';
import { globalSearch } from '@/lib/intelligence/globalSearch';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function useStoreIntelligence() {
  const { currentStore, user } = useAuthStore();
  const { t, locale } = useTranslation();
  return useQuery({
    queryKey: ['intelligence', currentStore?.id, locale],
    queryFn: () => fetchStoreIntelligence(currentStore!, user?.full_name, t),
    enabled: !!currentStore,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useStoreAlerts() {
  const { currentStore } = useAuthStore();
  return useQuery({
    queryKey: ['reminders', currentStore?.id],
    queryFn: () => fetchStoreAlerts(currentStore!),
    enabled: !!currentStore,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useGlobalSearchQuery(term: string, enabled: boolean) {
  const { currentStore } = useAuthStore();
  return useQuery({
    queryKey: ['global-search', currentStore?.id, term],
    queryFn: () => globalSearch(currentStore!.id, term),
    enabled: enabled && !!currentStore && term.length >= 2,
    staleTime: 10_000,
  });
}
