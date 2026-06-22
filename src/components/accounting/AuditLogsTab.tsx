'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ReportTableShell, reportTableHead } from '@/components/reports/ReportLayout';
import { format } from 'date-fns';
import type { AccountingAuditLog } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

const ACTION_COLORS: Record<string, string> = {
  posted: 'bg-blue-50 text-blue-700',
  created: 'bg-blue-50 text-blue-700',
  approved: 'bg-blue-50 text-blue-700',
  rejected: 'bg-red-50 text-red-700',
  closed: 'bg-purple-50 text-purple-700',
  paid: 'bg-indigo-50 text-indigo-700',
  account_code_changed: 'bg-amber-50 text-amber-800',
  updated: 'bg-slate-100 text-slate-700',
};

function auditDetails(log: AccountingAuditLog): string {
  if (log.action === 'account_code_changed') {
    const oldNum = (log.old_values as { account_number?: string })?.account_number;
    const newNum = (log.new_values as { account_number?: string })?.account_number;
    if (oldNum && newNum) return `${oldNum} → ${newNum}`;
  }
  if (log.new_values && typeof log.new_values === 'object') {
    const nv = log.new_values as Record<string, unknown>;
    if (nv.code && nv.name) return `${nv.code} — ${nv.name}`;
    if (nv.account_number) return String(nv.account_number);
  }
  return log.new_values ? JSON.stringify(log.new_values) : '—';
}

export function AuditLogsTab() {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('accounting_audit_logs')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('created_at', { ascending: false })
        .limit(200);
      return data as AccountingAuditLog[];
    },
    enabled: !!currentStore,
  });

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-white">{t('auditLog.title')}</h3>
        <p className="text-xs text-slate-500">{t('auditLog.subtitle')}</p>
      </div>

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>{t('auditLog.colWhen')}</th>
              <th className={reportTableHead}>{t('auditLog.colEntity')}</th>
              <th className={reportTableHead}>{t('auditLog.colAction')}</th>
              <th className={reportTableHead}>{t('auditLog.colDetails')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {format(new Date(log.created_at), 'MMM d, yyyy HH:mm')}
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-slate-900 dark:text-white capitalize">
                    {log.entity_type.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge className={ACTION_COLORS[log.action] || 'bg-slate-100 text-slate-700'}>
                    {log.action.replace(/_/g, ' ')}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
                  {auditDetails(log)}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-slate-400">
                  {t('auditLog.noEntries')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>
    </div>
  );
}
