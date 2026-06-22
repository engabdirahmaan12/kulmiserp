'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Banknote } from 'lucide-react';
import type { PurchaseOrder, Supplier } from '@/types';
import { purchaseBalanceDue } from '@/lib/payments/status';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'waafi', label: 'WAAFI' },
];

interface SupplierPaymentModalProps {
  open: boolean;
  po: (PurchaseOrder & { supplier?: Supplier | null }) | null;
  onClose: () => void;
}

export function SupplierPaymentModal({ open, po, onClose }: SupplierPaymentModalProps) {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');

  const currency = currentStore?.currency ?? 'USD';
  const balance = po ? purchaseBalanceDue(po) : 0;
  const supplierId = po?.supplier_id;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!po || !currentStore || !user || !supplierId) throw new Error('Supplier required');
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error('Enter a valid amount');

      const supabase = createClient();
      const { data, error } = await supabase.rpc('record_supplier_payment', {
        p_store_id: currentStore.id,
        p_user_id: user.id,
        p_supplier_id: supplierId,
        p_amount: amt,
        p_payment_method: method,
        p_notes: notes || `Payment for ${po.po_number}`,
        p_purchase_order_id: po.id,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Payment failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-history', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['store-transactions', currentStore?.id] });
      toast.success('Supplier payment recorded');
      handleClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleClose = () => {
    setAmount('');
    setNotes('');
    setMethod('cash');
    onClose();
  };

  if (!po) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-blue-600" />
            Pay Supplier
          </DialogTitle>
        </DialogHeader>

        {!supplierId ? (
          <p className="text-sm text-red-600">This PO has no supplier linked.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
              <p><span className="text-slate-500">PO:</span> {po.po_number}</p>
              <p><span className="text-slate-500">Supplier:</span> {po.supplier?.name}</p>
              <p><span className="text-slate-500">Balance:</span> <span className="font-bold text-red-600">{currency} {balance.toFixed(2)}</span></p>
            </div>

            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setAmount(balance.toFixed(2))}>
                Pay full balance
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => v && setMethod(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button disabled={isPending || !supplierId} onClick={() => mutate()}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
