'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

type MovementType = 'deposit' | 'withdrawal';

interface CashMovementModalProps {
  open: boolean;
  defaultType?: MovementType;
  onClose: () => void;
}

export function CashMovementModal({ open, defaultType = 'deposit', onClose }: CashMovementModalProps) {
  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [movementType, setMovementType] = useState<MovementType>(defaultType);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) setMovementType(defaultType);
  }, [open, defaultType]);

  useEffect(() => {
    if (open) setMovementType(defaultType);
  }, [open, defaultType]);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error('Not signed in');
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error('Enter a valid amount');

      const supabase = createClient();
      const { data, error } = await supabase.rpc('record_cash_movement', {
        p_store_id: currentStore.id,
        p_user_id: user.id,
        p_movement_type: movementType,
        p_amount: amt,
        p_payment_method: method,
        p_notes: notes || null,
        p_reference: reference || null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-transactions', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      toast.success(movementType === 'deposit' ? t('cashMovement.depositRecorded') : t('cashMovement.withdrawalRecorded'));
      handleClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleClose = () => {
    setAmount('');
    setReference('');
    setNotes('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {movementType === 'deposit' ? (
              <ArrowDownToLine className="h-5 w-5 text-emerald-600" />
            ) : (
              <ArrowUpFromLine className="h-5 w-5 text-orange-600" />
            )}
            {movementType === 'deposit' ? t('cashMovement.titleDeposit') : t('cashMovement.titleWithdrawal')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={movementType === 'deposit' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setMovementType('deposit')}
            >
              {t('cashMovement.btnDeposit')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={movementType === 'withdrawal' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setMovementType('withdrawal')}
            >
              {t('cashMovement.btnWithdrawal')}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>{t('cashMovement.labelAmount', { currency: currentStore?.currency ?? 'USD' })}</Label>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('cashMovement.labelAccount')}</Label>
            <Select value={method} onValueChange={(v) => v && setMethod(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t('cashMovement.optCash')}</SelectItem>
                <SelectItem value="bank">{t('cashMovement.optBank')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('cashMovement.labelReference')}</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('cashMovement.referencePlaceholder')} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('cashMovement.labelNotes')}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>{t('cashMovement.cancel')}</Button>
          <Button
            className={movementType === 'deposit' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-600 hover:bg-orange-700'}
            disabled={isPending}
            onClick={() => mutate()}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('cashMovement.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
