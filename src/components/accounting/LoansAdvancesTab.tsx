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
import { Plus, Loader2, Users, Truck, Banknote, ArrowDownLeft } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { EmployeeLoan, SupplierAdvance } from '@/types';
import { canWriteAccounting, invalidateAccountingQueries } from '@/lib/accounting/permissions';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';

type Segment = 'employee' | 'supplier';

const STATUS_BADGE: Record<string, string> = {
  outstanding: 'bg-amber-100 text-amber-700',
  partial: 'bg-orange-100 text-orange-700',
  settled: 'bg-emerald-100 text-emerald-700',
};

export function LoansAdvancesTab() {
  const { currentStore, storeUser } = useAuthStore();
  const queryClient = useQueryClient();
  const canWrite = canWriteAccounting(storeUser?.role);

  const [segment, setSegment] = useState<Segment>('employee');
  const [showCreate, setShowCreate] = useState(false);
  const [settleTarget, setSettleTarget] = useState<EmployeeLoan | SupplierAdvance | null>(null);

  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  // ── Lists ────────────────────────────────────────────────
  const empLoansQuery = useQuery({
    queryKey: ['employee-loans', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('list_employee_loans', { p_store_id: currentStore!.id });
      if (error) throw error;
      return data as { success: boolean; loans: EmployeeLoan[]; total_outstanding: number; error?: string };
    },
    enabled: !!currentStore && segment === 'employee',
  });

  const supAdvQuery = useQuery({
    queryKey: ['supplier-advances', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('list_supplier_advances', { p_store_id: currentStore!.id });
      if (error) throw error;
      return data as { success: boolean; advances: SupplierAdvance[]; total_outstanding: number; error?: string };
    },
    enabled: !!currentStore && segment === 'supplier',
  });

  const isLoading = segment === 'employee' ? empLoansQuery.isLoading : supAdvQuery.isLoading;
  const totalOutstanding =
    segment === 'employee'
      ? empLoansQuery.data?.total_outstanding ?? 0
      : supAdvQuery.data?.total_outstanding ?? 0;
  const empLoans = empLoansQuery.data?.loans ?? [];
  const supAdvances = supAdvQuery.data?.advances ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            {segment === 'employee'
              ? <><Users className="h-4 w-4 text-purple-600" /> Employee Loans</>
              : <><Truck className="h-4 w-4 text-sky-600" /> Supplier Advances</>}
          </h3>
          <p className="text-xs text-slate-500">
            {segment === 'employee'
              ? 'Money lent to staff — tracked as a receivable with automatic GL posting'
              : 'Prepayments to suppliers — tracked as a receivable until applied to a purchase'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
            {fmt(totalOutstanding)} outstanding
          </Badge>
          {canWrite && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> {segment === 'employee' ? 'New Loan' : 'New Advance'}
            </Button>
          )}
        </div>
      </div>

      {/* Segmented control */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
        <button
          type="button"
          onClick={() => setSegment('employee')}
          className={cn('px-4 py-1.5 rounded-lg font-medium transition-colors',
            segment === 'employee' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
        >
          Employee Loans
        </button>
        <button
          type="button"
          onClick={() => setSegment('supplier')}
          className={cn('px-4 py-1.5 rounded-lg font-medium transition-colors',
            segment === 'supplier' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
        >
          Supplier Advances
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <ReportTableShell>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className={reportTableHead}>Date</th>
                <th className={reportTableHead}>{segment === 'employee' ? 'Employee' : 'Supplier'}</th>
                <th className={reportTableHead}>Reason / Ref</th>
                <th className={reportTableHead}>Status</th>
                <th className={reportTableHeadRight}>Original</th>
                <th className={reportTableHeadRight}>Outstanding</th>
                <th className={reportTableHeadRight}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {segment === 'employee' && empLoans.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{format(new Date(l.created_at), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    {l.employee_name}
                    {l.employee_role && <span className="block text-[11px] text-slate-400">{l.employee_role}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{l.reason ?? l.reference ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge className={cn('capitalize text-[10px]', STATUS_BADGE[l.status])}>{l.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmt(l.original_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-700">{fmt(l.outstanding_balance)}</td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && l.status !== 'settled' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-emerald-200 text-emerald-700"
                        onClick={() => setSettleTarget(l)}>
                        <ArrowDownLeft className="h-3 w-3" /> Repay
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {segment === 'supplier' && supAdvances.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{format(new Date(a.created_at), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{a.supplier_name}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{a.reason ?? a.reference ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge className={cn('capitalize text-[10px]', STATUS_BADGE[a.status])}>{a.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmt(a.original_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-700">{fmt(a.outstanding_balance)}</td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && a.status !== 'settled' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-sky-200 text-sky-700"
                        onClick={() => setSettleTarget(a)}>
                        <ArrowDownLeft className="h-3 w-3" /> Settle
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {((segment === 'employee' && empLoans.length === 0) ||
                (segment === 'supplier' && supAdvances.length === 0)) && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400 text-sm">
                    {segment === 'employee' ? 'No employee loans yet' : 'No supplier advances yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ReportTableShell>
      )}

      {showCreate && (
        <CreateDialog
          segment={segment}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            invalidateAccountingQueries(queryClient, currentStore?.id);
            queryClient.invalidateQueries({ queryKey: [segment === 'employee' ? 'employee-loans' : 'supplier-advances', currentStore?.id] });
          }}
        />
      )}

      {settleTarget && (
        <SettleDialog
          segment={segment}
          target={settleTarget}
          onClose={() => setSettleTarget(null)}
          onSuccess={() => {
            invalidateAccountingQueries(queryClient, currentStore?.id);
            queryClient.invalidateQueries({ queryKey: [segment === 'employee' ? 'employee-loans' : 'supplier-advances', currentStore?.id] });
          }}
        />
      )}
    </div>
  );
}

// ── Create loan / advance ───────────────────────────────────
function CreateDialog({ segment, onClose, onSuccess }: {
  segment: Segment; onClose: () => void; onSuccess: () => void;
}) {
  const { currentStore, user } = useAuthStore();
  const isEmp = segment === 'employee';

  const [partyId, setPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const methodOptions = storePaymentMethods.length > 0
    ? storePaymentMethods.filter((m) => m.slug !== 'customer_deposit' && m.is_active)
    : [{ slug: 'cash', label: 'Cash' }, { slug: 'bank', label: 'Bank' }, { slug: 'evc', label: 'EVC Plus' }];

  // Load parties (employees or suppliers)
  const { data: parties = [] } = useQuery({
    queryKey: [isEmp ? 'active-employees' : 'active-suppliers', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from(isEmp ? 'employees' : 'suppliers')
        .select('id, full_name, name')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .order(isEmp ? 'full_name' : 'name');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name?: string; name?: string }>;
    },
    enabled: !!currentStore,
  });

  const parsedAmt = parseFloat(amount) || 0;
  const canSubmit = !!partyId && parsedAmt > 0;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error('Not authenticated');
      const supabase = createClient();
      if (isEmp) {
        const { data, error } = await supabase.rpc('create_employee_loan', {
          p_store_id: currentStore.id, p_user_id: user.id, p_employee_id: partyId,
          p_amount: parsedAmt, p_payment_method: paymentMethod,
          p_reason: reason || null, p_notes: notes || null, p_reference: reference || null,
          p_due_date: dueDate || null,
        });
        if (error) throw error;
        const r = data as { success: boolean; error?: string };
        if (!r.success) throw new Error(r.error ?? 'Failed');
        return r;
      } else {
        const { data, error } = await supabase.rpc('create_supplier_advance', {
          p_store_id: currentStore.id, p_user_id: user.id, p_supplier_id: partyId,
          p_amount: parsedAmt, p_payment_method: paymentMethod,
          p_reason: reason || null, p_notes: notes || null, p_reference: reference || null,
        });
        if (error) throw error;
        const r = data as { success: boolean; error?: string };
        if (!r.success) throw new Error(r.error ?? 'Failed');
        return r;
      }
    },
    onSuccess: () => {
      toast.success(isEmp ? 'Employee loan created' : 'Supplier advance created');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className={cn('h-4 w-4', isEmp ? 'text-purple-600' : 'text-sky-600')} />
            {isEmp ? 'New Employee Loan' : 'New Supplier Advance'}
          </DialogTitle>
          <DialogDescription>
            GL entries are created automatically (DR receivable / CR cash).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{isEmp ? 'Employee' : 'Supplier'} <span className="text-red-500">*</span></Label>
            <Select value={partyId} onValueChange={(v) => v && setPartyId(v)}>
              <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{isEmp ? p.full_name : p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Amount <span className="text-red-500">*</span></Label>
            <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" className="mt-1 h-12 text-lg font-semibold tabular-nums" autoFocus />
          </div>

          <div>
            <Label>{isEmp ? 'Disbursed From' : 'Paid From'}</Label>
            <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v)}>
              <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {methodOptions.map((m) => <SelectItem key={m.slug} value={m.slug}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={isEmp ? 'Salary advance, emergency…' : 'Prepayment for order…'} className="mt-1 h-10" />
          </div>

          {isEmp && (
            <div>
              <Label>Due Date (optional)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 h-10" />
            </div>
          )}

          <div>
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt #, transaction ID…" className="mt-1 h-10" />
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 resize-none min-h-[56px]" />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button className="flex-1" disabled={isPending || !canSubmit} onClick={() => mutate()}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEmp ? 'Create Loan' : 'Create Advance'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Repay loan / settle advance ─────────────────────────────
function SettleDialog({ segment, target, onClose, onSuccess }: {
  segment: Segment; target: EmployeeLoan | SupplierAdvance; onClose: () => void; onSuccess: () => void;
}) {
  const { currentStore, user } = useAuthStore();
  const isEmp = segment === 'employee';
  const outstanding = target.outstanding_balance;

  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [settleMode, setSettleMode] = useState<'refund' | 'purchase'>('refund');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const methodOptions = storePaymentMethods.length > 0
    ? storePaymentMethods.filter((m) => m.slug !== 'customer_deposit' && m.is_active)
    : [{ slug: 'cash', label: 'Cash' }, { slug: 'bank', label: 'Bank' }, { slug: 'evc', label: 'EVC Plus' }];

  const parsedAmt = parseFloat(amount) || 0;
  const canSubmit = parsedAmt > 0 && parsedAmt <= outstanding;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error('Not authenticated');
      const supabase = createClient();
      if (isEmp) {
        const { data, error } = await supabase.rpc('repay_employee_loan', {
          p_store_id: currentStore.id, p_user_id: user.id, p_loan_id: target.id,
          p_amount: parsedAmt, p_payment_method: paymentMethod,
          p_notes: notes || null, p_reference: reference || null,
        });
        if (error) throw error;
        const r = data as { success: boolean; error?: string };
        if (!r.success) throw new Error(r.error ?? 'Failed');
        return r;
      } else {
        const { data, error } = await supabase.rpc('settle_supplier_advance', {
          p_store_id: currentStore.id, p_user_id: user.id, p_advance_id: target.id,
          p_amount: parsedAmt, p_settle_mode: settleMode, p_payment_method: paymentMethod,
          p_notes: notes || null, p_reference: reference || null,
        });
        if (error) throw error;
        const r = data as { success: boolean; error?: string };
        if (!r.success) throw new Error(r.error ?? 'Failed');
        return r;
      }
    },
    onSuccess: () => {
      toast.success(isEmp ? 'Repayment recorded' : 'Advance settled');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
            {isEmp ? 'Record Loan Repayment' : 'Settle Supplier Advance'}
          </DialogTitle>
          <DialogDescription>Outstanding: {fmt(outstanding)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEmp && (
            <div>
              <Label>Settle As</Label>
              <Select value={settleMode} onValueChange={(v) => v && setSettleMode(v as 'refund' | 'purchase')}>
                <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="refund">Cash refund from supplier</SelectItem>
                  <SelectItem value="purchase">Applied to a purchase (offsets payable)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Amount <span className="text-red-500">*</span></Label>
            <Input type="number" step="0.01" min="0.01" max={outstanding} value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className={cn('mt-1 h-12 text-lg font-semibold tabular-nums', parsedAmt > outstanding && 'border-red-400')} autoFocus />
            {parsedAmt > outstanding && <p className="text-xs text-red-500 mt-1">Exceeds outstanding ({fmt(outstanding)})</p>}
          </div>

          {(isEmp || settleMode === 'refund') && (
            <div>
              <Label>{isEmp ? 'Received Via' : 'Refund To'}</Label>
              <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v)}>
                <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {methodOptions.map((m) => <SelectItem key={m.slug} value={m.slug}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-10" />
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 resize-none min-h-[56px]" />
          </div>

          {parsedAmt > 0 && parsedAmt <= outstanding && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5 flex justify-between text-sm">
              <span className="text-emerald-700">Outstanding after:</span>
              <strong className="text-emerald-800 tabular-nums">{fmt(outstanding - parsedAmt)}</strong>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={isPending || !canSubmit} onClick={() => mutate()}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEmp ? 'Record Repayment' : 'Settle'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
