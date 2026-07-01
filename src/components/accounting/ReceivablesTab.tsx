'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { toast } from 'sonner';
import type { Customer } from '@/types';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';

export function ReceivablesTab() {
  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const methodOptions = storePaymentMethods.length > 0
    ? storePaymentMethods.filter((m) => m.slug !== 'customer_deposit' && m.is_active)
    : [
        { slug: 'cash', label: 'Cash' },
        { slug: 'bank', label: 'Bank Transfer' },
        { slug: 'evc',  label: 'EVC Plus' },
      ];

  const currency = currentStore?.currency || 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['receivables', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('store_id', currentStore!.id)
        .gt('balance', 0)
        .order('balance', { ascending: false });
      return (data ?? []) as Customer[];
    },
    enabled: !!currentStore,
  });

  const totalAR = customers.reduce((s, c) => s + c.balance, 0);

  const { mutate: recordPayment, isPending } = useMutation({
    mutationFn: async () => {
      if (!payCustomer || !user) return;
      const amt = parseFloat(amount);
      const supabase = createClient();
      const { data, error } = await supabase.rpc('record_debt_payment', {
        p_store_id: currentStore!.id,
        p_user_id: user.id,
        p_customer_id: payCustomer.id,
        p_amount: amt,
        p_payment_method: method,
        p_notes: null,
        p_sale_id: null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Payment failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receivables', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStore?.id] });
      toast.success(t('receivables.paymentPosted'));
      setPayCustomer(null);
      setAmount('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('receivables.title')}</h3>
          <p className="text-xs text-slate-500">{t('receivables.subtitle', { total: fmt(totalAR) })}</p>
        </div>
        <Link href="/dashboard/debts" className="text-xs text-blue-600 hover:underline font-medium">
          {t('receivables.fullDebtLink')}
        </Link>
      </div>

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>{t('receivables.colCustomer')}</th>
              <th className={reportTableHead}>{t('receivables.colPhone')}</th>
              <th className={reportTableHeadRight}>{t('receivables.colBalance')}</th>
              <th className={reportTableHeadRight}>{t('receivables.colAction')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">{c.full_name}</td>
                <td className="px-4 py-2.5 text-slate-500">{c.phone || '—'}</td>
                <td className="px-4 py-2.5 text-right font-bold text-orange-600 tabular-nums">{fmt(c.balance)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => { setPayCustomer(c); setAmount(String(c.balance)); }}>
                    {t('receivables.recordPayment')}
                  </Button>
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr><td colSpan={4} className="text-center py-12 text-slate-400">{t('receivables.noReceivables')}</td></tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>

      <Dialog open={!!payCustomer} onOpenChange={() => setPayCustomer(null)}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle>{t('receivables.dialogTitle')}</DialogTitle></DialogHeader>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">{payCustomer?.full_name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('receivables.colBalance')}: <strong className="text-orange-700">{fmt(payCustomer?.balance ?? 0)}</strong>
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t('receivables.labelAmount')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-12 text-lg font-semibold tabular-nums"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t('receivables.labelMethod')}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v ?? 'cash')}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {methodOptions.map((m) => (
                    <SelectItem key={m.slug} value={m.slug}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full h-11"
              disabled={isPending || !amount || parseFloat(amount) <= 0}
              onClick={() => recordPayment()}
            >
              {t('receivables.postPayment')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
