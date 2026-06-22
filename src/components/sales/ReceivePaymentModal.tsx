'use client';

import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import type { Customer, Sale } from '@/types';
import { saleBalanceDue } from '@/lib/payments/status';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'waafi', label: 'WAAFI' },
  { value: 'evc', label: 'EVC' },
  { value: 'sahal', label: 'Sahal' },
  { value: 'zaad', label: 'Zaad' },
];

interface ReceivePaymentModalProps {
  open: boolean;
  /** Specific invoice (from sales history) */
  sale?: Sale | null;
  /** Customer-level payment (from customer profile) */
  customer?: Customer | null;
  onClose: () => void;
}

export function ReceivePaymentModal({ open, sale, customer, onClose }: ReceivePaymentModalProps) {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [linkedSaleId, setLinkedSaleId] = useState<string>('');

  const customerId = sale?.customer_id ?? customer?.id;
  const customerName =
    (sale?.customer as { full_name?: string } | null)?.full_name ?? customer?.full_name;

  const { data: openInvoices = [] } = useQuery({
    queryKey: ['customer-open-invoices', customerId],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('sales')
        .select('id, invoice_number, total_amount, paid_amount, credit_amount, sale_date')
        .eq('store_id', currentStore!.id)
        .eq('customer_id', customerId!)
        .in('status', ['completed', 'partially_refunded'])
        .gt('credit_amount', 0)
        .order('sale_date', { ascending: false });
      return (data ?? []) as Sale[];
    },
    enabled: !!currentStore && !!customerId && open && !sale,
  });

  const selectedSale = useMemo(() => {
    if (sale) return sale;
    if (linkedSaleId) return openInvoices.find((s) => s.id === linkedSaleId) ?? null;
    return null;
  }, [sale, linkedSaleId, openInvoices]);

  const maxAmount = useMemo(() => {
    if (selectedSale) return saleBalanceDue(selectedSale);
    if (customer) return customer.balance;
    return 0;
  }, [selectedSale, customer]);

  const currency = currentStore?.currency ?? 'USD';

  useEffect(() => {
    if (!open) return;
    if (sale) {
      setLinkedSaleId(sale.id);
      setAmount(saleBalanceDue(sale).toFixed(2));
    } else if (customer) {
      setLinkedSaleId(openInvoices[0]?.id ?? '');
      setAmount(customer.balance > 0 ? customer.balance.toFixed(2) : '');
    }
  }, [open, sale, customer, openInvoices]);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user || !customerId) throw new Error('Customer required');
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error('Enter a valid amount');
      if (amt > maxAmount + 0.01) throw new Error('Amount exceeds balance due');

      const supabase = createClient();
      const { data, error } = await supabase.rpc('record_debt_payment', {
        p_store_id: currentStore.id,
        p_user_id: user.id,
        p_customer_id: customerId,
        p_amount: amt,
        p_payment_method: method,
        p_notes: notes || (selectedSale ? `Payment for ${selectedSale.invoice_number}` : 'Customer payment'),
        p_sale_id: selectedSale?.id ?? null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Payment failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-history', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customers', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-sales', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-open-invoices', customerId] });
      queryClient.invalidateQueries({ queryKey: ['store-transactions', currentStore?.id] });
      toast.success('Payment recorded');
      handleClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleClose = () => {
    setAmount('');
    setNotes('');
    setMethod('cash');
    setLinkedSaleId('');
    onClose();
  };

  if (!sale && !customer) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-emerald-600" />
            Receive Payment
          </DialogTitle>
        </DialogHeader>

        {!customerId ? (
          <p className="text-sm text-red-600">This sale has no customer — assign a customer before collecting payment.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
              {selectedSale && (
                <p><span className="text-slate-500">Invoice:</span> <span className="font-medium">{selectedSale.invoice_number}</span></p>
              )}
              <p><span className="text-slate-500">Customer:</span> {customerName}</p>
              <p>
                <span className="text-slate-500">Balance due:</span>{' '}
                <span className="font-bold text-red-600">{currency} {maxAmount.toFixed(2)}</span>
              </p>
            </div>

            {!sale && openInvoices.length > 0 && (
              <div className="space-y-1.5">
                <Label>Apply to invoice (optional)</Label>
                <Select value={linkedSaleId || 'general'} onValueChange={(v) => setLinkedSaleId(v === 'general' ? '' : v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="General balance" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General balance (FIFO allocation)</SelectItem>
                    {openInvoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoice_number} — {currency} {saleBalanceDue(inv).toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                max={maxAmount}
                placeholder={maxAmount.toFixed(2)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setAmount(maxAmount.toFixed(2))}>
                Pay full balance
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Payment method</Label>
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
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference or note..." />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={isPending || !customerId || maxAmount <= 0}
            onClick={() => mutate()}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
