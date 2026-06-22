'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { Loader2, PackageMinus } from 'lucide-react';
import type { PurchaseOrder, PurchaseOrderItem } from '@/types';

interface ReturnLine {
  po_item_id: string;
  product_id?: string;
  product_name: string;
  max_purchase_qty: number;
  max_base_qty: number;
  return_qty: number;
  unit_cost: number;
  conversion_factor: number;
}

interface PurchaseReturnModalProps {
  open: boolean;
  po: PurchaseOrder | null;
  items: PurchaseOrderItem[];
  onClose: () => void;
}

export function PurchaseReturnModal({ open, po, items, onClose }: PurchaseReturnModalProps) {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const [lines, setLines] = useState<ReturnLine[]>([]);

  useEffect(() => {
    if (!open || !items.length) return;
    setLines(
      items.map((it) => {
        const purchaseQty = it.purchase_unit_qty ?? it.quantity ?? 0;
        const baseQty = it.base_qty ?? it.quantity ?? 0;
        const conv = purchaseQty > 0 ? baseQty / purchaseQty : 1;
        return {
          po_item_id: it.id,
          product_id: it.product_id,
          product_name: it.product_name,
          max_purchase_qty: purchaseQty,
          max_base_qty: baseQty,
          return_qty: 0,
          unit_cost: it.unit_cost,
          conversion_factor: conv,
        };
      }),
    );
  }, [open, items]);

  const returnTotal = useMemo(
    () => lines.reduce((s, l) => s + l.return_qty * l.unit_cost, 0),
    [lines],
  );

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!po || !currentStore || !user) throw new Error('Missing data');
      const payload = lines
        .filter((l) => l.return_qty > 0)
        .map((l) => ({
          product_id: l.product_id ?? null,
          product_name: l.product_name,
          purchase_unit_qty: l.return_qty,
          base_qty: l.return_qty * l.conversion_factor,
          unit_cost: l.unit_cost,
          subtotal: l.return_qty * l.unit_cost,
        }));
      if (payload.length === 0) throw new Error('Select items to return');

      const supabase = createClient();
      const { data, error } = await supabase.rpc('process_purchase_return', {
        p_store_id: currentStore.id,
        p_po_id: po.id,
        p_user_id: user.id,
        p_return_items: payload,
        p_reason: reason || null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string; return_number?: string };
      if (!result?.success) throw new Error(result?.error || 'Return failed');
      return result.return_number;
    },
    onSuccess: (returnNumber) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-history', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['store-transactions', currentStore?.id] });
      toast.success(`Purchase return ${returnNumber} recorded`);
      handleClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleClose = () => {
    setReason('');
    setLines([]);
    onClose();
  };

  if (!po) return null;

  const currency = currentStore?.currency ?? 'USD';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-5 w-5 text-orange-600" />
            Purchase Return — {po.po_number}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {lines.map((line, i) => (
            <div key={line.po_item_id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{line.product_name}</p>
                <p className="text-xs text-slate-500">Max: {line.max_purchase_qty} units</p>
              </div>
              <Input
                type="number"
                min={0}
                max={line.max_purchase_qty}
                step="any"
                className="w-20 h-9"
                value={line.return_qty || ''}
                onChange={(e) => {
                  const qty = Math.min(line.max_purchase_qty, Math.max(0, Number(e.target.value) || 0));
                  setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, return_qty: qty } : l)));
                }}
              />
            </div>
          ))}

          <div className="space-y-1">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional..." />
          </div>

          <p className="text-sm font-semibold text-right">
            Return total: {currency} {returnTotal.toFixed(2)}
          </p>
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            className="bg-orange-600 hover:bg-orange-700"
            disabled={isPending || returnTotal <= 0}
            onClick={() => mutate()}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Process Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
