'use client';

import {
  ShoppingCart,
  FileText,
  Truck,
  Receipt,
  CreditCard,
  Banknote,
  Package,
  ArrowLeftRight,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function AccountingIntegrationFeed({ className }: { className?: string }) {
  const { t } = useTranslation();

  const INTEGRATIONS = [
    { id: 'Pos', icon: ShoppingCart },
    { id: 'Invoice', icon: FileText },
    { id: 'Purchase', icon: Truck },
    { id: 'Expense', icon: Receipt },
    { id: 'DebtCust', icon: CreditCard },
    { id: 'DebtSupp', icon: Banknote },
    { id: 'Payroll', icon: Banknote },
    { id: 'Inventory', icon: Package },
    { id: 'Refunds', icon: ArrowLeftRight },
  ] as const;

  return (
    <div className={cn('rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 p-4 dark:border-blue-900/40 dark:from-blue-950/30 dark:to-indigo-950/20', className)}>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('acctFeed.title')}</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
            {t('acctFeed.subtitle')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {INTEGRATIONS.map(({ id, icon: Icon }) => (
          <div
            key={id}
            className="flex items-start gap-2.5 rounded-xl bg-white/80 px-3 py-2.5 border border-white shadow-sm dark:bg-slate-900/60 dark:border-slate-800"
          >
            <Icon className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {t(`acctFeed.mod${id}` as Parameters<typeof t>[0])}
              </p>
              <p className="text-[10px] text-slate-500 truncate">
                {t(`acctFeed.evt${id}` as Parameters<typeof t>[0])} → {t(`acctFeed.acc${id}` as Parameters<typeof t>[0])}
              </p>
            </div>
            <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wide text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded dark:bg-blue-950/50">
              {t('acctFeed.autoBadge')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
