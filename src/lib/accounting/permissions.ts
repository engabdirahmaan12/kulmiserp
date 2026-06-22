import type { Store, StoreUser, UserRole } from '@/types';
import { hasPermission } from '@/types';
import { resolveEffectiveRole } from '@/lib/auth/store-role';

export function getStoreRole(
  storeUser: StoreUser | null | undefined,
  currentStore: Store | null | undefined,
  userId?: string,
): UserRole | undefined {
  return resolveEffectiveRole(userId, currentStore ?? null, storeUser ?? null) ?? undefined;
}

/** Owner + accountant can mutate COA, journals, periods, expenses approval */
export function canWriteAccounting(role: UserRole | undefined): boolean {
  if (!role) return false;
  return hasPermission(role, 'accounting', 'write');
}

/** Owner, accountant, manager, purchase_officer can view reports */
export function canViewAccounting(role: UserRole | undefined): boolean {
  if (!role) return false;
  return hasPermission(role, 'accounting', 'read');
}

/** @deprecated Use isProtectedAccount from coa-constants */
export const PROTECTED_ACCOUNT_CODES = [
  '1000', '1100', '1200', '2000', '3000', '4000', '5000', '5100',
  '1110', '1300', '2100', '4100', '5100', '3200', '3300',
] as const;

export const ACCOUNTING_QUERY_KEYS = {
  accounts: (storeId?: string) => ['accounts', storeId] as const,
  accountsArchived: (storeId?: string) => ['accounts-archived', storeId] as const,
  generalLedger: (storeId?: string, accountId?: string, from?: string, to?: string, page?: number) =>
    ['general-ledger', storeId, accountId, from, to, page] as const,
  journalEntries: (storeId?: string, page?: number) => ['journal-entries', storeId, page] as const,
};

export const PAGE_SIZE = {
  ledger: 100,
  journals: 50,
  audit: 100,
} as const;

export function invalidateAccountingQueries(
  queryClient: { invalidateQueries: (opts: { queryKey: readonly unknown[] }) => void },
  storeId?: string,
) {
  if (!storeId) return;
  queryClient.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.accounts(storeId) });
  queryClient.invalidateQueries({ queryKey: ACCOUNTING_QUERY_KEYS.accountsArchived(storeId) });
  queryClient.invalidateQueries({ queryKey: ['general-ledger', storeId] });
  queryClient.invalidateQueries({ queryKey: ['journal-entries', storeId] });
  queryClient.invalidateQueries({ queryKey: ['accounts-simple', storeId] });
  queryClient.invalidateQueries({ queryKey: ['cash-flow-journals', storeId] });
  queryClient.invalidateQueries({ queryKey: ['audit-logs', storeId] });
}
