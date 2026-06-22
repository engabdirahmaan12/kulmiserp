'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';
import { ACCOUNT_TYPE_STYLES } from '@/lib/accounting/colors';
import { isProtectedAccount } from '@/lib/accounting/coa-constants';
import { useTranslation } from '@/lib/i18n/useTranslation';

export type CoaAccountRow = { account: Account; depth: number };

type Props = {
  rows: CoaAccountRow[];
  currency: string;
  canWrite: boolean;
  showArchived: boolean;
  emptyMessage: string;
  onEdit: (account: Account) => void;
  onArchive: (id: string) => void;
  onDelete: (account: Account) => void;
  onRestore: (id: string) => void;
};

export function CoaAccountSection({
  rows,
  currency,
  canWrite,
  showArchived,
  emptyMessage,
  onEdit,
  onArchive,
  onDelete,
  onRestore,
}: Props) {
  const { t } = useTranslation();
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(n);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/80 border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800">
          <tr>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t('coa.colNumber')}</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t('coa.colAccountName')}</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('coa.colType')}</th>
            <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t('coa.colBalance')}</th>
            {canWrite && <th className="w-28" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(({ account, depth }) => {
            const protectedAcct = isProtectedAccount(account);
            return (
              <tr key={account.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3">
                  <code className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 rounded-md px-2 py-0.5">{account.code}</code>
                </td>
                <td className="px-4 py-3" style={{ paddingLeft: `${16 + depth * 20}px` }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {depth > 0 && (
                      <span className="text-slate-300 dark:text-slate-600 select-none" aria-hidden>└</span>
                    )}
                    <span className="font-medium text-slate-900 dark:text-white">{account.name}</span>
                    {protectedAcct && (
                      <Badge variant="secondary" className="text-[9px] bg-blue-50 text-blue-700 dark:bg-blue-950/40">{t('coa.badgeSystem')}</Badge>
                    )}
                    {showArchived && (
                      <Badge variant="secondary" className="text-[9px] bg-slate-100 text-slate-500">{t('coa.badgeArchived')}</Badge>
                    )}
                  </div>
                  {account.description && (
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-md">{account.description}</p>
                  )}
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full', ACCOUNT_TYPE_STYLES[account.account_type]?.badge)}>
                    {t(`coa.type${account.account_type.charAt(0).toUpperCase() + account.account_type.slice(1)}` as Parameters<typeof t>[0])}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                  {currency} {fmt(account.balance)}
                </td>
                {canWrite && (
                  <td className="px-2 py-3">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(account)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!showArchived && !protectedAcct && account.system_role !== 'general_expenses' && (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" title={t('coa.titleArchive')} onClick={() => onArchive(account.id)}>
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" title={t('coa.titleDelete')} onClick={() => onDelete(account)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {showArchived && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" title={t('coa.titleRestore')} onClick={() => onRestore(account.id)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}