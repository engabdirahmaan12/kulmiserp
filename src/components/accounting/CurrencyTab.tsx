'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import type { ExchangeRate, Store } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function CurrencyTab() {
  const { currentStore, user, setCurrentStore } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [fromCurrency, setFromCurrency] = useState('');
  const [toCurrency, setToCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [secondaryCurrency, setSecondaryCurrency] = useState(currentStore?.secondary_currency || '');

  const baseCurrency = currentStore?.currency || 'USD';

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['exchange-rates', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('exchange_rates')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('effective_date', { ascending: false })
        .limit(50);
      return data as ExchangeRate[];
    },
    enabled: !!currentStore,
  });

  const { mutate: saveRate, isPending } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('upsert_exchange_rate', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_from_currency: fromCurrency || baseCurrency,
        p_to_currency: toCurrency,
        p_rate: parseFloat(rate),
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates', currentStore?.id] });
      toast.success(t('currency.rateSaved'));
      setRate('');
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: saveSettings, isPending: savingSettings } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_accounting_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_secondary_currency: secondaryCurrency || null,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: async () => {
      const supabase = createClient();
      const { data } = await supabase.from('stores').select('*').eq('id', currentStore!.id).single();
      if (data) setCurrentStore(data as Store);
      toast.success(t('currency.settingsSaved'));
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-white">{t('currency.title')}</h3>
        <p className="text-xs text-slate-500">{t('currency.subtitle', { base: baseCurrency })}</p>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 max-w-md">
        <Label>{t('currency.labelSecondary')}</Label>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. SOS, EUR"
            value={secondaryCurrency}
            onChange={(e) => setSecondaryCurrency(e.target.value.toUpperCase())}
            className="uppercase"
          />
          <Button onClick={() => saveSettings()} disabled={savingSettings} variant="outline">
            {t('currency.saveButton')}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 max-w-lg">
        <h4 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
          <Plus className="h-4 w-4" /> {t('currency.addRateTitle')}
        </h4>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">{t('currency.labelFrom')}</Label>
            <Input placeholder={baseCurrency} value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label className="text-xs">{t('currency.labelTo')}</Label>
            <Input placeholder="SOS" value={toCurrency} onChange={(e) => setToCurrency(e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label className="text-xs">{t('currency.labelRate')}</Label>
            <Input type="number" step="0.000001" placeholder="1.0" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        </div>
        <Button
          onClick={() => saveRate()}
          disabled={isPending || !toCurrency || !rate}
          className="bg-gradient-to-r from-blue-600 to-indigo-600"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('currency.addRateButton')}
        </Button>
      </div>

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>{t('currency.colDate')}</th>
              <th className={reportTableHead}>{t('currency.colPair')}</th>
              <th className={reportTableHeadRight}>{t('currency.colRate')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {rates.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 text-slate-500">{format(new Date(r.effective_date), 'MMM d, yyyy')}</td>
                <td className="px-4 py-3 font-medium">{r.from_currency} → {r.to_currency}</td>
                <td className="px-4 py-3 text-right tabular-nums font-mono">{r.rate}</td>
              </tr>
            ))}
            {rates.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400">{t('currency.noRates')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>
    </div>
  );
}
