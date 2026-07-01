'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Settings2 } from 'lucide-react';
import { FISCAL_MONTHS } from '@/lib/accounting/coa-constants';
import { invalidateAccountingQueries } from '@/lib/accounting/permissions';
import { toSelectItems } from '@/lib/ui/select-utils';
import type { Store } from '@/types';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';

const COST_METHOD_KEYS = ['average', 'fifo', 'lifo'] as const;
type CostMethod = typeof COST_METHOD_KEYS[number];

export function AccountingSettingsTab() {
  const { currentStore, user, setCurrentStore } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { accounts } = useAccountingAccounts();

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active !== false && a.is_postable !== false),
    [accounts],
  );

  const cashOptions = useMemo(
    () => activeAccounts.filter((a) => a.account_type === 'asset'),
    [activeAccounts],
  );
  const revenueOptions = useMemo(
    () => activeAccounts.filter((a) => a.account_type === 'revenue'),
    [activeAccounts],
  );
  const expenseOptions = useMemo(
    () => activeAccounts.filter((a) => a.account_type === 'expense' || a.account_type === 'cogs'),
    [activeAccounts],
  );

  const cashSelectItems = useMemo(
    () => toSelectItems(cashOptions, (a) => a.id, (a) => `${a.code} — ${a.name}`, [{ value: 'none', label: t('acctSettings.defaultCash') }]),
    [cashOptions, t],
  );
  const revenueSelectItems = useMemo(
    () => toSelectItems(revenueOptions, (a) => a.id, (a) => `${a.code} — ${a.name}`, [{ value: 'none', label: t('acctSettings.defaultRevenue') }]),
    [revenueOptions, t],
  );
  const expenseSelectItems = useMemo(
    () => toSelectItems(expenseOptions, (a) => a.id, (a) => `${a.code} — ${a.name}`, [{ value: 'none', label: t('acctSettings.defaultExpense') }]),
    [expenseOptions, t],
  );

  const [secondaryCurrency, setSecondaryCurrency] = useState(currentStore?.secondary_currency || '');
  const [costMethod, setCostMethod] = useState<CostMethod>((currentStore?.inventory_cost_method as CostMethod) || 'average');
  const [fiscalMonth, setFiscalMonth] = useState(String(currentStore?.fiscal_year_start_month ?? 1));
  const [coaPrefix, setCoaPrefix] = useState(currentStore?.coa_number_prefix || '');
  const [autoPaymentAccounts, setAutoPaymentAccounts] = useState(currentStore?.auto_create_payment_accounts !== false);
  const [defaultCashId, setDefaultCashId] = useState(currentStore?.default_cash_account_id || '');
  const [defaultRevenueId, setDefaultRevenueId] = useState(currentStore?.default_revenue_account_id || '');
  const [defaultExpenseId, setDefaultExpenseId] = useState(currentStore?.default_expense_account_id || '');

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_accounting_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_secondary_currency: secondaryCurrency || null,
        p_inventory_cost_method: costMethod,
        p_fiscal_year_start_month: parseInt(fiscalMonth, 10),
        p_coa_number_prefix: coaPrefix,
        p_auto_create_payment_accounts: autoPaymentAccounts,
        p_default_cash_account_id: defaultCashId || null,
        p_default_revenue_account_id: defaultRevenueId || null,
        p_default_expense_account_id: defaultExpenseId || null,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed to save settings');
    },
    onSuccess: async () => {
      const supabase = createClient();
      const { data } = await supabase.from('stores').select('*').eq('id', currentStore!.id).single();
      if (data) setCurrentStore(data as Store);
      invalidateAccountingQueries(queryClient, currentStore?.id);
      toast.success(t('acctSettings.savedToast'));
    },
    onError: (e) => toast.error(e.message),
  });

  const baseCurrency = currentStore?.currency || 'USD';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-blue-600" /> {t('acctSettings.title')}
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          {t('acctSettings.subtitle')}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('acctSettings.sectionCurrency')}</h4>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-slate-500">{t('acctSettings.labelDefaultCurrency')}</Label>
            <Input value={baseCurrency} disabled className="mt-1.5 h-11 bg-slate-50" />
            <p className="text-[10px] text-slate-400 mt-1">{t('acctSettings.defaultCurrencyNote')}</p>
          </div>
          <div>
            <Label className="text-xs text-slate-500">{t('acctSettings.labelSecondaryCurrency')}</Label>
            <Input
              value={secondaryCurrency}
              onChange={(e) => setSecondaryCurrency(e.target.value.toUpperCase())}
              placeholder="SOS"
              className="mt-1.5 h-11 uppercase"
            />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {t('acctSettings.fxNote')}{' '}
          <Link href="/dashboard/accounting" className="text-blue-600 hover:underline">{t('acctSettings.fxLink')}</Link>.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('acctSettings.sectionFiscal')}</h4>
        <div>
          <Label className="text-xs text-slate-500">{t('acctSettings.labelFiscalStart')}</Label>
          <Select value={fiscalMonth} onValueChange={(val) => { if (val) setFiscalMonth(val); }}>
            <SelectTrigger className="mt-1.5 h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FISCAL_MONTHS.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('acctSettings.sectionInventory')}</h4>
        <div>
          <Label className="text-xs text-slate-500">{t('acctSettings.labelCostMethod')}</Label>
          <Select value={costMethod} onValueChange={(v) => setCostMethod(v as CostMethod)}>
            <SelectTrigger className="mt-1.5 h-11 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COST_METHOD_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {t(`acctSettings.costMethod${key.charAt(0).toUpperCase() + key.slice(1)}` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('acctSettings.sectionDefaults')}</h4>
        <p className="text-xs text-slate-500">
          {t('acctSettings.defaultsNote')}
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-slate-500">{t('acctSettings.labelCashAccount')}</Label>
            <Select
              items={cashSelectItems}
              value={defaultCashId || 'none'}
              onValueChange={(v) => setDefaultCashId(v === 'none' ? '' : v ?? '')}
            >
              <SelectTrigger className="mt-1.5 h-11 w-full"><SelectValue placeholder={t('acctSettings.defaultCash')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('acctSettings.defaultCash')}</SelectItem>
                {cashOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id} label={`${a.code} — ${a.name}`}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-slate-500">{t('acctSettings.labelRevenueAccount')}</Label>
            <Select
              items={revenueSelectItems}
              value={defaultRevenueId || 'none'}
              onValueChange={(v) => setDefaultRevenueId(v === 'none' ? '' : v ?? '')}
            >
              <SelectTrigger className="mt-1.5 h-11 w-full"><SelectValue placeholder={t('acctSettings.defaultRevenue')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('acctSettings.defaultRevenue')}</SelectItem>
                {revenueOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id} label={`${a.code} — ${a.name}`}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-slate-500">{t('acctSettings.labelExpenseAccount')}</Label>
            <Select
              items={expenseSelectItems}
              value={defaultExpenseId || 'none'}
              onValueChange={(v) => setDefaultExpenseId(v === 'none' ? '' : v ?? '')}
            >
              <SelectTrigger className="mt-1.5 h-11 w-full"><SelectValue placeholder={t('acctSettings.defaultExpense')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('acctSettings.defaultExpense')}</SelectItem>
                {expenseOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id} label={`${a.code} — ${a.name}`}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('acctSettings.sectionCoa')}</h4>
        <div>
          <Label className="text-xs text-slate-500">{t('acctSettings.labelCoaPrefix')}</Label>
          <Input
            value={coaPrefix}
            onChange={(e) => setCoaPrefix(e.target.value)}
            placeholder={t('acctSettings.coaPrefixPlaceholder')}
            className="mt-1.5 h-11"
          />
          <p className="text-[10px] text-slate-400 mt-1">{t('acctSettings.coaPrefixNote')}</p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('acctSettings.autoPaymentLabel')}</p>
            <p className="text-xs text-slate-500">
              {t('acctSettings.autoPaymentNote')}
            </p>
          </div>
          <Switch checked={autoPaymentAccounts} onCheckedChange={setAutoPaymentAccounts} />
        </div>
      </div>

      <Button onClick={() => save()} disabled={isPending} className="h-11 gap-2">
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('acctSettings.saveButton')}
      </Button>
    </div>
  );
}
