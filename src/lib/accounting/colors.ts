import type { AccountType } from '@/types';

/** Shared ERP brand — same blue/indigo as dashboard, POS, and sidebar */
export const ACCOUNTING_COLORS = {
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryDark: '#1e40af',
  indigo: '#4f46e5',
  workspace: '#f9fafb',
  surface: '#ffffff',
  border: '#e2e8f0',
  sidebarActiveBg: '#eff6ff',
  sidebarActiveBorder: '#2563eb',
  sidebarActiveText: '#1d4ed8',
} as const;

/** Primary action button — matches rest of app */
export const BRAND_BUTTON_CLASS =
  'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm shadow-blue-200/30';

export const ACCOUNT_TYPE_STYLES: Record<
  AccountType,
  { badge: string; label: string }
> = {
  asset: {
    badge: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
    label: 'Asset',
  },
  liability: {
    badge: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100',
    label: 'Liability',
  },
  equity: {
    badge: 'bg-violet-50 text-violet-700 ring-1 ring-violet-100',
    label: 'Equity',
  },
  revenue: {
    badge: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100',
    label: 'Revenue',
  },
  cogs: {
    badge: 'bg-amber-50 text-amber-800 ring-1 ring-amber-100',
    label: 'COGS',
  },
  expense: {
    badge: 'bg-orange-50 text-orange-700 ring-1 ring-orange-100',
    label: 'Expense',
  },
};

export function accountTypeBadgeClass(type: AccountType): string {
  return ACCOUNT_TYPE_STYLES[type]?.badge ?? 'bg-slate-50 text-slate-700';
}
