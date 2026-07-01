'use client';

import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { useAccountingAccounts } from '@/lib/accounting/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Search, Layers, User } from 'lucide-react';
import { toast } from 'sonner';
import type { Account, AccountType } from '@/types';
import { buildAccountTree, flattenAccountTree } from '@/lib/accounting/utils';
import { canWriteAccounting, invalidateAccountingQueries } from '@/lib/accounting/permissions';
import {
  isProtectedAccount,
  splitAccounts,
  filterAccounts,
  shouldShowInEssentialView,
  isLegacySampleAccount,
  suggestAccountCode,
  normalizeAccountCode,
  validateAccountCodeFormat,
  isAccountCodeTaken,
} from '@/lib/accounting/coa-constants';
import { CoaAccountSection } from '@/components/accounting/CoaAccountSection';
import {
  AccountWizardDialog,
  emptyWizardForm,
  type AccountWizardForm,
} from '@/components/accounting/AccountWizardDialog';
import { useTranslation } from '@/lib/i18n/useTranslation';

const TYPE_FILTER_KEYS: { value: AccountType | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'coa.filterAll' },
  { value: 'asset', labelKey: 'coa.filterAsset' },
  { value: 'liability', labelKey: 'coa.filterLiability' },
  { value: 'equity', labelKey: 'coa.filterEquity' },
  { value: 'revenue', labelKey: 'coa.filterRevenue' },
  { value: 'expense', labelKey: 'coa.filterExpense' },
  { value: 'cogs', labelKey: 'coa.filterCogs' },
];

function toTreeRows(accounts: Account[]) {
  return flattenAccountTree(buildAccountTree(accounts));
}

export function ChartOfAccountsTab() {
  const { currentStore, user, storeUser } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canWrite = canWriteAccounting(storeUser?.role);
  const [showArchived, setShowArchived] = useState(false);
  const [simpleView, setSimpleView] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AccountType | 'all'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [form, setForm] = useState<AccountWizardForm>(emptyWizardForm());
  const [editForm, setEditForm] = useState<AccountWizardForm>(emptyWizardForm());

  const { accounts: activeAccounts, isLoading: loadingActive } = useAccountingAccounts();
  const { accounts: archivedAccounts, isLoading: loadingArchived } = useAccountingAccounts({ includeArchived: true });

  const accounts = showArchived
    ? archivedAccounts.filter((a) => a.is_active === false)
    : activeAccounts;

  const isLoading = showArchived ? loadingArchived : loadingActive;
  const currency = currentStore?.currency || 'USD';

  const { system, auxiliary, user: userAccounts } = useMemo(() => splitAccounts(accounts), [accounts]);

  const visibleSystem = useMemo(() => {
    if (showArchived || !simpleView) return system;
    return system.filter(shouldShowInEssentialView);
  }, [system, showArchived, simpleView]);

  const visibleUser = useMemo(() => {
    if (showArchived || !simpleView) return userAccounts;
    return userAccounts.filter((a) => !isLegacySampleAccount(a));
  }, [userAccounts, showArchived, simpleView]);

  const filteredSystem = useMemo(() => filterAccounts(visibleSystem, search, typeFilter), [visibleSystem, search, typeFilter]);
  const filteredAuxiliary = useMemo(() => filterAccounts(auxiliary, search, typeFilter), [auxiliary, search, typeFilter]);
  const filteredUser = useMemo(() => filterAccounts(visibleUser, search, typeFilter), [visibleUser, search, typeFilter]);

  const systemRows = useMemo(() => toTreeRows(filteredSystem), [filteredSystem]);
  const auxiliaryRows = useMemo(() => toTreeRows(filteredAuxiliary), [filteredAuxiliary]);
  const userRows = useMemo(() => toTreeRows(filteredUser), [filteredUser]);
  const archivedRows = useMemo(() => toTreeRows(filteredUser), [filteredUser]);

  const parentOptions = activeAccounts.filter((a) => a.is_active !== false);

  const invalidate = () => invalidateAccountingQueries(queryClient, currentStore?.id);

  const { mutate: createAccount, isPending: creating } = useMutation({
    mutationFn: async () => {
      const formatErr = validateAccountCodeFormat(form.code);
      if (formatErr) throw new Error(formatErr);
      if (isAccountCodeTaken(activeAccounts, form.code)) {
        throw new Error('Account number already exists.');
      }
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_chart_account', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_code: normalizeAccountCode(form.code),
        p_name: form.name,
        p_account_type: form.accountType,
        p_parent_id: form.parentId || null,
        p_description: form.description || null,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      invalidate();
      toast.success('Account created');
      setShowAdd(false);
      setForm(emptyWizardForm());
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: updateAccount, isPending: updating } = useMutation({
    mutationFn: async () => {
      const formatErr = validateAccountCodeFormat(editForm.code);
      if (formatErr) throw new Error(formatErr);
      if (isAccountCodeTaken(activeAccounts, editForm.code, editAccount!.id)) {
        throw new Error('Account number already exists.');
      }
      const supabase = createClient();
      const protectedAcct = isProtectedAccount(editAccount!);
      const { data, error } = await supabase.rpc('update_chart_account', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_account_id: editAccount!.id,
        p_name: editForm.name,
        p_code: normalizeAccountCode(editForm.code),
        p_description: editForm.description || null,
        p_parent_id: editForm.parentId || null,
        p_account_type: protectedAcct ? null : editForm.accountType,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string; code_changed?: boolean; old_code?: string; new_code?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
      return res;
    },
    onSuccess: (res) => {
      invalidate();
      if (res?.code_changed) {
        toast.success(`Account number updated: ${res.old_code} → ${res.new_code}`);
      } else {
        toast.success('Account updated');
      }
      setEditAccount(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: archiveAccount } = useMutation({
    mutationFn: async (accountId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('archive_chart_account', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_account_id: accountId,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      invalidate();
      toast.success('Account archived');
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: restoreAccount } = useMutation({
    mutationFn: async (accountId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('restore_chart_account', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_account_id: accountId,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      invalidate();
      toast.success('Account restored');
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: deleteAccount } = useMutation({
    mutationFn: async (accountId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('delete_chart_account', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_account_id: accountId,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      invalidate();
      toast.success('Account deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  const openAdd = () => {
    setForm({
      ...emptyWizardForm(),
      code: suggestAccountCode(activeAccounts, 'expense'),
    });
    setShowAdd(true);
  };

  const openEdit = (account: Account) => {
    setEditAccount(account);
    setEditForm({
      code: account.code,
      name: account.name,
      description: account.description || '',
      accountType: account.account_type,
      parentId: account.parent_id || '',
    });
  };

  const handleDelete = (account: Account) => {
    if (confirm(`Delete ${account.code} — ${account.name}? Only allowed when balance is zero and there are no transactions.`)) {
      deleteAccount(account.id);
    }
  };

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('coa.title')}</h3>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
            {t('coa.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!showArchived && (
            <Button variant="outline" size="sm" onClick={() => setSimpleView((v) => !v)}>
              {simpleView ? t('coa.showAll') : t('coa.simpleView')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? t('coa.activeAccounts') : t('coa.archiveView')}
          </Button>
          {canWrite && !showArchived && (
            <Button onClick={openAdd} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> {t('coa.addAccount')}
            </Button>
          )}
        </div>
      </div>

      {!showArchived && simpleView && (
        <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 dark:bg-blue-950/30 dark:text-blue-400">
          {t('coa.simpleViewNote')}
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder={t('coa.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as AccountType | 'all')}>
          <SelectTrigger className="h-10 w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TYPE_FILTER_KEYS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{t(f.labelKey as Parameters<typeof t>[0])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showArchived ? (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('coa.archivedSection')}</h4>
          <CoaAccountSection
            rows={archivedRows}
            currency={currency}
            canWrite={canWrite}
            showArchived
            emptyMessage={t('coa.noArchived')}
            onEdit={openEdit}
            onArchive={archiveAccount}
            onDelete={handleDelete}
            onRestore={restoreAccount}
          />
        </section>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-600" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('coa.systemSection')}</h4>
              <span className="text-[10px] text-slate-400">{t('coa.systemNote')}</span>
            </div>
            <CoaAccountSection
              rows={systemRows}
              currency={currency}
              canWrite={canWrite}
              showArchived={false}
              emptyMessage={t('coa.noSystem')}
              onEdit={openEdit}
              onArchive={archiveAccount}
              onDelete={handleDelete}
              onRestore={restoreAccount}
            />
          </section>

          {!simpleView && auxiliaryRows.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-slate-500" />
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('coa.auxSection')}</h4>
                <span className="text-[10px] text-slate-400">{t('coa.auxNote')}</span>
              </div>
              <CoaAccountSection
                rows={auxiliaryRows}
                currency={currency}
                canWrite={canWrite}
                showArchived={false}
                emptyMessage=""
                onEdit={openEdit}
                onArchive={archiveAccount}
                onDelete={handleDelete}
                onRestore={restoreAccount}
              />
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-emerald-600" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('coa.userSection')}</h4>
              <span className="text-[10px] text-slate-400">{t('coa.userNote')}</span>
            </div>
            <CoaAccountSection
              rows={userRows}
              currency={currency}
              canWrite={canWrite}
              showArchived={false}
              emptyMessage={t('coa.noCustom')}
              onEdit={openEdit}
              onArchive={archiveAccount}
              onDelete={handleDelete}
              onRestore={restoreAccount}
            />
          </section>
        </>
      )}

      <AccountWizardDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        mode="create"
        form={form}
        setForm={setForm}
        allAccounts={activeAccounts}
        parentOptions={parentOptions}
        submitting={creating}
        onSubmit={() => createAccount()}
      />

      <AccountWizardDialog
        open={!!editAccount}
        onOpenChange={(open) => { if (!open) setEditAccount(null); }}
        mode="edit"
        form={editForm}
        setForm={setEditForm}
        allAccounts={activeAccounts}
        parentOptions={parentOptions.filter((a) => a.id !== editAccount?.id)}
        excludeAccountId={editAccount?.id}
        lockAccountType={!!editAccount && isProtectedAccount(editAccount)}
        submitting={updating}
        onSubmit={() => updateAccount()}
      />
    </div>
  );
}
