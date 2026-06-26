'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Banknote, ArrowDownLeft } from 'lucide-react';
import { format } from 'date-fns';
import type { Customer, CustomerAdvance } from '@/types';
import { cn } from '@/lib/utils';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';

interface CustomerAdvanceModalProps {
  open: boolean;
  customer: Customer;
  mode: 'advance' | 'repay';
  advance?: CustomerAdvance | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CustomerAdvanceModal({
  open,
  customer,
  mode,
  advance,
  onClose,
  onSuccess,
}: CustomerAdvanceModalProps) {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const paymentMethodOptions = storePaymentMethods.length > 0
    ? storePaymentMethods.filter((m) => m.slug !== 'customer_deposit' && m.is_active)
    : [
        { slug: 'cash', label: 'Cash' },
        { slug: 'bank', label: 'Bank Transfer' },
        { slug: 'evc',  label: 'EVC Plus' },
      ];

  const [amount,         setAmount]         = useState('');
  const [paymentMethod,  setPaymentMethod]  = useState('cash');
  const [reference,      setReference]      = useState('');
  const [notes,          setNotes]          = useState('');
  const [dueDate,        setDueDate]        = useState('');

  const isRepay      = mode === 'repay';
  const currency     = currentStore?.currency ?? 'USD';
  const parsedAmt    = parseFloat(amount) || 0;
  const outstanding  = advance?.outstanding_balance ?? 0;
  const canSubmit    = parsedAmt > 0 && (!isRepay || parsedAmt <= outstanding);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error('Not authenticated');
      const supabase = createClient();

      if (isRepay) {
        if (!advance) throw new Error('No advance selected');
        const { data, error } = await supabase.rpc('repay_customer_advance', {
          p_store_id:       currentStore.id,
          p_user_id:        user.id,
          p_advance_id:     advance.id,
          p_amount:         parsedAmt,
          p_payment_method: paymentMethod,
          p_notes:          notes || null,
          p_reference:      reference || null,
        });
        if (error) throw error;
        const result = data as { success: boolean; error?: string; new_outstanding?: number };
        if (!result.success) throw new Error(result.error ?? 'Repayment failed');
        return result;
      } else {
        const { data, error } = await supabase.rpc('create_customer_advance', {
          p_store_id:       currentStore.id,
          p_user_id:        user.id,
          p_customer_id:    customer.id,
          p_amount:         parsedAmt,
          p_payment_method: paymentMethod,
          p_notes:          notes || null,
          p_reference:      reference || null,
          p_due_date:       dueDate || null,
        });
        if (error) throw error;
        const result = data as { success: boolean; error?: string };
        if (!result.success) throw new Error(result.error ?? 'Failed to create advance');
        return result;
      }
    },

    onSuccess: () => {
      toast.success(isRepay ? 'Repayment recorded successfully' : 'Cash advance created successfully');
      queryClient.invalidateQueries({ queryKey: ['customers',          currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-advances',  customer.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-statement', customer.id] });
      onSuccess?.();
      handleClose();
    },

    onError: (err: Error) => toast.error(err.message),
  });

  const handleClose = () => {
    setAmount('');
    setPaymentMethod('cash');
    setReference('');
    setNotes('');
    setDueDate('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-sm rounded-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-slate-100">
          <DialogTitle className="flex items-center gap-2 text-base">
            {isRepay
              ? <><ArrowDownLeft className="h-4 w-4 text-emerald-500" /> Record Repayment</>
              : <><Banknote className="h-4 w-4 text-amber-500" /> Create Cash Advance</>
            }
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          {/* Customer / advance info */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">{customer.full_name}</p>
            {isRepay && advance ? (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-slate-500">
                  Original advance: <strong>{fmt(advance.original_amount)}</strong>
                  {advance.created_at && (
                    <span className="ml-1 text-slate-400">
                      on {format(new Date(advance.created_at), 'MMM d, yyyy')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  Outstanding: <strong className="text-amber-700">{fmt(outstanding)}</strong>
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">
                Current advance balance:{' '}
                <strong className="text-amber-700">{fmt((customer as any).advance_balance ?? 0)}</strong>
              </p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              {isRepay ? 'Repayment Amount' : 'Advance Amount'}
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={isRepay ? outstanding : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={cn(
                'h-12 text-lg font-semibold tabular-nums',
                isRepay && parsedAmt > outstanding ? 'border-red-400 focus-visible:ring-red-400' : '',
              )}
              autoFocus
            />
            {isRepay && parsedAmt > outstanding && (
              <p className="text-xs text-red-500">Exceeds outstanding balance ({fmt(outstanding)})</p>
            )}
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              {isRepay ? 'Received Via' : 'Disbursed From'}
            </Label>
            <Select value={paymentMethod} onValueChange={(v) => { if (v) setPaymentMethod(v); }}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentMethodOptions.map((m) => (
                  <SelectItem key={m.slug} value={m.slug}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due date (only for new advances) */}
          {!isRepay && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">Due Date (optional)</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-10"
              />
            </div>
          )}

          {/* Reference */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">Reference (optional)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt #, transaction ID…"
              className="h-10"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes…"
              className="min-h-[56px] resize-none"
            />
          </div>

          {/* Preview */}
          {parsedAmt > 0 && parsedAmt <= (isRepay ? outstanding : Infinity) && (
            <div className={cn(
              'rounded-lg px-4 py-2.5 flex justify-between items-center text-sm',
              isRepay
                ? 'bg-emerald-50 border border-emerald-100'
                : 'bg-amber-50 border border-amber-100',
            )}>
              <span className={isRepay ? 'text-emerald-700' : 'text-amber-700'}>
                {isRepay ? 'Outstanding after repayment:' : 'New advance balance:'}
              </span>
              <strong className={cn('tabular-nums', isRepay ? 'text-emerald-800' : 'text-amber-800')}>
                {fmt(isRepay
                  ? outstanding - parsedAmt
                  : ((customer as any).advance_balance ?? 0) + parsedAmt
                )}
              </strong>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
          <Button type="button" variant="outline" className="flex-1 h-11" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending || !canSubmit}
            onClick={() => mutate()}
            className={cn(
              'flex-1 h-11 gap-2',
              isRepay ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700',
            )}
          >
            {isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
              : isRepay ? 'Record Repayment' : 'Create Advance'
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
