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
import { useTranslation } from '@/lib/i18n/useTranslation';

interface SupplierRow {
  id: string;
  name: string;
  phone?: string;
  balance: number;
}

export function PayablesTab() {
  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [paySupplier, setPaySupplier] = useState<SupplierRow | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');

  const currency = currentStore?.currency || 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['payables', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('suppliers')
        .select('id, name, phone, balance')
        .eq('store_id', currentStore!.id)
        .gt('balance', 0)
        .order('balance', { ascending: false });
      return (data ?? []) as SupplierRow[];
    },
    enabled: !!currentStore,
  });

  const totalAP = suppliers.reduce((s, c) => s + c.balance, 0);

  const { mutate: recordPayment, isPending } = useMutation({
    mutationFn: async () => {
      if (!paySupplier || !user) return;
      const amt = parseFloat(amount);
      const supabase = createClient();
      const { data, error } = await supabase.rpc('record_supplier_payment', {
        p_store_id: currentStore!.id,
        p_user_id: user.id,
        p_supplier_id: paySupplier.id,
        p_amount: amt,
        p_payment_method: method,
        p_notes: null,
        p_purchase_order_id: null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Payment failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payables', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStore?.id] });
      toast.success(t('payables.paymentPosted'));
      setPaySupplier(null);
      setAmount('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-white">{t('payables.title')}</h3>
        <p className="text-xs text-slate-500">{t('payables.subtitle', { total: fmt(totalAP) })}</p>
      </div>

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>{t('payables.colSupplier')}</th>
              <th className={reportTableHead}>{t('payables.colPhone')}</th>
              <th className={reportTableHeadRight}>{t('payables.colBalance')}</th>
              <th className={reportTableHeadRight}>{t('payables.colAction')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {suppliers.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">{s.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{s.phone || '—'}</td>
                <td className="px-4 py-2.5 text-right font-bold text-red-600 tabular-nums">{fmt(s.balance)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => { setPaySupplier(s); setAmount(String(s.balance)); }}>
                    {t('payables.paySupplier')}
                  </Button>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr><td colSpan={4} className="text-center py-12 text-slate-400">{t('payables.noPayables')}</td></tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>

      <Dialog open={!!paySupplier} onOpenChange={() => setPaySupplier(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t('payables.dialogTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">{t('payables.dialogBalance', { name: paySupplier?.name ?? '', balance: fmt(paySupplier?.balance ?? 0) })}</p>
          <div className="space-y-3">
            <div><Label>{t('payables.labelAmount')}</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div>
              <Label>{t('payables.labelMethod')}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v ?? 'cash')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['cash', 'waafi', 'evc', 'sahal', 'zaad'].map((m) => (
                    <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={isPending} onClick={() => recordPayment()}>{t('payables.postPayment')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
