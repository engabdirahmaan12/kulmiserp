'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowUpDown, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { formatUnitQty } from '@/lib/units/conversion';
import type { Product } from '@/types';

type AdjustProduct = Product & { base_unit_code?: string };

interface StockAdjustModalProps {
  open: boolean;
  product: AdjustProduct;
  onClose: () => void;
}

export function StockAdjustModal({ open, product, onClose }: StockAdjustModalProps) {
  const [type, setType] = useState<'add' | 'remove' | 'set'>('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();

  const baseUnit = product.base_unit_code ?? product.unit ?? 'PCS';

  const newQuantity =
    type === 'set'
      ? parseFloat(quantity) || 0
      : type === 'add'
      ? product.stock_quantity + (parseFloat(quantity) || 0)
      : product.stock_quantity - (parseFloat(quantity) || 0);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const qty = parseFloat(quantity);
      if (isNaN(qty) || qty < 0) throw new Error('Invalid quantity');

      const afterQty = Math.max(0, newQuantity);
      const { data, error } = await supabase.rpc('record_stock_adjustment', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_product_id: product.id,
        p_quantity_after: afterQty,
        p_reason: reason || type,
        p_movement_type: 'adjustment',
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed to adjust stock');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStore?.id] });
      toast.success('Stock adjusted and posted to ledger');
      onClose();
    },
    onError: (e) => toast.error('Failed: ' + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5 text-blue-600" />
              Adjust Stock
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-semibold text-slate-900">{product.name}</p>
            <p className="text-sm text-slate-500 mt-0.5">
              Current stock:{' '}
              <strong>
                {formatUnitQty(product.stock_quantity, false)} {baseUnit}
              </strong>
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Quantities are in base units ({baseUnit})</p>
          </div>

          <div className="space-y-1.5">
            <Label>Adjustment Type</Label>
            <Select value={type} onValueChange={(v: string | null) => setType((v ?? 'add') as 'add' | 'remove' | 'set')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Add Stock</SelectItem>
                <SelectItem value="remove">Remove Stock</SelectItem>
                <SelectItem value="set">Set Exact Quantity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Quantity ({baseUnit})</Label>
            <Input
              type="number"
              step="0.001"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={`Enter ${baseUnit} to ${type}`}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., stock count, damaged goods..."
            />
          </div>

          {quantity && !isNaN(parseFloat(quantity)) && (
            <div className={`rounded-lg p-3 border ${newQuantity >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-sm font-medium text-slate-700">
                New stock level:{' '}
                <strong className={newQuantity >= 0 ? 'text-blue-700' : 'text-red-700'}>
                  {formatUnitQty(Math.max(0, newQuantity), false)} {baseUnit}
                </strong>
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              onClick={() => mutate()}
              disabled={isPending || !quantity}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40"
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Adjust
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
