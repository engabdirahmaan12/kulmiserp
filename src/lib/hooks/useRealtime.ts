'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';

export function useRealtimeDashboard() {
  const queryClient = useQueryClient();
  const { currentStore } = useAuthStore();
  const supabase = createClient();

  useEffect(() => {
    if (!currentStore) return;

    const channel = supabase
      .channel(`dashboard-${currentStore.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales',
          filter: `store_id=eq.${currentStore.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['dashboard', currentStore.id] });
          queryClient.invalidateQueries({ queryKey: ['sales', currentStore.id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'products',
          filter: `store_id=eq.${currentStore.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['products', currentStore.id] });
          queryClient.invalidateQueries({ queryKey: ['low-stock', currentStore.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentStore, queryClient, supabase]);
}

export function useRealtimeInventory() {
  const queryClient = useQueryClient();
  const { currentStore } = useAuthStore();
  const supabase = createClient();

  useEffect(() => {
    if (!currentStore) return;

    const channel = supabase
      .channel(`inventory-${currentStore.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products',
          filter: `store_id=eq.${currentStore.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['products', currentStore.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentStore, queryClient, supabase]);
}
