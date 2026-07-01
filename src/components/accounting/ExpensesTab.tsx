'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Receipt, Loader2, ArrowLeft, Upload, Check, X, ExternalLink, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { Expense } from '@/types';
import { useClosedPeriods } from '@/lib/accounting/hooks';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';

const expenseSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  category: z.string().optional(),
  payment_method: z.string().default('cash'),
  expense_date: z.string().default(() => new Date().toISOString().split('T')[0]),
  reference: z.string().optional(),
});

type ExpenseForm = z.infer<typeof expenseSchema>;

const EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Salaries', 'Marketing', 'Supplies',
  'Transport', 'Insurance', 'Maintenance', 'Food', 'Other',
];

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700',
  rejected: 'bg-red-50 text-red-700',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', waafi: 'WAAFI', evc: 'EVC', bank: 'Bank', credit: 'Credit',
};

interface ExpensesTabProps {
  highlightExpenseId?: string | null;
  /** Where expense detail URLs should point (standalone page vs accounting tab). */
  linkMode?: 'standalone' | 'accounting';
}

export function ExpensesTab({ highlightExpenseId = null, linkMode = 'standalone' }: ExpensesTabProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { currentStore, user, storeUser } = useAuthStore();
  const queryClient = useQueryClient();
  const canApprove = storeUser?.role === 'owner' || storeUser?.role === 'accountant';
  const { isDateClosed } = useClosedPeriods();
  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const methodOptions = storePaymentMethods.length > 0
    ? storePaymentMethods.filter((m) => m.slug !== 'customer_deposit' && m.is_active)
    : [
        { slug: 'cash', label: 'Cash' },
        { slug: 'bank', label: 'Bank Transfer' },
        { slug: 'evc',  label: 'EVC Plus' },
      ];

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('expenses')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('expense_date', { ascending: false })
        .limit(100);
      return data as Expense[];
    },
    enabled: !!currentStore,
  });

  const expenseInList = highlightExpenseId
    ? expenses.find((e) => e.id === highlightExpenseId)
    : undefined;

  const { data: linkedExpense } = useQuery({
    queryKey: ['expense-link', currentStore?.id, highlightExpenseId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('store_id', currentStore!.id)
        .eq('id', highlightExpenseId!)
        .single();
      if (error) throw error;
      return data as Expense;
    },
    enabled: !!currentStore && !!highlightExpenseId && !expenseInList,
  });

  useEffect(() => {
    if (!highlightExpenseId) return;
    const expense = expenseInList ?? linkedExpense;
    if (expense) setSelectedExpense(expense);
  }, [highlightExpenseId, expenseInList, linkedExpense]);

  const expenseListPath =
    linkMode === 'accounting' ? '/dashboard/accounting?tab=expenses' : '/dashboard/expenses';

  const openExpense = (expense: Expense) => {
    setSelectedExpense(expense);
    const url =
      linkMode === 'accounting'
        ? `/dashboard/accounting?tab=expenses&expense=${expense.id}`
        : `/dashboard/expenses?expense=${expense.id}`;
    router.push(url);
  };

  const closeExpenseDetail = () => {
    setSelectedExpense(null);
    if (highlightExpenseId) router.replace(expenseListPath);
  };

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<ExpenseForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(expenseSchema) as any,
    defaultValues: {
      payment_method: 'cash',
      expense_date: new Date().toISOString().split('T')[0],
    },
  });

  const uploadReceipt = async (file: File): Promise<string | null> => {
    const supabase = createClient();
    const ext = file.name.split('.').pop();
    const path = `${currentStore!.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('expense-receipts').upload(path, file, { upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from('expense-receipts').getPublicUrl(path);
    return data.publicUrl;
  };

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: ExpenseForm) => {
      let receiptUrl: string | null = null;
      if (receiptFile) receiptUrl = await uploadReceipt(receiptFile);

      const supabase = createClient();
      const { data: result, error } = await supabase.rpc('record_expense', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_description: data.description,
        p_amount: data.amount,
        p_category: data.category || null,
        p_payment_method: data.payment_method,
        p_expense_date: data.expense_date,
        p_reference: data.reference || null,
        p_receipt_url: receiptUrl,
        p_auto_approve: canApprove,
      });
      if (error) throw error;
      const res = result as { success?: boolean; error?: string; status?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed to record expense');
      return res.status;
    },
    onSuccess: (status) => {
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs', currentStore?.id] });
      toast.success(status === 'pending' ? t('expenses.submittedForApproval') : t('expenses.recordedAndPosted'));
      setShowForm(false);
      setReceiptFile(null);
      reset();
    },
    onError: (e) => toast.error('Failed: ' + e.message),
  });

  const { mutate: approveExpense } = useMutation({
    mutationFn: async (expenseId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('approve_expense', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_expense_id: expenseId,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      toast.success(t('expenses.approvedAndPosted'));
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: rejectExpense } = useMutation({
    mutationFn: async (expenseId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('reject_expense', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_expense_id: expenseId,
        p_reason: 'Rejected by manager',
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', currentStore?.id] });
      toast.success(t('expenses.rejected'));
    },
    onError: (e) => toast.error(e.message),
  });

  const currency = currentStore?.currency || 'USD';
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(n);
  const approvedTotal = expenses.filter((e) => e.status !== 'rejected').reduce((s, e) => s + e.amount, 0);
  const pendingCount = expenses.filter((e) => e.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('expenses.title')}</h3>
          <p className="text-sm text-slate-500">
            {t('expenses.totalLabel', { currency, amount: fmt(approvedTotal) })}
            {pendingCount > 0 && (
              <Badge className="ml-2 bg-amber-50 text-amber-700">{t('expenses.pendingBadge', { count: pendingCount })}</Badge>
            )}
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40 gap-2">
          <Plus className="h-4 w-4" />
          {t('expenses.addExpense')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('expenses.colDescription')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden sm:table-cell">{t('expenses.colStatus')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden md:table-cell">{t('expenses.colDate')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('expenses.colAmount')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600 uppercase w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenses.map((expense) => (
                <tr
                  key={expense.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => openExpense(expense)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50">
                        <Receipt className="h-4 w-4 text-orange-500" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{expense.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {expense.category && <span className="text-xs text-slate-400">{expense.category}</span>}
                          {expense.receipt_url && (
                            <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 flex items-center gap-0.5">
                              <ExternalLink className="h-3 w-3" /> {t('expenses.receipt')}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <Badge className={STATUS_BADGE[expense.status || 'approved'] || STATUS_BADGE.approved}>
                      {expense.status || 'approved'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                    {format(new Date(expense.expense_date), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white tabular-nums">
                    {currency} {fmt(expense.amount)}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {canApprove && expense.status === 'pending' && (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600" onClick={() => approveExpense(expense.id)}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => rejectExpense(expense.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">
                    {t('expenses.noExpenses')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-orange-500" />
                {t('expenses.dialogTitle')}
              </DialogTitle>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t('expenses.descriptionLabel')}</Label>
              <Input {...register('description')} placeholder={t('expenses.descriptionPlaceholder')} className="h-11" />
              {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">{t('expenses.amountLabel')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  {...register('amount', { valueAsNumber: true })}
                  placeholder="0.00"
                  className="h-12 text-lg font-semibold tabular-nums"
                />
                {errors.amount && <p className="text-xs text-red-500">{errors.amount.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">{t('expenses.dateLabel')}</Label>
                <Input
                  type="date"
                  {...register('expense_date')}
                  onChange={(e) => {
                    setExpenseDate(e.target.value);
                    register('expense_date').onChange(e);
                  }}
                  className="h-11"
                />
                {isDateClosed(expenseDate) && (
                  <div className="flex items-start gap-1.5 rounded-lg bg-red-50 border border-red-200 px-2 py-1.5 mt-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{t('expenses.closedPeriod')}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">{t('expenses.categoryLabel')}</Label>
                <Select onValueChange={(v: string | null) => setValue('category', v ?? undefined)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t('expenses.categoryPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">{t('expenses.paymentMethodLabel')}</Label>
                <Select defaultValue="cash" onValueChange={(v: string | null) => setValue('payment_method', v ?? 'cash')}>
                  <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {methodOptions.map((m) => (
                      <SelectItem key={m.slug} value={m.slug}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t('expenses.receiptLabel')}</Label>
              <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
              <Button type="button" variant="outline" className="w-full h-11 gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" />
                {receiptFile ? receiptFile.name : t('expenses.uploadReceipt')}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">{t('expenses.referenceLabel')}</Label>
              <Input {...register('reference')} placeholder={t('expenses.referencePlaceholder')} className="h-11" />
            </div>

            {!canApprove && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                {t('expenses.approvalNote')}
              </p>
            )}

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setShowForm(false)}>{t('expenses.cancelButton')}</Button>
              <Button type="submit" className="flex-1 h-11 bg-gradient-to-r from-blue-600 to-indigo-600" disabled={isPending || !!isDateClosed(expenseDate)}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {canApprove ? t('expenses.savePost') : t('expenses.submitApproval')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={!!selectedExpense} onOpenChange={(open) => !open && closeExpenseDetail()}>
        <SheetContent className="w-full sm:max-w-md">
          {selectedExpense && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base font-bold pr-8">{t('expenses.detailsTitle')}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
                <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t('expenses.detailDescription')}</span>
                    <span className="font-medium text-right text-slate-900">{selectedExpense.description}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t('expenses.detailAmount')}</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {currency} {fmt(selectedExpense.amount)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t('expenses.detailDate')}</span>
                    <span>{format(new Date(selectedExpense.expense_date), 'MMM d, yyyy')}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t('expenses.detailCategory')}</span>
                    <span>{selectedExpense.category ?? '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t('expenses.detailPayment')}</span>
                    <span>{PAYMENT_LABELS[selectedExpense.payment_method ?? ''] ?? selectedExpense.payment_method ?? '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3 items-center">
                    <span className="text-slate-500">{t('expenses.detailStatus')}</span>
                    <Badge className={STATUS_BADGE[selectedExpense.status || 'approved'] || STATUS_BADGE.approved}>
                      {selectedExpense.status || 'approved'}
                    </Badge>
                  </div>
                  {selectedExpense.reference && (
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">{t('expenses.detailReference')}</span>
                      <span className="font-mono text-xs">{selectedExpense.reference}</span>
                    </div>
                  )}
                  {selectedExpense.rejection_reason && (
                    <div>
                      <p className="text-slate-500 mb-1">{t('expenses.detailRejectionReason')}</p>
                      <p className="text-red-600">{selectedExpense.rejection_reason}</p>
                    </div>
                  )}
                  {selectedExpense.receipt_url && (
                    <a
                      href={selectedExpense.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs font-medium"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> {t('expenses.viewReceipt')}
                    </a>
                  )}
                </div>
                {canApprove && selectedExpense.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => approveExpense(selectedExpense.id)}
                    >
                      <Check className="h-4 w-4 mr-1" /> {t('expenses.approve')}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 text-red-600"
                      onClick={() => rejectExpense(selectedExpense.id)}
                    >
                      <X className="h-4 w-4 mr-1" /> {t('expenses.reject')}
                    </Button>
                  </div>
                )}
                <Button variant="ghost" className="w-full" onClick={closeExpenseDetail}>{t('expenses.closeButton')}</Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
