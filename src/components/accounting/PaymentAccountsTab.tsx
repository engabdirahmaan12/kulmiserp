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
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Loader2, Wallet, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { normalBalance } from '@/lib/accounting/utils';
import { canWriteAccounting, invalidateAccountingQueries } from '@/lib/accounting/permissions';
import { toSelectItems } from '@/lib/ui/select-utils';
import type { StorePaymentMethod } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

// ── Edit dialog state ──────────────────────────────────────────────────────────
interface EditState {
  id: string;
  label: string;
  account_number: string;
  account_name: string;
  description: string;
  is_active: boolean;
  is_system: boolean;
  account_code: string;
  account_gl_name: string;
}

export function PaymentAccountsTab() {
  const { currentStore, user, storeUser } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canWrite = canWriteAccounting(storeUser?.role);
  const autoCreateDefault = currentStore?.auto_create_payment_accounts !== false;

  // ── Add dialog state ───────────────────────────────────────────────────────
  const [showAdd,        setShowAdd]        = useState(false);
  const [slug,           setSlug]           = useState('');
  const [slugEdited,     setSlugEdited]     = useState(false);
  const [label,          setLabel]          = useState('');
  const [createAccount,  setCreateAccount]  = useState(autoCreateDefault);
  const [linkAccountId,  setLinkAccountId]  = useState('');
  const [showInactive,   setShowInactive]   = useState(false);

  // Short code is derived from the display name so non-technical owners never
  // have to think about it — it stays editable for the rare case they want to.
  const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  // ── Edit dialog state ──────────────────────────────────────────────────────
  const [editState, setEditState] = useState<EditState | null>(null);

  // ── Delete confirm ────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<StorePaymentMethod | null>(null);

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
    queryKey: ['store-payment-methods', currentStore?.id, true],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('store_payment_methods')
        .select('*, account:chart_of_accounts(id, code, name, balance, account_type)')
        .eq('store_id', currentStore!.id)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as StorePaymentMethod[];
    },
    enabled: !!currentStore,
  });

  const visibleMethods = showInactive ? methods : methods.filter((m) => m.is_active);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  // ── Add method ─────────────────────────────────────────────────────────────
  const resetAddForm = () => { setSlug(''); setSlugEdited(false); setLabel(''); setCreateAccount(autoCreateDefault); setLinkAccountId(''); };
  const openAdd = () => { resetAddForm(); setShowAdd(true); };

  const { mutate: createMethod, isPending: creating } = useMutation({
    mutationFn: async () => {
      if (!createAccount && !linkAccountId) throw new Error('Select an account to link or enable account creation.');
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
      resetAddForm();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Edit method ────────────────────────────────────────────────────────────
  const openEdit = (m: StorePaymentMethod) => {
    setEditState({
      id:             m.id,
      label:          m.label,
      account_number: m.account_number ?? '',
      account_name:   m.account_name ?? '',
      description:    m.description ?? '',
      is_active:      m.is_active,
      is_system:      m.is_system,
      account_code:   (m.account as any)?.code ?? '—',
      account_gl_name:(m.account as any)?.name ?? '—',
    });
  };

  const { mutate: saveEdit, isPending: saving } = useMutation({
    mutationFn: async () => {
      if (!editState) return;
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_payment_method', {
        p_store_id:       currentStore!.id,
        p_user_id:        user!.id,
        p_method_id:      editState.id,
        p_label:          editState.label,
        p_account_number: editState.account_number || null,
        p_account_name:   editState.account_name   || null,
        p_description:    editState.description    || null,
        p_is_active:      editState.is_active,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Update failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-payment-methods', currentStore?.id] });
      toast.success('Payment method updated');
      setEditState(null);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Delete method ──────────────────────────────────────────────────────────
  const { mutate: doDelete, isPending: deleting } = useMutation({
    mutationFn: async (methodId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('delete_store_payment_method', {
        p_store_id:  currentStore!.id,
        p_user_id:   user!.id,
        p_method_id: methodId,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Delete failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-payment-methods', currentStore?.id] });
      toast.success('Payment method deleted');
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Quick toggle active ────────────────────────────────────────────────────
  const { mutate: toggleActive } = useMutation({
    mutationFn: async ({ m, active }: { m: StorePaymentMethod; active: boolean }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_payment_method', {
        p_store_id:       currentStore!.id,
        p_user_id:        user!.id,
        p_method_id:      m.id,
        p_label:          m.label,
        p_account_number: m.account_number ?? null,
        p_account_name:   m.account_name   ?? null,
        p_description:    m.description    ?? null,
        p_is_active:      active,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: (_v, { active }) => {
      queryClient.invalidateQueries({ queryKey: ['store-payment-methods', currentStore?.id] });
      toast.success(active ? 'Payment method enabled' : 'Payment method disabled');
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmitAdd = !!slug && !!label && (createAccount || !!linkAccountId);
  const isLoading = loadingAccounts || loadingMethods;
  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  const totalBalance = methods
    .filter((m) => m.is_active)
    .reduce((s, m) => s + normalBalance({ balance: (m.account as any)?.balance ?? 0, account_type: 'asset' }), 0);

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Wallet className="h-4 w-4 text-blue-600" /> {t('paymentAccounts.title')}
          </h3>
          <p className="text-xs text-slate-500">{t('paymentAccounts.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
            {t('paymentAccounts.totalCash', { total: fmt(totalBalance) })}
          </Badge>
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              showInactive
                ? 'border-slate-400 bg-slate-100 text-slate-700'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
            )}
          >
            {showInactive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showInactive ? 'Hide Inactive' : 'Show Inactive'}
          </button>
          {canWrite && (
            <Button size="sm" className="gap-1.5" onClick={openAdd}>
              <Plus className="h-4 w-4" /> {t('paymentAccounts.addMethod')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>GL Code</th>
              <th className={reportTableHead}>Name</th>
              <th className={reportTableHead}>Account #</th>
              <th className={reportTableHead}>Account Holder</th>
              <th className={reportTableHead}>Type</th>
              <th className={reportTableHead}>Status</th>
              <th className={reportTableHeadRight}>{t('paymentAccounts.colBalance')}</th>
              {canWrite && <th className={reportTableHead} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {visibleMethods.map((m) => {
              const account = m.account as any;
              const bal = normalBalance({ balance: account?.balance ?? 0, account_type: 'asset' });
              return (
                <tr key={m.id} className={cn('hover:bg-slate-50/80 dark:hover:bg-slate-800/50', !m.is_active && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">{account?.code ?? '—'}</code>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {m.label}
                    {m.is_system && (
                      <span className="ml-1.5 text-[10px] text-slate-400 uppercase tracking-wide">system</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">{m.account_number ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{m.account_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs capitalize">{m.slug.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <Switch
                        checked={m.is_active}
                        onCheckedChange={(v) => toggleActive({ m, active: v })}
                        className="data-[state=checked]:bg-emerald-500"
                        title={m.is_active ? 'Disable' : 'Enable'}
                      />
                    ) : (
                      <Badge className={m.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-blue-600">
                    {fmt(bal)}
                  </td>
                  {canWrite && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          type="button"
                          onClick={() => openEdit(m)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {!m.is_system && m.slug !== 'cash' && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(m)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {visibleMethods.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-10 text-slate-400 text-sm">
                  {t('paymentAccounts.noMethods')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>

      {/* ── Add dialog ── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('paymentAccounts.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('paymentAccounts.dialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium text-slate-700">{t('paymentAccounts.labelDisplayName')}</Label>
              <Input
                placeholder={t('paymentAccounts.displayNamePlaceholder')}
                value={label}
                onChange={(e) => handleLabelChange(e.target.value)}
                className="mt-1.5 h-11"
                autoFocus
              />
              <p className="text-xs text-slate-400 mt-1">{t('paymentAccounts.displayNameNote')}</p>
            </div>
            {slug && (
              <details className="group">
                <summary className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer select-none list-none flex items-center gap-1">
                  <span className="group-open:rotate-90 transition-transform">▸</span> {t('paymentAccounts.labelSlug')}: <code className="bg-slate-100 rounded px-1">{slug}</code>
                </summary>
                <div className="mt-2">
                  <Input
                    placeholder={t('paymentAccounts.slugPlaceholder')}
                    value={slug}
                    onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/\s+/g, '_')); }}
                    className="h-11"
                  />
                  <p className="text-xs text-slate-400 mt-1">{t('paymentAccounts.slugNote')}</p>
                </div>
              </details>
            )}
            <div className="rounded-xl border border-slate-200 p-3.5 space-y-3 dark:border-slate-700">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="create-acct"
                  checked={createAccount}
                  onCheckedChange={(v) => setCreateAccount(v === true)}
                  className="mt-0.5"
                />
                <div>
                  <Label htmlFor="create-acct" className="cursor-pointer font-medium text-sm">
                    {t('paymentAccounts.createAccountLabel')}
                  </Label>
                  <p className="text-xs text-slate-500 mt-0.5">{t('paymentAccounts.createAccountNote')}</p>
                </div>
              </div>
              {!createAccount && (
                <div>
                  <Label className="text-sm font-medium text-slate-700">{t('paymentAccounts.labelLinkAccount')}</Label>
                  <Select
                    items={assetSelectItems}
                    value={linkAccountId || 'none'}
                    onValueChange={(v) => setLinkAccountId(v === 'none' ? '' : v ?? '')}
                  >
                    <SelectTrigger className="mt-1.5 h-11 w-full">
                      <SelectValue placeholder={t('paymentAccounts.selectAccount')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('paymentAccounts.selectAccount')}</SelectItem>
                      {assetAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id} label={`${a.code} — ${a.name}`}>
                          {a.code} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <Button className="w-full h-11" disabled={creating || !canSubmitAdd} onClick={() => createMethod()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {createAccount ? t('paymentAccounts.submitWithAccount') : t('paymentAccounts.submitNoAccount')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editState} onOpenChange={(v) => !v && setEditState(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Payment Method</DialogTitle>
            <DialogDescription>Update the details for this payment method.</DialogDescription>
          </DialogHeader>
          {editState && (
            <div className="space-y-4">
              {/* Linked GL account (read-only) */}
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 space-y-0.5">
                <p className="text-xs text-slate-500">Linked GL Account</p>
                <p className="text-sm font-medium text-slate-800">
                  <code className="bg-slate-200 rounded px-1 text-xs mr-2">{editState.account_code}</code>
                  {editState.account_gl_name}
                </p>
              </div>

              <div>
                <Label className="text-sm font-medium text-slate-700">Display Name <span className="text-red-500">*</span></Label>
                <Input
                  value={editState.label}
                  onChange={(e) => setEditState((s) => s ? { ...s, label: e.target.value } : s)}
                  className="mt-1.5 h-11"
                  placeholder="e.g. EVC Plus, Bank Transfer…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-medium text-slate-700">Account Number</Label>
                  <Input
                    value={editState.account_number}
                    onChange={(e) => setEditState((s) => s ? { ...s, account_number: e.target.value } : s)}
                    className="mt-1.5 h-11"
                    placeholder="e.g. 0615001234"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-700">Account Holder Name</Label>
                  <Input
                    value={editState.account_name}
                    onChange={(e) => setEditState((s) => s ? { ...s, account_name: e.target.value } : s)}
                    className="mt-1.5 h-11"
                    placeholder="e.g. Ali Ahmed"
                  />
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium text-slate-700">Description (optional)</Label>
                <Textarea
                  value={editState.description}
                  onChange={(e) => setEditState((s) => s ? { ...s, description: e.target.value } : s)}
                  className="mt-1.5 resize-none min-h-[72px]"
                  placeholder="Any notes about this payment method…"
                />
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <Switch
                  id="edit-active"
                  checked={editState.is_active}
                  onCheckedChange={(v) => setEditState((s) => s ? { ...s, is_active: v } : s)}
                  className="data-[state=checked]:bg-emerald-500"
                />
                <Label htmlFor="edit-active" className="cursor-pointer">
                  {editState.is_active ? 'Active — visible in checkout' : 'Inactive — hidden from checkout'}
                </Label>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setEditState(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-11"
                  disabled={saving || !editState.label.trim()}
                  onClick={() => saveEdit()}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Payment Method</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.label}</strong>?
              This cannot be undone. The linked GL account will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleting}
              onClick={() => deleteTarget && doDelete(deleteTarget.id)}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
