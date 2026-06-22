import type { Account, AccountType } from '@/types';

/** Seeded system accounts — 8 essentials, no sample breakdown */
export const SEEDED_SYSTEM_ROLES = [
  'cash',
  'inventory',
  'accounts_receivable',
  'accounts_payable',
  'owner_capital',
  'sales_revenue',
  'general_expenses',
  'cogs',
] as const;

export type SeededSystemRole = typeof SEEDED_SYSTEM_ROLES[number];

/** Cannot delete or archive */
export const PROTECTED_SYSTEM_ROLES = [
  'accounts_receivable',
  'accounts_payable',
  'inventory',
  'sales_revenue',
  'cogs',
  'owner_capital',
  'cash',
] as const;

/** Shown in simple first-time view (section 8) */
export const ESSENTIAL_VIEW_ROLES = [
  'cash',
  'sales_revenue',
  'general_expenses',
  'inventory',
  'accounts_payable',
] as const;

export const WIZARD_ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'expense', label: 'Expense' },
];

export const SYSTEM_ROLE_LABELS: Record<string, string> = {
  cash: 'Cash',
  inventory: 'Inventory Asset',
  accounts_receivable: 'Accounts Receivable',
  accounts_payable: 'Accounts Payable',
  owner_capital: 'Owner Capital',
  sales_revenue: 'Sales Revenue',
  general_expenses: 'General Expenses',
  cogs: 'Cost of Goods Sold',
  tax_payable: 'Tax Payable',
  opening_balance_equity: 'Opening Balance Equity',
  bad_debt_expense: 'Bad Debt Expense',
};

const LEGACY_HEADER_CODES = new Set(['1000', '1100', '2000', '3000', '4000', '5000', '6000']);

/** Pre-seeded sample accounts from old ERP templates — hidden until "Show all" */
export const LEGACY_SAMPLE_CODES = new Set([
  '1120', '1130', '1140', '1150', '1160', '1165', '1170',
  '6100', '6200', '6300', '6400', '3200', '3100',
]);

export function isLegacySampleAccount(account: Pick<Account, 'code' | 'is_system' | 'system_role' | 'name'>): boolean {
  if (!account.is_system || account.system_role) return false;
  if (LEGACY_SAMPLE_CODES.has(account.code)) return true;
  return /^(WAAFI|EVC Plus|Sahal|Zaad|Salaam Bank|Premier Bank|Dahabshiil|Rent Expense|Utilities Expense|Salaries Expense|Marketing Expense|Retained Earnings|Capital)$/i
    .test(account.name.trim());
}

export function isAuxiliarySystemAccount(account: Pick<Account, 'system_role' | 'is_postable' | 'is_active'>): boolean {
  if (account.is_postable === false || account.is_active === false) return false;
  if (!account.system_role || isSeededSystemAccount(account)) return false;
  return true;
}

export function isSeededSystemAccount(account: Pick<Account, 'system_role'>): boolean {
  if (!account.system_role) return false;
  return SEEDED_SYSTEM_ROLES.includes(account.system_role as SeededSystemRole);
}

export function isProtectedAccount(account: Pick<Account, 'is_protected' | 'system_role'>): boolean {
  if (account.is_protected) return true;
  if (!account.system_role) return false;
  return PROTECTED_SYSTEM_ROLES.includes(account.system_role as typeof PROTECTED_SYSTEM_ROLES[number]);
}

export function shouldShowInEssentialView(account: Pick<Account, 'system_role' | 'is_postable'>): boolean {
  if (account.is_postable === false) return false;
  if (!account.system_role) return false;
  return ESSENTIAL_VIEW_ROLES.includes(account.system_role as typeof ESSENTIAL_VIEW_ROLES[number]);
}

export function isUserAccount(account: Account): boolean {
  if (account.is_postable === false) return false;
  if (account.system_role) return false;
  if (LEGACY_HEADER_CODES.has(account.code) && account.is_system) return false;
  return true;
}

export function splitAccounts(accounts: Account[]): { system: Account[]; auxiliary: Account[]; user: Account[] } {
  const active = accounts.filter((a) => a.is_active !== false && a.is_postable !== false);
  const system = active.filter(isSeededSystemAccount).sort((a, b) => a.code.localeCompare(b.code));
  const auxiliary = active.filter(isAuxiliarySystemAccount).sort((a, b) => a.code.localeCompare(b.code));
  const user = active.filter(isUserAccount).sort((a, b) => a.code.localeCompare(b.code));
  return { system, auxiliary, user };
}

export function filterAccounts(
  accounts: Account[],
  search: string,
  typeFilter: AccountType | 'all',
): Account[] {
  const q = search.trim().toLowerCase();
  return accounts.filter((a) => {
    if (typeFilter !== 'all' && a.account_type !== typeFilter) return false;
    if (!q) return true;
    return (
      a.code.toLowerCase().includes(q)
      || a.name.toLowerCase().includes(q)
      || (a.description?.toLowerCase().includes(q) ?? false)
    );
  });
}

export function normalizeAccountCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateAccountCodeFormat(code: string): string | null {
  const normalized = normalizeAccountCode(code);
  if (!normalized) return 'Account number is required';
  if (normalized.length > 32) return 'Account number must be 32 characters or less';
  if (!/^[A-Z0-9][A-Z0-9\-_.\/]*$/.test(normalized)) {
    return 'Use letters, numbers, dashes, underscores, dots, or slashes';
  }
  return null;
}

export function isAccountCodeTaken(accounts: Account[], code: string, excludeId?: string): boolean {
  const target = normalizeAccountCode(code).toLowerCase();
  return accounts.some(
    (a) => a.id !== excludeId && a.code.toLowerCase() === target,
  );
}

export function suggestAccountCode(
  accounts: Account[],
  accountType: AccountType,
): string {
  const base = accountType === 'asset' ? 1000
    : accountType === 'liability' ? 2000
      : accountType === 'equity' ? 3000
        : accountType === 'revenue' ? 4000
          : 5000;

  const used = new Set(accounts.map((a) => a.code.toLowerCase()));

  let start = base;
  if (accountType === 'asset') {
    const walletMax = accounts
      .map((a) => (/^\d+$/.test(a.code) ? parseInt(a.code, 10) : NaN))
      .filter((n) => !Number.isNaN(n) && n >= 1000 && n < 2000)
      .reduce((m, n) => Math.max(m, n), 999);
    start = walletMax < 1000 ? 1010 : walletMax + 10;
  } else {
    start = base + 10;
  }

  for (let code = start; code <= base + 990; code += 10) {
    const candidate = String(code);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return String(start);
}

export const FISCAL_MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
] as const;

/** @deprecated use isSeededSystemAccount */
export const CORE_SYSTEM_ROLES = PROTECTED_SYSTEM_ROLES;
export function isCoreAccount(account: Pick<Account, 'system_role' | 'is_postable'>): boolean {
  return isSeededSystemAccount(account);
}
