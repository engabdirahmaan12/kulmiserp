'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, DataPanel, StatStrip, StatChip, EmptyState } from '@/components/layout/PageShell';
import { btnPrimary, tableHead } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileClock, Play, Trash2 } from 'lucide-react';
import type { Sale, SaleItem } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

type DraftSale = Sale & { items: SaleItem[] };

async function fetchDrafts(storeId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales')
    .select('*, items:sale_items(*)')
    .eq('store_id', storeId)
    .in('status', ['draft', 'held'])
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data as DraftSale[];
}

async function deleteSale(saleId: string) {
  const supabase = createClient();
  // Delete sale items first, then the sale
  await supabase.from('sale_items').delete().eq('sale_id', saleId);
  const { error } = await supabase.from('sales').delete().eq('id', saleId);
  if (error) throw error;
}

function fmtCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DraftsPage() {
  const router = useRouter();
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const currency = currentStore?.currency || 'USD';

  const [deleteTarget, setDeleteTarget] = useState<DraftSale | null>(null);

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ['drafts', currentStore?.id],
    queryFn: () => fetchDrafts(currentStore!.id),
    enabled: !!currentStore,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSale,
    onSuccess: () => {
      toast.success(t('drafts.draftDeleted'));
      queryClient.invalidateQueries({ queryKey: ['drafts', currentStore?.id] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error(t('drafts.deleteFailed'));
    },
  });

  const handleResume = (sale: DraftSale) => {
    if (sale.status === 'held') {
      sessionStorage.setItem('resume_pos_held_id', sale.id);
      router.push('/dashboard/pos');
      return;
    }
    sessionStorage.setItem('resume_custom_draft_id', sale.id);
    router.push('/dashboard/custom-sales');
  };

  const heldCount = drafts.filter((d) => d.status === 'held').length;
  const draftCount = drafts.filter((d) => d.status === 'draft').length;
  const totalValue = drafts.reduce((s, d) => s + d.total_amount, 0);

  return (
    <PageShell>
      <PageHeader
        title={t('drafts.title')}
        description={t('drafts.description')}
        icon={FileClock}
        variant="banner"
        actions={
          <Button
            variant="outline"
            className="h-10 rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={() => router.push('/dashboard/pos')}
          >
            {t('drafts.goToPos')}
          </Button>
        }
      />

      <StatStrip>
        <StatChip label={t('drafts.total')} value={String(drafts.length)} accent="blue" />
        <StatChip label={t('drafts.draftsLabel')} value={String(draftCount)} accent="violet" />
        <StatChip label={t('drafts.heldCarts')} value={String(heldCount)} accent={heldCount > 0 ? 'orange' : 'slate'} />
        <StatChip label={t('drafts.totalValue')} value={fmtCurrency(totalValue, currency)} accent="emerald" />
      </StatStrip>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : drafts.length === 0 ? (
          <EmptyState
            icon={FileClock}
            title={t('drafts.noDrafts')}
            description={t('drafts.noDraftsDesc')}
            action={
              <Button variant="outline" className="rounded-xl" onClick={() => router.push('/dashboard/pos')}>
                {t('drafts.goToPos')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-100">
                <tr>
                  <th className={tableHead}>{t('drafts.invoiceCol')}</th>
                  <th className={cn(tableHead, 'hidden md:table-cell')}>{t('drafts.date')}</th>
                  <th className={cn(tableHead, 'text-center hidden sm:table-cell')}>{t('drafts.items')}</th>
                  <th className={cn(tableHead, 'text-right')}>{t('drafts.amount')}</th>
                  <th className={cn(tableHead, 'text-center')}>{t('drafts.status')}</th>
                  <th className={cn(tableHead, 'text-right')}>{t('drafts.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drafts.map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono text-sm font-medium text-slate-900">
                        {sale.invoice_number}
                      </p>
                      <p className="text-xs text-slate-400 md:hidden">
                        {fmtDate(sale.updated_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                      {fmtDate(sale.updated_at)}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600 hidden sm:table-cell">
                      {t('drafts.itemsCount', { count: sale.items?.length ?? 0 })}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {fmtCurrency(sale.total_amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {sale.status === 'held' ? (
                        <Badge className="bg-orange-100 text-orange-700 border-0 text-[11px]">
                          {t('drafts.held')}
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-700 border-0 text-[11px]">
                          {t('drafts.draft')}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          className={cn(btnPrimary, 'h-8 gap-1.5 text-xs rounded-lg')}
                          onClick={() => handleResume(sale)}
                        >
                          <Play className="h-3.5 w-3.5" />
                          {t('drafts.resume')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0 text-red-500 hover:bg-red-50 hover:text-red-600 border-red-200"
                          onClick={() => setDeleteTarget(sale)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      {/* Delete Confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('drafts.deleteDraftTitle')}</DialogTitle>
            <DialogDescription>
              {t('drafts.deleteDraftDesc', { invoice: deleteTarget?.invoice_number ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('drafts.cancel')}
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {t('drafts.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
