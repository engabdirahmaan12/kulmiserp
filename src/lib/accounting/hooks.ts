'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import type { Account, AccountingPeriod } from '@/types';
import {
  getAccountByCode,
  normalBalance,
  sumAccountsByType,
  PAYMENT_ACCOUNT_CODES,
  CASH_ON_HAND_CODE,
  MOBILE_MONEY_CODES,
  BANK_ACCOUNT_CODES,
} from './utils';
import { ACCOUNTING_QUERY_KEYS } from './permissions';

export function useAccountingAccounts(options?: { includeArchived?: boolean }) {
  const { currentStore } = useAuthStore();
  const includeArchived = options?.includeArchived ?? false;

  const query = useQuery({
    queryKey: includeArchived
      ? ACCOUNTING_QUERY_KEYS.accountsArchived(currentStore?.id)
      : ACCOUNTING_QUERY_KEYS.accounts(currentStore?.id),
    queryFn: async () => {
      const supabase = createClient();
      let q = supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('code');
      if (!includeArchived) q = q.eq('is_active', true);
      else q = q.eq('is_active', false);
      const { data, error } = await q;
      if (error) throw error;
      return data as Account[];
    },
    enabled: !!currentStore,
    staleTime: 30_000,
  });

  const accounts = query.data ?? [];

  const metrics = {
    cashBalance: PAYMENT_ACCOUNT_CODES.reduce(
      (s, code) => s + normalBalance(getAccountByCode(accounts, code) ?? { balance: 0, account_type: 'asset' }),
      0,
    ),
    cashOnHand: normalBalance(getAccountByCode(accounts, CASH_ON_HAND_CODE) ?? { balance: 0, account_type: 'asset' }),
    mobileMoneyBalance: MOBILE_MONEY_CODES.reduce(
      (s, code) => s + normalBalance(getAccountByCode(accounts, code) ?? { balance: 0, account_type: 'asset' }),
      0,
    ),
    bankBalance: BANK_ACCOUNT_CODES.reduce(
      (s, code) => s + normalBalance(getAccountByCode(accounts, code) ?? { balance: 0, account_type: 'asset' }),
      0,
    ),
    accountsReceivable: normalBalance(getAccountByCode(accounts, '1200') ?? { balance: 0, account_type: 'asset' }),
    accountsPayable: normalBalance(getAccountByCode(accounts, '2100') ?? { balance: 0, account_type: 'liability' }),
    inventoryValue: normalBalance(getAccountByCode(accounts, '1300') ?? { balance: 0, account_type: 'asset' }),
    totalRevenue: sumAccountsByType(accounts, ['revenue']),
    totalExpenses: sumAccountsByType(accounts, ['expense', 'cogs']),
    netProfit: sumAccountsByType(accounts, ['revenue']) - sumAccountsByType(accounts, ['expense', 'cogs']),
    totalAssets: sumAccountsByType(accounts, ['asset']),
    totalLiabilities: sumAccountsByType(accounts, ['liability']),
    totalEquity: sumAccountsByType(accounts, ['equity']),
  };

  return { ...query, accounts, metrics, currency: currentStore?.currency || 'USD' };
}

/** All accounts including archived — for reports that need historical COA */
export function useAllAccountsForReports() {
  const { currentStore } = useAuthStore();
  return useQuery({
    queryKey: ['accounts-all', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('code');
      if (error) throw error;
      return data as Account[];
    },
    enabled: !!currentStore,
    staleTime: 30_000,
  });
}

/** Hook: fetches closed accounting periods and exposes a helper to check if a date is blocked */
export function useClosedPeriods() {
  const { currentStore } = useAuthStore();

  const { data: periods = [] } = useQuery<Pick<AccountingPeriod, 'period_start' | 'period_end' | 'is_closed'>[]>({
    queryKey: ['accounting-periods-closed', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('accounting_periods')
        .select('period_start, period_end, is_closed')
        .eq('store_id', currentStore!.id)
        .eq('is_closed', true);
      return data ?? [];
    },
    enabled: !!currentStore,
    staleTime: 60_000,
  });

  const isDateClosed = useCallback(
    (dateStr: string): string | null => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      for (const p of periods) {
        const start = new Date(p.period_start);
        const end = new Date(p.period_end);
        if (d >= start && d <= end) {
          return `This date falls within a closed period (${p.period_start} – ${p.period_end}). Transactions cannot be posted into a closed period.`;
        }
      }
      return null;
    },
    [periods],
  );

  return { isDateClosed };
}
