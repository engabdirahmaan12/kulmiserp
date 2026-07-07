import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Wallet, Landmark, Smartphone, Coins } from 'lucide-react';
import type { StorePaymentMethod, PaymentMethod } from '@/types';

export interface DynamicPaymentOption {
  method: PaymentMethod;
  label: string;
  icon: typeof Wallet;
  group: string;
  accountNumber?: string;
  accountName?: string;
}

function slugToIcon(slug: string): typeof Wallet {
  if (slug === 'cash') return Wallet;
  if (slug === 'bank' || slug === 'cheque') return Landmark;
  if (slug === 'customer_deposit') return Coins;
  return Smartphone;
}

function slugToGroup(slug: string): string {
  return slug === 'cash' || slug === 'bank' || slug === 'cheque' ? 'cash' : 'mobile';
}

export function useStorePaymentMethods(opts?: { includeInactive?: boolean }) {
  const { currentStore } = useAuthStore();
  const includeInactive = opts?.includeInactive ?? false;

  return useQuery({
    queryKey: ['store-payment-methods', currentStore?.id, includeInactive],
    queryFn: async () => {
      const supabase = createClient();
      let q = supabase
        .from('store_payment_methods')
        .select('*, account:chart_of_accounts(id, code, name, balance, account_type)')
        .eq('store_id', currentStore!.id)
        .order('sort_order');
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as StorePaymentMethod[];
    },
    enabled: !!currentStore,
    staleTime: 30_000,
  });
}

export function methodsToPaymentOptions(methods: StorePaymentMethod[]): DynamicPaymentOption[] {
  return methods
    .filter((m) => m.slug !== 'customer_deposit' && m.is_active)
    .map((m) => ({
      method: m.slug as PaymentMethod,
      label: m.label,
      icon: slugToIcon(m.slug),
      // Prefer the user-chosen category column (migration 058); fall back to the
      // slug heuristic for rows created before that column existed.
      group: m.category ?? slugToGroup(m.slug),
      accountNumber: m.account_number ?? undefined,
      accountName: m.account_name ?? undefined,
    }));
}

export const FALLBACK_PAYMENT_OPTIONS: DynamicPaymentOption[] = [
  { method: 'cash',  label: 'Cash',  icon: Wallet,    group: 'cash'   },
  { method: 'evc',   label: 'EVC Plus', icon: Smartphone, group: 'mobile' },
  { method: 'waafi', label: 'WAAFI', icon: Smartphone, group: 'mobile' },
];
