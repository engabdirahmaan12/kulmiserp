'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PLAN_SLUG_LABELS } from '@/lib/platform/roles';
import { sa } from '@/components/super-admin/ui';

interface Props {
  store: { id: string; name: string; subscription_plan?: string | null };
  open: boolean;
  onClose: () => void;
}

const PRESETS = [
  { label: '+30 Days', days: 30, months: 0, years: 0 },
  { label: '+90 Days', days: 90, months: 0, years: 0 },
  { label: '+1 Month', days: 0, months: 1, years: 0 },
  { label: '+3 Months', days: 0, months: 3, years: 0 },
  { label: '+1 Year', days: 0, months: 0, years: 1 },
];

export function ExtendSubscriptionDialog({ store, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState(store.subscription_plan ?? 'basic');

  const extend = useMutation({
    mutationFn: async (preset: typeof PRESETS[0]) => {
      const res = await fetch(`/api/super-admin/stores/${store.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend',
          days: preset.days,
          months: preset.months,
          years: preset.years,
          plan_slug: plan,
        }),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-stores'] });
      queryClient.invalidateQueries({ queryKey: ['super-admin-store', store.id] });
      queryClient.invalidateQueries({ queryKey: ['super-admin-stats'] });
      toast.success(`Subscription extended for ${store.name}`);
      onClose();
    },
    onError: () => toast.error('Failed to extend subscription'),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-950/95 backdrop-blur-xl border-white/10 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-slate-50">Extend Subscription</DialogTitle>
          <p className="text-sm text-slate-400 font-normal">{store.name}</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wide font-medium">Plan</p>
            <Select value={plan} onValueChange={(v) => setPlan(v ?? 'basic')}>
              <SelectTrigger className={sa.input}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PLAN_SLUG_LABELS).map(([slug, label]) => (
                  <SelectItem key={slug} value={slug}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                variant="outline"
                className="border-white/10 bg-white/[0.03] hover:bg-indigo-600/15 hover:border-indigo-500/40 transition-all duration-200"
                disabled={extend.isPending}
                onClick={() => extend.mutate(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}