'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Truck, Plus, Search, ArrowLeft, MoreHorizontal, Edit } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import type { Supplier } from '@/types';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { btnPrimary, inputSoft } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

const supplierSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  notes: z.string().optional(),
});

type SupplierForm = z.infer<typeof supplierSchema>;

export default function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('suppliers')
        .select('*')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .order('name');
      return data as Supplier[];
    },
    enabled: !!currentStore,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierForm>({
    resolver: zodResolver(supplierSchema),
  });

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: SupplierForm) => {
      const supabase = createClient();
      const payload = { ...data, store_id: currentStore!.id };
      if (editSupplier) {
        await supabase.from('suppliers').update(payload).eq('id', editSupplier.id);
      } else {
        await supabase.from('suppliers').insert(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', currentStore?.id] });
      toast.success(editSupplier ? t('suppliers.supplierUpdated') : t('suppliers.supplierAdded'));
      setShowForm(false);
      setEditSupplier(null);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = suppliers.filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.phone?.includes(search)
  );

  const openEdit = (supplier: Supplier) => {
    setEditSupplier(supplier);
    reset({
      name: supplier.name,
      contact_person: supplier.contact_person || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      notes: supplier.notes || '',
    });
    setShowForm(true);
  };

  const totalPayables = suppliers.reduce((s, sup) => s + (sup.balance > 0 ? sup.balance : 0), 0);

  return (
    <PageShell>
      <PageHeader
        title={t('suppliers.title')}
        description={t('suppliers.description')}
        icon={Truck}
        variant="banner"
        actions={
          <Button
            onClick={() => { setEditSupplier(null); reset({}); setShowForm(true); }}
            className={cn(btnPrimary, 'gap-2 h-10 rounded-xl font-semibold')}
          >
            <Plus className="h-4 w-4" /> {t('suppliers.addSupplier')}
          </Button>
        }
      />

      <StatStrip>
        <StatChip label={t('suppliers.count')} value={String(suppliers.length)} accent="blue" />
        <StatChip label={t('suppliers.payables')} value={totalPayables.toFixed(2)} accent={totalPayables > 0 ? 'orange' : 'slate'} />
        <StatChip label={t('suppliers.active')} value={String(suppliers.filter((s) => s.is_active).length)} accent="emerald" />
        <StatChip label={t('suppliers.withBalance')} value={String(suppliers.filter((s) => s.balance > 0).length)} accent="violet" />
      </StatStrip>

      <PageFilterBar>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder={t('suppliers.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(inputSoft, 'pl-9')}
          />
        </div>
      </PageFilterBar>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('suppliers.supplier')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden sm:table-cell">{t('suppliers.contact')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden md:table-cell">{t('suppliers.phone')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('suppliers.balance')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-600 shrink-0">
                          {supplier.name.charAt(0).toUpperCase()}
                        </div>
                        <p className="font-medium text-slate-900">{supplier.name}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{supplier.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{supplier.phone || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={supplier.balance > 0 ? 'font-semibold text-red-600' : 'text-slate-400'}>
                        {supplier.balance > 0 ? `${supplier.balance.toFixed(2)}` : '0.00'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(supplier)}>Edit</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <Truck className="h-10 w-10 mx-auto mb-2 text-slate-200" />
                      <p className="text-slate-400 text-sm">{t('suppliers.noSuppliers')}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <DialogTitle>{editSupplier ? t('suppliers.editSupplier') : t('suppliers.addSupplier')}</DialogTitle>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('suppliers.supplierName')} *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('suppliers.contactPerson')}</Label>
                <Input {...register('contact_person')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('suppliers.phone')}</Label>
                <Input type="tel" {...register('phone')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('suppliers.email')}</Label>
              <Input type="email" {...register('email')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('suppliers.address')}</Label>
              <Input {...register('address')} />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>{t('suppliers.cancel')}</Button>
              <Button type="submit" className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40" disabled={isPending}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editSupplier ? t('suppliers.update') : t('suppliers.add')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
