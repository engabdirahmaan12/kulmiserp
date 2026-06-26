'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Loader2, ArrowLeftRight, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { FundTransfer } from '@/types';
import { canWriteAccounting, invalidateAccountingQueries } from '@/lib/accounting/permissions';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';

export function FundTransfersTab() {
  const { currentStore, user, storeUser } = useAuthStore();
  const queryClient = useQueryClient();
  const canWrite = canWriteAccounting(storeUser?.role);

  const [showAdd,   setShowAdd]   = useState(false);
  const [fromDate,  setFromDate]  = useState('');
  const [toDate,    setToDate]    = useState('');

  // Form state
  const [fromMethod,  setFromMethod]  = useState('');
  const [toMethod,    setToMethod]    = useState('');
  const [amount,      setAmount]      = useState('');
  const [reference,   setReference]   = useState('');
  const [notes,       setNotes]       = useState('');

  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const methodOptions = storePaymentMethods.length > 0
    ? storePaymentMethods.filter((m) => m.slug !== 'customer_deposit' && m.is_active)
    : [
        { slug: 'cash',  label: 'Cash'  },
        { slug: 'bank',  label: 'Bank'  },
        { slug: 'evc',   label: 'EVC Plus' },
        { slug: 'waafi', label: 'WAAFI' },
      ];

  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data, isLoading } = useQuery({
    queryKey: ['fund-transfers', currentStore?.id, fromDate, toDate],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('list_fund_transfers', {
        p_store_id:  currentStore!.id,
        p_from_date: fromDate ? new Date(fromDate).toISOString() : null,
        p_to_date:   toDate   ? new Date(toDate + 'T23:59:59').toISOString() : null,
        p_limit:     200,
      });
      if (error) throw error;
      const result = data as { success: boolean; transfers: FundTransfer[]; total_amount: number; error?: string };
      if (!result.success) throw new Error(result.error ?? 'Failed to load transfers');
      return result;
    },
    enabled: !!currentStore,
  });

  const transfers  = data?.transfers  ?? [];
  const totalAmt   = data?.total_amount ?? 0;

  const resetForm = () => {
    setFromMethod('');
    setToMethod('');
    setAmount('');
    setReference('');
    setNotes('');
  };

  const parsedAmt = parseFloat(amount) || 0;
  const canSubmit = !!fromMethod && !!toMethod && fromMethod !== toMethod && parsedAmt > 0;

  const { mutate: createTransfer, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error('Not authenticated');
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_fund_transfer', {
        p_store_id:    currentStore.id,
        p_user_id:     user.id,
        p_from_method: fromMethod,
        p_to_method:   toMethod,
        p_amount:      parsedAmt,
        p_reference:   reference || null,
        p_notes:       notes || null,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error ?? 'Transfer failed');
      return result;
    },
    onSuccess: () => {
      invalidateAccountingQueries(queryClient, currentStore?.id);
      queryClient.invalidateQueries({ queryKey: ['fund-transfers', currentStore?.id] });
      toast.success('Fund transfer recorded successfully');
      setShowAdd(false);
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const labelFor = (slug: string) =>
    methodOptions.find((m) => m.slug === slug)?.label ?? slug.replace(/_/g, ' ');

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-blue-600" /> Fund Transfers
          </h3>
          <p className="text-xs text-slate-500">Transfer money between payment accounts with automatic GL posting</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
            {fmt(totalAmt)} transferred
          </Badge>
          {canWrite && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" /> New Transfer
            </Button>
          )}
        </div>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-500 whitespace-nowrap">From:</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-36 text-xs" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-slate-500 whitespace-nowrap">To:</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-36 text-xs" />
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setFromDate(''); setToDate(''); }}>
          Clear
        </Button>
      </div>

      {/* Table */}
      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>Date</th>
              <th className={reportTableHead}>From</th>
              <th className={reportTableHead}></th>
              <th className={reportTableHead}>To</th>
              <th className={reportTableHead}>Reference</th>
              <th className={reportTableHead}>Notes</th>
              <th className={reportTableHeadRight}>Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {transfers.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                  {format(new Date(t.transfer_date), 'MMM d, yyyy HH:mm')}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 capitalize">
                    {labelFor(t.from_method)}
                  </span>
                </td>
                <td className="px-2 py-3 text-slate-400">
                  <ArrowRight className="h-3.5 w-3.5" />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 capitalize">
                    {labelFor(t.to_method)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs font-mono">{t.reference ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{t.notes ?? '—'}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-blue-600">{fmt(t.amount)}</td>
              </tr>
            ))}
            {transfers.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-400 text-sm">
                  No fund transfers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>

      {/* Add Transfer dialog */}
      <Dialog open={showAdd} onOpenChange={(v) => { if (!v) { setShowAdd(false); resetForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-blue-600" /> New Fund Transfer
            </DialogTitle>
            <DialogDescription>
              Transfer money between accounts. GL entries are created automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From Account <span className="text-red-500">*</span></Label>
                <Select value={fromMethod} onValueChange={(v) => v && setFromMethod(v)}>
                  <SelectTrigger className="mt-1 h-10">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {methodOptions
                      .filter((m) => m.slug !== toMethod)
                      .map((m) => (
                        <SelectItem key={m.slug} value={m.slug}>{m.label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To Account <span className="text-red-500">*</span></Label>
                <Select value={toMethod} onValueChange={(v) => v && setToMethod(v)}>
                  <SelectTrigger className="mt-1 h-10">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {methodOptions
                      .filter((m) => m.slug !== fromMethod)
                      .map((m) => (
                        <SelectItem key={m.slug} value={m.slug}>{m.label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {fromMethod && toMethod && fromMethod !== toMethod && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                <span className="font-medium capitalize">{labelFor(fromMethod)}</span>
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span className="font-medium capitalize">{labelFor(toMethod)}</span>
              </div>
            )}

            <div>
              <Label>Amount <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1 h-12 text-lg font-semibold tabular-nums"
                autoFocus
              />
            </div>

            <div>
              <Label>Reference (optional)</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Transaction ID, receipt #…"
                className="mt-1 h-10"
              />
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes…"
                className="mt-1 resize-none min-h-[64px]"
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setShowAdd(false); resetForm(); }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                disabled={isPending || !canSubmit}
                onClick={() => createTransfer()}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Transfer Funds
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
