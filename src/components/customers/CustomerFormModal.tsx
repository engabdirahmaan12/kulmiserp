'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Users, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { Customer } from '@/types';
import { PRICE_TIER_LABELS } from '@/lib/units/conversion';
import { getPriceLevelsEnabled } from '@/lib/pos/pricing';
import type { PriceTier } from '@/lib/units/conversion';

const schema = z.object({
  full_name: z.string().min(1, 'Name is required'),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  credit_limit: z.number().min(0).default(0),
  price_tier: z.enum(['retail', 'wholesale', 'distributor', 'vip']).default('retail'),
});

type FormData = z.infer<typeof schema>;

interface CustomerFormModalProps {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onCreated?: (customer: Customer) => void;
}

export function CustomerFormModal({ open, customer, onClose, onCreated }: CustomerFormModalProps) {
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: { price_tier: 'retail' },
  });

  const priceTier = watch('price_tier');
  const priceLevelsEnabled = getPriceLevelsEnabled(currentStore?.settings as Record<string, unknown> | undefined);
  const priceTierOptions = (Object.keys(PRICE_TIER_LABELS) as PriceTier[]).filter(
    (tier) => priceLevelsEnabled || tier !== 'vip',
  );

  useEffect(() => {
    if (customer) {
      reset({
        full_name: customer.full_name,
        phone: customer.phone || '',
        email: customer.email || '',
        address: customer.address || '',
        notes: customer.notes || '',
        credit_limit: customer.credit_limit,
        price_tier: (customer.price_tier as PriceTier) ?? 'retail',
      });
    } else {
      reset({ full_name: '', phone: '', email: '', address: '', notes: '', credit_limit: 0, price_tier: 'retail' });
    }
  }, [customer, reset]);

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: FormData) => {
      const supabase = createClient();
      const payload = {
        full_name: data.full_name,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        notes: data.notes || null,
        credit_limit: data.credit_limit || 0,
        price_tier: data.price_tier,
        store_id: currentStore!.id,
      };
      if (customer) {
        const { error } = await supabase.from('customers').update(payload).eq('id', customer.id);
        if (error) throw error;
        return { ...customer, ...payload } as Customer;
      } else {
        const { data: created, error } = await supabase.from('customers').insert(payload).select().single();
        if (error) throw error;
        return created as Customer;
      }
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['customers', currentStore?.id] });
      toast.success(customer ? 'Customer updated' : 'Customer added');
      if (!customer && created && onCreated) onCreated(created);
      onClose();
      reset();
    },
    onError: (e) => toast.error('Failed: ' + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              {customer ? 'Edit Customer' : 'Add Customer'}
            </DialogTitle>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full Name *</Label>
            <Input id="full_name" {...register('full_name')} className={errors.full_name ? 'border-red-500' : ''} />
            {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" type="tel" {...register('phone')} placeholder="+252..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Input id="address" {...register('address')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="credit_limit">Credit Limit</Label>
              <Input id="credit_limit" type="number" step="0.01" {...register('credit_limit', { valueAsNumber: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Price tier</Label>
              <Select value={priceTier} onValueChange={(v) => setValue('price_tier', v as PriceTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priceTierOptions.map((tier) => (
                    <SelectItem key={tier} value={tier}>{PRICE_TIER_LABELS[tier]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">POS uses this tier for pricing</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" {...register('notes')} placeholder="Optional notes..." />
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40" disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {customer ? 'Update' : 'Add Customer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
