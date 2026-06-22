'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, CreditCard } from 'lucide-react';
import type { PaymentMethod, PurchaseOrder } from '@/types';
import { PAYMENT_METHODS_LABELS } from '@/types';
import { cn } from '@/lib/utils';

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'waafi', 'evc', 'sahal', 'zaad'];

interface PurchaseCheckoutModalProps {
  open: boolean;
  po: PurchaseOrder | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function PurchaseCheckoutModal({ open, po, onClose, onSuccess }: PurchaseCheckoutModalProps) {
  const { currentStore, user } = useAuthStore();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [dueDate, setDueDate] = useState('');

  const currency = currentStore?.currency || 'USD';
  const total = po?.total_amount ?? 0;

  const { mutate: checkout, isPending } = useMutation({
    mutationFn: async () => {
      if (!po || !currentStore || !user) throw new Error('Missing data');
      const paid = parseFloat(paidAmount) || 0;
      if (paid < 0 || paid > total) throw new Error('Invalid payment amount');

      const supabase = createClient();
      const { data, error } = await supabase.rpc('receive_purchase_order', {
        p_store_id: currentStore.id,
        p_po_id: po.id,
        p_user_id: user.id,
        p_paid_amount: paid,
        p_payment_method: paymentMethod,
        p_due_date: dueDate || null,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; ap_amount?: number };
      if (!result.success) throw new Error(result.error || 'Receive failed');
      return result;
    },
    onSuccess: (result) => {
      if (result.ap_amount && result.ap_amount > 0) {
        toast.success(`Received. Supplier debt: ${currency} ${result.ap_amount.toFixed(2)}`);
      } else {
        toast.success('Purchase received and paid in full');
      }
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!po) return null;

  const debtAmount = Math.max(0, total - (parseFloat(paidAmount) || 0));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-600" />
            Purchase Checkout — {po.po_number}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{currency} {total.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Payment Method</Label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={cn(
                    'rounded-lg border py-2 text-xs font-medium',
                    paymentMethod === m
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600'
                  )}
                >
                  {PAYMENT_METHODS_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Amount Paid Now</Label>
            <Input
              type="number"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              placeholder={total.toFixed(2)}
            />
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => setPaidAmount(total.toFixed(2))}>
                Full payment
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPaidAmount('0')}>
                Pay later (debt)
              </Button>
            </div>
          </div>

          {debtAmount > 0 && (
            <>
              <div className="space-y-1">
                <Label>Payment Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-2 text-xs text-orange-800">
                Supplier payable: {currency} {debtAmount.toFixed(2)}
              </div>
            </>
          )}

          <Button
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            disabled={isPending}
            onClick={() => checkout()}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Receive & Complete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
