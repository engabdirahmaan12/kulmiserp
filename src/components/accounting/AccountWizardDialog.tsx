'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import type { Account, AccountType } from '@/types';
import {
  WIZARD_ACCOUNT_TYPES,
  suggestAccountCode,
  validateAccountCodeFormat,
  isAccountCodeTaken,
  normalizeAccountCode,
} from '@/lib/accounting/coa-constants';
import { toSelectItems } from '@/lib/ui/select-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

export type AccountWizardForm = {
  name: string;
  code: string;
  accountType: AccountType;
  description: string;
  parentId: string;
};

export const emptyWizardForm = (): AccountWizardForm => ({
  name: '',
  code: '',
  accountType: 'expense',
  description: '',
  parentId: '',
});

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  form: AccountWizardForm;
  setForm: (f: AccountWizardForm) => void;
  allAccounts: Account[];
  parentOptions: Account[];
  excludeAccountId?: string;
  lockAccountType?: boolean;
  submitting?: boolean;
  onSubmit: () => void;
};

export function AccountWizardDialog({
  open,
  onOpenChange,
  mode,
  form,
  setForm,
  allAccounts,
  parentOptions,
  excludeAccountId,
  lockAccountType = false,
  submitting = false,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const parentSelectItems = useMemo(
    () => toSelectItems(parentOptions, (a) => a.id, (a) => `${a.code} — ${a.name}`, [{ value: 'none', label: t('accountWizard.noneOption') }]),
    [parentOptions, t],
  );

  const codeError = form.code ? validateAccountCodeFormat(form.code) : null;
  const duplicate = form.code ? isAccountCodeTaken(allAccounts, form.code, excludeAccountId) : false;
  const canSubmit = !!form.name && !!form.code && !codeError && !duplicate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('accountWizard.titleCreate') : t('accountWizard.titleEdit')}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? t('accountWizard.descCreate')
              : lockAccountType
                ? t('accountWizard.descEditLocked')
                : t('accountWizard.descEditUnlocked')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label htmlFor="coa-name" className="text-sm font-medium text-slate-700">{t('accountWizard.labelName')}</Label>
            <Input
              id="coa-name"
              placeholder={t('accountWizard.namePlaceholder')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1.5 h-11"
              autoFocus
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="coa-code" className="text-sm font-medium text-slate-700">{t('accountWizard.labelNumber')}</Label>
                <button
                  type="button"
                  className="text-[10px] font-semibold text-blue-600 hover:underline"
                  onClick={() => setForm({ ...form, code: suggestAccountCode(allAccounts, form.accountType) })}
                >
                  {t('accountWizard.suggestBtn')}
                </button>
              </div>
              <Input
                id="coa-code"
                placeholder="1010, BANK-001"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={`mt-1.5 h-11 ${codeError || duplicate ? 'border-red-500' : ''}`}
              />
              {codeError && <p className="text-xs text-red-500 mt-1">{codeError}</p>}
              {!codeError && duplicate && (
                <p className="text-xs text-red-500 mt-1">{t('accountWizard.errDuplicate')}</p>
              )}
            </div>
            <div>
              <Label className="text-sm font-medium text-slate-700">{t('accountWizard.labelType')}</Label>
              <Select
                value={form.accountType}
                disabled={lockAccountType}
                onValueChange={(v) => {
                  const type = v as AccountType;
                  setForm({
                    ...form,
                    accountType: type,
                    code: suggestAccountCode(allAccounts, type),
                  });
                }}
              >
                <SelectTrigger className="mt-1.5 h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WIZARD_ACCOUNT_TYPES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="coa-desc" className="text-sm font-medium text-slate-700">{t('accountWizard.labelDesc')} <span className="text-slate-400 font-normal">{t('accountWizard.descOptional')}</span></Label>
            <Textarea
              id="coa-desc"
              rows={2}
              placeholder={t('accountWizard.descPlaceholder')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1.5 resize-none"
            />
          </div>

          <div>
            <Label className="text-sm font-medium text-slate-700">{t('accountWizard.labelParent')} <span className="text-slate-400 font-normal">{t('accountWizard.descOptional')}</span></Label>
            <Select
              items={parentSelectItems}
              value={form.parentId || 'none'}
              onValueChange={(v) => setForm({ ...form, parentId: v === 'none' ? '' : v ?? '' })}
            >
              <SelectTrigger className="mt-1.5 h-11 w-full"><SelectValue placeholder={t('accountWizard.noneOption')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('accountWizard.noneOption')}</SelectItem>
                {parentOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button className="w-full h-11" disabled={submitting || !canSubmit} onClick={onSubmit}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === 'create' ? t('accountWizard.submitCreate') : t('accountWizard.submitEdit')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export { normalizeAccountCode };
