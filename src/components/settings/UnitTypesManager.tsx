'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { UnitType } from '@/types';

interface UnitTypesManagerProps {
  unitTypes: UnitType[];
}

export function UnitTypesManager({ unitTypes }: UnitTypesManagerProps) {
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unitKind, setUnitKind] = useState<'base' | 'retail' | 'wholesale' | 'both'>('both');
  const [allowsDecimal, setAllowsDecimal] = useState(false);

  const { mutate: addUnit, isPending } = useMutation({
    mutationFn: async () => {
      const trimmedCode = code.trim().toUpperCase().replace(/\s+/g, '_');
      const trimmedName = name.trim();
      if (!trimmedCode || !trimmedName) throw new Error('Code and name are required');
      if (unitTypes.some((u) => u.code === trimmedCode)) {
        throw new Error(`Unit code "${trimmedCode}" already exists`);
      }

      const supabase = createClient();
      const maxSort = unitTypes.reduce((m, u) => Math.max(m, u.sort_order ?? 0), 0);
      const { error } = await supabase.from('unit_types').insert({
        store_id: currentStore!.id,
        code: trimmedCode,
        name: trimmedName,
        unit_kind: unitKind,
        allows_decimal: allowsDecimal,
        sort_order: maxSort + 1,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unit-types', currentStore?.id] });
      toast.success('Custom unit added');
      setCode('');
      setName('');
      setAllowsDecimal(false);
      setUnitKind('both');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-800">Custom units</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Add store-specific units (e.g. DOZEN, BALE). Standard units are seeded automatically.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="DOZEN"
            className="rounded-lg h-10 uppercase"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dozen"
            className="rounded-lg h-10"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kind</Label>
          <Select value={unitKind} onValueChange={(v) => setUnitKind(v as typeof unitKind)}>
            <SelectTrigger className="rounded-lg h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="base">Base (stock unit)</SelectItem>
              <SelectItem value="retail">Retail</SelectItem>
              <SelectItem value="wholesale">Wholesale</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <Switch checked={allowsDecimal} onCheckedChange={setAllowsDecimal} id="unit-decimal" />
          <Label htmlFor="unit-decimal" className="text-xs cursor-pointer">Allow decimals</Label>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-lg"
        disabled={isPending || !code.trim() || !name.trim()}
        onClick={() => addUnit()}
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
        Add custom unit
      </Button>
    </div>
  );
}
