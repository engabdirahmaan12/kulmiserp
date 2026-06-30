'use client';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { format } from 'date-fns';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  TrendingUp,
  Scale,
  ArrowLeftRight,
  ListChecks,
  BookOpen,
  FileText,
  Receipt,
  Wallet,
  Users,
  Building2,
  BookMarked,
  Banknote,
  HandCoins,
  Package,
  Coins,
  Lock,
  Shield,
  Settings2,
} from 'lucide-react';

export type AccountingTabId =
  | 'dashboard'
  | 'pnl'
  | 'balance-sheet'
  | 'cash-flow'
  | 'trial-balance'
  | 'ledger'
  | 'journals'
  | 'expenses'
  | 'payments'
  | 'transfers'
  | 'loans'
  | 'receivables'
  | 'payables'
  | 'accounts'
  | 'payroll'
  | 'valuation'
  | 'currency'
  | 'settings'
  | 'periods'
  | 'audit';

interface NavItem {
  id: AccountingTabId;
  labelKey: string;
  icon: LucideIcon;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
  /** Advanced bookkeeping — only owners/accountants (write access) see this group */
  advanced?: boolean;
}

/**
 * Advanced bookkeeping tabs. Hidden from non-writers (managers, cashiers) in the
 * sidebar and blocked by the page-level guard. Only owners & accountants reach these.
 */
export const ADVANCED_ACCOUNTING_TABS: AccountingTabId[] = [
  'ledger', 'trial-balance', 'journals', 'audit', 'payroll', 'periods', 'currency', 'settings',
];

export const ACCOUNTING_NAV: NavGroup[] = [
  {
    labelKey: 'accounting.navGroupAccounting',
    items: [
      { id: 'dashboard',   labelKey: 'accounting.tabDashboard',   icon: LayoutDashboard },
      { id: 'accounts',    labelKey: 'accounting.tabAccounts',    icon: BookMarked      },
      { id: 'payments',    labelKey: 'accounting.tabPayments',    icon: Wallet          },
      { id: 'transfers',   labelKey: 'accounting.tabTransfers',   icon: ArrowLeftRight  },
      { id: 'receivables', labelKey: 'accounting.tabReceivables', icon: Users           },
      { id: 'payables',    labelKey: 'accounting.tabPayables',    icon: Building2       },
      { id: 'expenses',    labelKey: 'accounting.tabExpenses',    icon: Receipt         },
      { id: 'loans',       labelKey: 'accounting.tabLoans',       icon: HandCoins       },
    ],
  },
  {
    labelKey: 'accounting.navGroupReports',
    items: [
      { id: 'pnl',           labelKey: 'accounting.tabPnl',          icon: TrendingUp },
      { id: 'cash-flow',     labelKey: 'accounting.tabCashFlow',     icon: ArrowLeftRight },
      { id: 'balance-sheet', labelKey: 'accounting.tabBalanceSheet', icon: Scale },
      { id: 'valuation',     labelKey: 'accounting.tabValuation',    icon: Package },
    ],
  },
  {
    labelKey: 'accounting.navGroupAdvanced',
    advanced: true,
    items: [
      { id: 'ledger',        labelKey: 'accounting.tabLedger',       icon: BookOpen    },
      { id: 'trial-balance', labelKey: 'accounting.tabTrialBalance', icon: ListChecks  },
      { id: 'journals',      labelKey: 'accounting.tabJournals',     icon: FileText    },
      { id: 'audit',         labelKey: 'accounting.tabAudit',        icon: Shield      },
      { id: 'payroll',       labelKey: 'accounting.tabPayroll',      icon: Banknote    },
      { id: 'periods',       labelKey: 'accounting.tabPeriods',      icon: Lock        },
      { id: 'currency',      labelKey: 'accounting.tabCurrency',     icon: Coins       },
      { id: 'settings',      labelKey: 'accounting.tabSettings',     icon: Settings2   },
    ],
  },
];

export const ACCOUNTING_QUICK_PILLS: { id: AccountingTabId; labelKey: string }[] = [
  { id: 'dashboard', labelKey: 'accounting.tabDashboard' },
  { id: 'pnl', labelKey: 'accounting.pillPnl' },
  { id: 'cash-flow', labelKey: 'accounting.tabCashFlow' },
  { id: 'balance-sheet', labelKey: 'accounting.tabBalanceSheet' },
];

export function getAccountingTabMeta(id: AccountingTabId): NavItem {
  const flat = ACCOUNTING_NAV.flatMap((g) => g.items);
  return flat.find((i) => i.id === id) ?? flat[0];
}


export function AccountingFinancialHeader({
  active,
  onChange,
}: {
  active: AccountingTabId;
  onChange: (id: AccountingTabId) => void;
}) {
  const { metrics, currency, isLoading } = useAccountingAccounts();
  const { t } = useTranslation();
  const monthLabel = format(new Date(), 'MMMM yyyy');
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  return (
    <div className="w-full shrink-0 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 text-white">
      <div className="px-5 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-100/90">
              {t('accounting.headerSubtitle')}
            </p>
            <p className="mt-1 text-sm font-medium text-blue-50/85">
              {t('accounting.headerAutoSynced', { month: monthLabel })}
            </p>
          </div>
          <div className="flex flex-wrap gap-8 sm:gap-12">
            <div className="text-right sm:text-left">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-100/80">{t('accounting.headerRevenue')}</p>
              <p className="text-2xl md:text-3xl font-bold tabular-nums tracking-tight">
                {isLoading ? '—' : fmt(metrics.totalRevenue)}
              </p>
            </div>
            <div className="text-right sm:text-left">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-100/80">{t('accounting.headerNetProfit')}</p>
              <p
                className={cn(
                  'text-2xl md:text-3xl font-bold tabular-nums tracking-tight',
                  metrics.netProfit < 0 && 'text-red-200',
                )}
              >
                {isLoading ? '—' : fmt(metrics.netProfit)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {ACCOUNTING_QUICK_PILLS.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                'rounded-full px-4 py-2 text-xs font-semibold transition-all',
                active === id
                  ? 'bg-white text-blue-700 shadow-md'
                  : 'bg-white/10 text-white hover:bg-white/20 ring-1 ring-white/25',
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const ACCOUNTING_WRITE_TABS: AccountingTabId[] = [
  'accounts', 'expenses', 'payroll', 'valuation', 'currency', 'periods', 'receivables', 'payables',
];

/** Groups + items visible for the current access level. Advanced groups are
 *  hidden entirely from non-writers (managers/cashiers); write-only items are
 *  filtered out of the remaining groups. */
function visibleNavGroups(readOnly: boolean): NavGroup[] {
  if (!readOnly) return ACCOUNTING_NAV;
  return ACCOUNTING_NAV
    .filter((g) => !g.advanced)
    .map((g) => ({ ...g, items: g.items.filter((i) => !ACCOUNTING_WRITE_TABS.includes(i.id)) }))
    .filter((g) => g.items.length > 0);
}

export function AccountingNavSidebar({
  active,
  onChange,
  className,
  readOnly = false,
}: {
  active: AccountingTabId;
  onChange: (id: AccountingTabId) => void;
  className?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const navGroups = visibleNavGroups(readOnly);

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <ScrollArea className="flex-1">
        <nav className="p-3 space-y-5">
          {navGroups.map((group) => (
            <div key={group.labelKey}>
              <p className="px-2 mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                {t(group.labelKey)}
              </p>
              <ul className="space-y-0.5">
                {group.items.map(({ id, labelKey, icon: Icon }) => {
                  const isActive = active === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onChange(id)}
                        className={cn(
                          'relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all duration-150 border-l-[3px]',
                          isActive
                            ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0',
                            isActive ? 'text-blue-600' : 'text-slate-400',
                          )}
                        />
                        <span className="truncate">{t(labelKey)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  );
}

export function AccountingNavMobile({
  active,
  onChange,
  readOnly = false,
}: {
  active: AccountingTabId;
  onChange: (id: AccountingTabId) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const flat = visibleNavGroups(readOnly).flatMap((g) => g.items);
  const activeItem = flat.find((i) => i.id === active);
  const activeLabel = activeItem ? t(activeItem.labelKey) : t('accounting.title');

  return (
    <div className="md:hidden border-b border-slate-200 bg-white dark:border-slate-800">
      <p className="px-4 pt-2 text-xs font-semibold text-blue-700 truncate">{activeLabel}</p>
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 scrollbar-none">
        {flat.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              active === id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
