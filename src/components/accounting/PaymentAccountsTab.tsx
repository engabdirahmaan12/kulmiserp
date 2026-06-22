'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { normalBalance } from '@/lib/accounting/utils';
import { canWriteAccounting, invalidateAccountingQueries } from '@/lib/accounting/permissions';
import { toSelectItems } from '@/lib/ui/select-utils';
import type { StorePaymentMethod } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function PaymentAccountsTab() {
  const { currentStore, user, storeUser } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canWrite = canWriteAccounting(storeUser?.role);
  const autoCreateDefault = currentStore?.auto_create_payment_accounts !== false;

  const [showAdd, setShowAdd] = useState(false);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [createAccount, setCreateAccount] = useState(autoCreateDefault);
  const [linkAccountId, setLinkAccountId] = useState('');

  const { accounts, isLoading: loadingAccounts, currency, metrics } = useAccountingAccounts();

  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'asset' && a.is_postable !== false && a.is_active !== false),
    [accounts],
  );

  const assetSelectItems = useMemo(
    () => toSelectItems(assetAccounts, (a) => a.id, (a) => `${a.code} — ${a.name}`, [{ value: 'none', label: t('paymentAccounts.selectAccount') }]),
    [assetAccounts, t],
  );

  const { data: methods = [], isLoading: loadingMethods } = useQuery({
    queryKey: ['store-payment-methods', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('store_payment_methods')
        .select('*, account:chart_of_accounts(*)')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as StorePaymentMethod[];
    },
    enabled: !!currentStore,
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const paymentAccounts = methods.length > 0
    ? methods.map((m) => ({
        id: m.account_id,
        code: m.account?.code ?? '—',
        name: m.label,
        slug: m.slug,
        balance: m.account?.balance ?? 0,
      }))
    : accounts.filter((a) => a.account_type === 'asset' && a.is_postable !== false && a.system_role !== 'inventory');

  const resetForm = () => {
    setSlug('');
    setLabel('');
    setCreateAccount(autoCreateDefault);
    setLinkAccountId('');
  };

  const openAdd = () => {
    resetForm();
    setShowAdd(true);
  };

  const { mutate: createMethod, isPending: creating } = useMutation({
    mutationFn: async () => {
      if (!createAccount && !linkAccountId) {
        throw new Error('Select an account to link or enable account creation.');
      }
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_store_payment_method', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_slug: slug,
        p_label: label,
        p_create_account: createAccount,
        p_link_account_id: createAccount ? null : linkAccountId,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string; account_code?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
      return res;
    },
    onSuccess: (res) => {
      invalidateAccountingQueries(queryClient, currentStore?.id);
      queryClient.invalidateQueries({ queryKey: ['store-payment-methods', currentStore?.id] });
      toast.success(
        createAccount
          ? t('paymentAccounts.createdWithAccount', { code: res.account_code ?? '' })
          : t('paymentAccounts.createdLinked'),
      );
      setShowAdd(false);
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = !!slug && !!label && (createAccount || !!linkAccountId);
  const isLoading = loadingAccounts || loadingMethods;

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Wallet className="h-4 w-4 text-blue-600" /> {t('paymentAccounts.title')}
          </h3>
          <p className="text-xs text-slate-500">
            {t('paymentAccounts.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
            {t('paymentAccounts.totalCash', { total: fmt(metrics.cashBalance) })}
          </Badge>
          {canWrite && (
            <Button size="sm" className="gap-1.5" onClick={openAdd}>
              <Plus className="h-4 w-4" /> {t('paymentAccounts.addMethod')}
            </Button>
          )}
        </div>
      </div>

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>{t('paymentAccounts.colAccountNum')}</th>
              <th className={reportTableHead}>{t('paymentAccounts.colName')}</th>
              <th className={reportTableHead}>{t('paymentAccounts.colMethod')}</th>
              <th className={reportTableHeadRight}>{t('paymentAccounts.colBalance')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {paymentAccounts.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3">
                  <code className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">{a.code}</code>
                </td>
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{a.name}</td>
                <td className="px-4 py-3 text-slate-500 capitalize">{('slug' in a ? a.slug : a.name).replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-blue-600">
                  {fmt(normalBalance({ balance: a.balance, account_type: 'asset' }))}
                </td>
              </tr>
            ))}
            {paymentAccounts.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-10 text-slate-400 text-sm">
                  {t('paymentAccounts.noMethods')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('paymentAccounts.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('paymentAccounts.dialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('paymentAccounts.labelSlug')}</Label>
              <Input
                placeholder={t('paymentAccounts.slugPlaceholder')}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                className="mt-1"
              />
              <p className="text-[10px] text-slate-400 mt-1">{t('paymentAccounts.slugNote')}</p>
            </div>
            <div>
              <Label>{t('paymentAccounts.labelDisplayName')}</Label>
              <Input
                placeholder={t('paymentAccounts.displayNamePlaceholder')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1"
              />
              <p className="text-[10px] text-slate-400 mt-1">{t('paymentAccounts.displayNameNote')}</p>
            </div>

            <div className="rounded-lg border border-slate-200 p-3 space-y-3 dark:border-slate-700">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="create-acct"
                  checked={createAccount}
                  onCheckedChange={(v) => setCreateAccount(v === true)}
                />
                <div>
                  <Label htmlFor="create-acct" className="cursor-pointer font-medium">
                    {t('paymentAccounts.createAccountLabel')}
                  </Label>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('paymentAccounts.createAccountNote')}
                  </p>
                </div>
              </div>

              {!createAccount && (
                <div>
                  <Label>{t('paymentAccounts.labelLinkAccount')}</Label>
                  <Select
                    items={assetSelectItems}
                    value={linkAccountId || 'none'}
                    onValueChange={(v) => setLinkAccountId(v === 'none' ? '' : v ?? '')}
                  >
                    <SelectTrigger className="mt-1 w-full"><SelectValue placeholder={t('paymentAccounts.selectAccount')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('paymentAccounts.selectAccount')}</SelectItem>
                      {assetAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id} label={`${a.code} — ${a.name}`}>{a.code} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Button className="w-full" disabled={creating || !canSubmit} onClick={() => createMethod()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {createAccount ? t('paymentAccounts.submitWithAccount') : t('paymentAccounts.submitNoAccount')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
