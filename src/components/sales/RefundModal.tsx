'use client';

import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, RotateCcw } from 'lucide-react';
import type { Sale, SaleItem } from '@/types';
import { InvoiceDocument } from '@/components/invoice/InvoiceDocument';
import type { InvoiceData } from '@/lib/invoice-utils';
import { REFUND_METHODS, type RefundMethod } from '@/lib/payments/status';

interface RefundModalProps {
  open: boolean;
  sale: (Sale & { items: SaleItem[] }) | null;
  onClose: () => void;
}

interface ReturnLine {
  sale_item_id: string;
  product_id?: string;
  product_name: string;
  sale_unit_code?: string;
  max_sale_qty: number;
  max_base_qty: number;
  returned_base: number;
  return_qty: number;
  conversion_factor: number;
  unit_price: number;
  cost_price: number;
  line_subtotal: number;
}

function buildReturnLines(items: SaleItem[]): ReturnLine[] {
  return items.map((item) => {
    const saleQty = Number(item.sale_unit_qty ?? item.quantity ?? 0);
    const baseQty = Number(item.base_qty ?? item.quantity ?? 0);
    const returned = Number(item.returned_base_qty ?? 0);
    const conv = saleQty > 0 ? baseQty / saleQty : 1;
    const maxBase = Math.max(0, baseQty - returned);
    const maxSale = conv > 0 ? maxBase / conv : maxBase;
    return {
      sale_item_id: item.id,
      product_id: item.product_id ?? undefined,
      product_name: item.product_name,
      sale_unit_code: item.sale_unit_code ?? undefined,
      max_sale_qty: maxSale,
      max_base_qty: maxBase,
      returned_base: returned,
      return_qty: 0,
      conversion_factor: conv,
      unit_price: Number(item.unit_price) || 0,
      cost_price: Number(item.cost_price) || 0,
      line_subtotal: Number(item.subtotal) || 0,
    };
  });
}

export function RefundModal({ open, sale, onClose }: RefundModalProps) {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [refundInvoice, setRefundInvoice] = useState<InvoiceData | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [mode, setMode] = useState<'items' | 'amount'>('items');

  const currency = currentStore?.currency || 'USD';

  useEffect(() => {
    if (open && sale?.items) {
      setLines(buildReturnLines(sale.items));
      setMode('items');
      setRefundInvoice(null);
      setReason('');
      setRefundMethod('cash');
    }
  }, [open, sale]);

  const [partialAmount, setPartialAmount] = useState('');

  const computedItemsTotal = useMemo(() => {
    return lines.reduce((sum, l) => {
      if (l.return_qty <= 0) return sum;
      const origSaleQty = l.max_sale_qty + (l.returned_base / (l.conversion_factor || 1));
      const ratio = origSaleQty > 0 ? l.return_qty / origSaleQty : 0;
      return sum + l.line_subtotal * ratio;
    }, 0);
  }, [lines]);

  const { mutate: processRefund, isPending } = useMutation({
    mutationFn: async (full: boolean) => {
      if (!sale || !currentStore || !user) throw new Error('Missing data');

      const supabase = createClient();
      let refundAmount: number;
      let refundItems;

      if (mode === 'items' && !full) {
        const active = lines.filter((l) => l.return_qty > 0);
        if (active.length === 0) throw new Error('Enter return quantities');
        refundAmount = computedItemsTotal;
        refundItems = active.map((l) => {
          const baseQty = l.return_qty * l.conversion_factor;
          const origSaleQty = l.max_sale_qty + (l.returned_base / (l.conversion_factor || 1));
          const ratio = origSaleQty > 0 ? l.return_qty / origSaleQty : 1;
          return {
            sale_item_id: l.sale_item_id,
            product_id: l.product_id ?? null,
            quantity: baseQty,
            base_qty: baseQty,
            cost_price: l.cost_price,
            subtotal: l.line_subtotal * ratio,
          };
        });
      } else {
        refundAmount = full ? sale.total_amount : parseFloat(partialAmount) || 0;
        if (refundAmount <= 0 || refundAmount > sale.total_amount) {
          throw new Error('Invalid refund amount');
        }
        const ratio = full ? 1 : refundAmount / sale.total_amount;
        refundItems = (sale.items || []).map((item) => {
          const baseQty = Number(item.base_qty ?? item.quantity ?? 0);
          return {
            sale_item_id: item.id,
            product_id: item.product_id,
            quantity: baseQty * ratio,
            base_qty: baseQty * ratio,
            cost_price: item.cost_price,
            subtotal: full ? item.subtotal : item.subtotal * ratio,
          };
        });
      }

      if (refundMethod === 'store_credit' && !sale.customer_id) {
        throw new Error('Store credit requires a customer on this sale');
      }

      const { data, error } = await supabase.rpc('process_sale_refund', {
        p_store_id: currentStore.id,
        p_sale_id: sale.id,
        p_user_id: user.id,
        p_refund_items: refundItems,
        p_refund_amount: refundAmount,
        p_reason: reason || null,
        p_refund_method: refundMethod,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; refund_invoice?: string };
      if (!result.success) throw new Error(result.error || 'Refund failed');
      return { refund_invoice: result.refund_invoice!, refundAmount };
    },
    onSuccess: (data) => {
      if (!sale) return;
      const inv: InvoiceData = {
        type: 'refund',
        invoice_number: data.refund_invoice,
        store_name: currentStore?.name || '',
        currency,
        date: new Date().toISOString(),
        customer_name: (sale.customer as { full_name?: string } | null)?.full_name,
        items: (sale.items || []).map((i) => ({
          name: i.product_name,
          sku: i.product_sku,
          quantity: i.sale_unit_qty ?? i.quantity,
          unit_code: i.sale_unit_code ?? undefined,
          base_qty: i.base_qty ?? i.quantity,
          unit_price: i.unit_price,
          subtotal: i.subtotal,
        })),
        subtotal: data.refundAmount,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: -data.refundAmount,
        paid_amount: -data.refundAmount,
        credit_amount: 0,
        payment_method: refundMethod,
        payment_label: REFUND_METHODS.find((m) => m.value === refundMethod)?.label ?? refundMethod,
        status: 'refunded',
        is_refund: true,
        notes: reason,
      };
      setRefundInvoice(inv);
      queryClient.invalidateQueries({ queryKey: ['sales-history', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['store-transactions', currentStore?.id] });
      toast.success('Return processed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleClose = () => {
    setRefundInvoice(null);
    setReason('');
    setPartialAmount('');
    setLines([]);
    onClose();
  };

  if (!sale) return null;

  const canReturn = sale.status === 'completed' || sale.status === 'partially_refunded';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[min(92vh,640px)] flex flex-col overflow-hidden p-0 gap-0 rounded-2xl">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-red-600" />
            Return — {sale.invoice_number}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {refundInvoice ? (
            <div className="space-y-3">
              <InvoiceDocument data={refundInvoice} id="refund-invoice" variant="panel" showControls />
              <Button className="w-full" onClick={handleClose}>Done</Button>
            </div>
          ) : !canReturn ? (
            <p className="text-sm text-slate-500">This sale cannot be returned.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button size="sm" variant={mode === 'items' ? 'default' : 'outline'} onClick={() => setMode('items')}>
                  By item
                </Button>
                <Button size="sm" variant={mode === 'amount' ? 'default' : 'outline'} onClick={() => setMode('amount')}>
                  By amount
                </Button>
              </div>

              {mode === 'items' ? (
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={line.sale_item_id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{line.product_name}</p>
                        <p className="text-[10px] text-slate-500 uppercase">
                          {line.sale_unit_code ?? 'unit'} · max {line.max_sale_qty.toFixed(2)}
                        </p>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        max={line.max_sale_qty}
                        step="any"
                        className="w-20 h-8 text-sm"
                        value={line.return_qty || ''}
                        onChange={(e) => {
                          const qty = Math.min(line.max_sale_qty, Math.max(0, Number(e.target.value) || 0));
                          setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, return_qty: qty } : l)));
                        }}
                      />
                    </div>
                  ))}
                  <p className="text-sm text-right font-semibold">
                    Return total: {currency} {computedItemsTotal.toFixed(2)}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Refund amount (partial)</Label>
                  <Input
                    type="number"
                    placeholder={sale.total_amount.toFixed(2)}
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label>Refund method</Label>
                <Select value={refundMethod} onValueChange={(v) => v && setRefundMethod(v as RefundMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REFUND_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Reason</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional..." className="h-9" />
              </div>
            </div>
          )}
        </div>

        {!refundInvoice && canReturn && (
          <DialogFooter className="shrink-0 px-5 py-4 border-t bg-slate-50/50 gap-2 sm:justify-stretch">
            {mode === 'items' ? (
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                disabled={isPending || computedItemsTotal <= 0}
                onClick={() => processRefund(false)}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Process Return'}
              </Button>
            ) : (
              <>
                <Button variant="outline" className="flex-1" disabled={isPending} onClick={() => processRefund(false)}>
                  Partial Refund
                </Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700" disabled={isPending} onClick={() => processRefund(true)}>
                  Full Refund
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
