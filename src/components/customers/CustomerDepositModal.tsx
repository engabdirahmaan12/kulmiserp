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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Coins, ArrowDownLeft } from 'lucide-react';
import type { Customer } from '@/types';
import { cn } from '@/lib/utils';

interface CustomerDepositModalProps {
  open: boolean;
  customer: Customer;
  mode: 'add' | 'refund';
  onClose: () => void;
  onSuccess?: (newBalance: number) => void;
}

const PAYMENT_METHODS = [
  { value: 'cash',           label: 'Cash'          },
  { value: 'bank',           label: 'Bank Transfer' },
  { value: 'evc',            label: 'EVC Plus'      },
  { value: 'waafi',          label: 'WAAFI'         },
  { value: 'sahal',          label: 'Sahal'         },
  { value: 'zaad',           label: 'Zaad'          },
  { value: 'premier_wallet', label: 'Premier Wallet'},
  { value: 'cheque',         label: 'Cheque'        },
];

export function CustomerDepositModal({
  open,
  customer,
  mode,
  onClose,
  onSuccess,
}: CustomerDepositModalProps) {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();

  const [amount,        setAmount]        = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [reference,     setReference]     = useState('');
  const [notes,         setNotes]         = useState('');

  const currency    = currentStore?.currency ?? 'USD';
  const depositBal  = customer.deposit_balance ?? 0;
  const parsedAmt   = parseFloat(amount) || 0;
  const isRefund    = mode === 'refund';
  const canSubmit   = parsedAmt > 0 && (!isRefund || parsedAmt <= depositBal);

  const fmt  = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error('Not authenticated');
      const supabase = createClient();

      const rpc = isRefund ? 'refund_customer_deposit' : 'add_customer_deposit';
      const { data, error } = await supabase.rpc(rpc, {
        p_store_id:       currentStore.id,
        p_user_id:        user.id,
        p_customer_id:    customer.id,
        p_amount:         parsedAmt,
        p_payment_method: paymentMethod,
        p_notes:          notes || null,
        p_reference:      reference || null,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; new_balance?: number };
      if (!result.success) throw new Error(result.error ?? 'Operation failed');
      return result.new_balance ?? 0;
    },

    onSuccess: (newBalance) => {
      toast.success(isRefund ? 'Deposit refunded successfully' : 'Deposit added successfully');
      queryClient.invalidateQueries({ queryKey: ['customers',         currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-deposits', customer.id]     });
      onSuccess?.(newBalance);
      handleClose();
    },

    onError: (err: Error) => toast.error(err.message),
  });

  const handleClose = () => {
    setAmount('');
    setPaymentMethod('cash');
    setReference('');
    setNotes('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-sm rounded-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-slate-100">
          <DialogTitle className="flex items-center gap-2 text-base">
            {isRefund
              ? <><ArrowDownLeft className="h-4 w-4 text-rose-500" /> Refund Deposit</>
              : <><Coins className="h-4 w-4 text-violet-500" /> Add Customer Deposit</>
            }
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          {/* Customer info */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">{customer.full_name}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Current deposit balance: <strong className="text-violet-700">{fmt(depositBal)}</strong>
            </p>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              {isRefund ? 'Refund Amount' : 'Deposit Amount'}
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={isRefund ? depositBal : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={cn(
                'h-12 text-lg font-semibold tabular-nums',
                isRefund && parsedAmt > depositBal ? 'border-red-400 focus-visible:ring-red-400' : '',
              )}
              autoFocus
            />
            {isRefund && parsedAmt > depositBal && (
              <p className="text-xs text-red-500">Exceeds available balance ({fmt(depositBal)})</p>
            )}
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">
              {isRefund ? 'Refund Via' : 'Received Via'}
            </Label>
            <Select value={paymentMethod} onValueChange={(v) => { if (v) setPaymentMethod(v); }}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reference */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">Reference (optional)</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Transaction ID, receipt #…"
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
              className="min-h-[64px] resize-none"
            />
          </div>

          {/* New balance preview */}
          {parsedAmt > 0 && parsedAmt <= (isRefund ? depositBal : Infinity) && (
            <div className={cn(
              'rounded-lg px-4 py-2.5 flex justify-between items-center text-sm',
              isRefund ? 'bg-rose-50 border border-rose-100' : 'bg-violet-50 border border-violet-100',
            )}>
              <span className={isRefund ? 'text-rose-700' : 'text-violet-700'}>New balance after {isRefund ? 'refund' : 'deposit'}:</span>
              <strong className={cn('tabular-nums', isRefund ? 'text-rose-800' : 'text-violet-800')}>
                {fmt(isRefund ? depositBal - parsedAmt : depositBal + parsedAmt)}
              </strong>
            </div>
          )}
        </div>

        {/* Footer */}
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
              isRefund
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-violet-600 hover:bg-violet-700',
            )}
          >
            {isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
              : isRefund ? 'Refund Deposit' : 'Add Deposit'
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
