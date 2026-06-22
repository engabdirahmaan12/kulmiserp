'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { usePermission } from '@/lib/hooks/usePermission';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Layers } from 'lucide-react';
import { costMethodLabel, COST_METHOD_OPTIONS, type InventoryCostMethod } from '@/lib/inventory/costing';
import { toSelectItems } from '@/lib/ui/select-utils';
import type { Product, InventoryCostLayer, Store } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

type ValuationProduct = Pick<
  Product,
  'id' | 'name' | 'sku' | 'stock_quantity' | 'cost_price' | 'brand'
> & {
  category?: { name: string } | null;
};

type CostLayerRow = InventoryCostLayer & {
  product?: {
    name: string;
    sku?: string;
    brand?: string | null;
    category?: { name: string } | null;
  };
};

const cell = 'px-3 py-2.5';
const cellRight = cn(cell, 'text-right tabular-nums');

function productMeta(category?: string | null, brand?: string | null) {
  return [category, brand].filter(Boolean).join(' · ');
}

function ProductCell({
  name,
  sku,
  category,
  brand,
}: {
  name: string;
  sku?: string | null;
  category?: string | null;
  brand?: string | null;
}) {
  const { t } = useTranslation();
  const meta = productMeta(category, brand);
  return (
    <td className={cell}>
      <p className="font-medium text-slate-900 dark:text-white leading-tight">{name}</p>
      <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
        {sku && <code>{sku}</code>}
        {sku && meta ? ' · ' : null}
        {meta || (!sku ? t('invValuation.noCategoryOrBrand') : null)}
      </p>
    </td>
  );
}

export function InventoryValuationTab() {
  const { currentStore, user, setCurrentStore } = useAuthStore();
  const { t } = useTranslation();
  const { role } = usePermission();
  const canBackfill = role === 'owner' || role === 'manager';
  const queryClient = useQueryClient();
  const [view, setView] = useState<'products' | 'layers'>('products');
  const currency = currentStore?.currency || 'USD';
  const costMethod = (currentStore?.inventory_cost_method || 'average') as InventoryCostMethod;
  const methodItems = useMemo(
    () => toSelectItems(COST_METHOD_OPTIONS, (o) => o.value, (o) => o.label),
    [],
  );
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products-valuation', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, stock_quantity, cost_price, brand, category:product_categories(name)')
        .eq('store_id', currentStore!.id)
        .eq('track_inventory', true)
        .gt('stock_quantity', 0)
        .order('name');
      return data as unknown as ValuationProduct[];
    },
    enabled: !!currentStore,
  });

  const { data: layers = [], isLoading: loadingLayers } = useQuery({
    queryKey: ['cost-layers', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('inventory_cost_layers')
        .select('*, product:products(name, sku, brand, category:product_categories(name))')
        .eq('store_id', currentStore!.id)
        .gt('quantity_remaining', 0)
        .order('received_at', { ascending: true });
      return data as CostLayerRow[];
    },
    enabled: !!currentStore,
  });

  const { mutate: updateMethod, isPending } = useMutation({
    mutationFn: async (method: InventoryCostMethod) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_store_accounting_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_inventory_cost_method: method,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed to update');
    },
    onSuccess: async () => {
      const supabase = createClient();
      const { data } = await supabase.from('stores').select('*').eq('id', currentStore!.id).single();
      if (data) setCurrentStore(data as Store);
      queryClient.invalidateQueries({ queryKey: ['products-valuation', currentStore?.id] });
      toast.success('Cost method updated');
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: backfillLayers, isPending: backfilling } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('backfill_unlayered_cost_layers', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string; layers_created?: number };
      if (!res?.success) throw new Error(res?.error || 'Backfill failed');
      return res.layers_created ?? 0;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['cost-layers', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['products-valuation', currentStore?.id] });
      toast.success(
        created > 0
          ? `Created ${created} opening FIFO layer${created === 1 ? '' : 's'} at current cost price`
          : 'All stock already has FIFO layers',
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const fifoByProduct = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>();
    for (const l of layers) {
      const cur = map.get(l.product_id) ?? { qty: 0, value: 0 };
      map.set(l.product_id, {
        qty: cur.qty + l.quantity_remaining,
        value: cur.value + l.quantity_remaining * l.unit_cost,
      });
    }
    return map;
  }, [layers]);

  const averageTotal = products.reduce((s, p) => s + p.stock_quantity * (p.cost_price || 0), 0);
  const fifoTotal = layers.reduce((s, l) => s + l.quantity_remaining * l.unit_cost, 0);
  const valuationGap = averageTotal - fifoTotal;
  const hasGap = Math.abs(valuationGap) > 0.01;

  const productRows = useMemo(
    () =>
      products.map((p) => {
        const avgValue = p.stock_quantity * (p.cost_price || 0);
        const fifo = fifoByProduct.get(p.id);
        const fifoValue = fifo?.value ?? 0;
        const fifoQty = fifo?.qty ?? 0;
        const unlayeredQty = Math.max(0, p.stock_quantity - fifoQty);
        const overlayQty = Math.max(0, fifoQty - p.stock_quantity);
        const unlayeredValue = unlayeredQty * (p.cost_price || 0);
        const costVariance = unlayeredQty === 0 && overlayQty === 0 ? avgValue - fifoValue : 0;
        return {
          ...p,
          avgValue,
          fifoValue,
          fifoQty,
          unlayeredQty,
          overlayQty,
          unlayeredValue,
          costVariance,
          gap: avgValue - fifoValue,
        };
      }),
    [products, fifoByProduct],
  );

  const totalUnlayeredQty = productRows.reduce((s, p) => s + p.unlayeredQty, 0);
  const totalOverlayQty = productRows.reduce((s, p) => s + p.overlayQty, 0);
  const totalCostVariance = productRows.reduce((s, p) => s + p.costVariance, 0);

  const gapKind: 'aligned' | 'unlayered' | 'overlay' | 'cost' =
    !hasGap
      ? 'aligned'
      : totalUnlayeredQty > 0
        ? 'unlayered'
        : totalOverlayQty > 0
          ? 'overlay'
          : 'cost';

  if (loadingProducts || loadingLayers) return <Skeleton className="h-48 rounded-2xl" />;

  const activeCol =
    costMethod === 'average'
      ? 'bg-violet-50/80 dark:bg-violet-950/30 font-semibold text-violet-900 dark:text-violet-200'
      : 'bg-emerald-50/80 dark:bg-emerald-950/30 font-semibold text-emerald-900 dark:text-emerald-200';

  const gapCard = {
    aligned: { label: t('invValuation.gapAlignedLabel'), subtitle: t('invValuation.gapAlignedSub'), warn: false },
    unlayered: { label: t('invValuation.gapUnlayeredLabel'), subtitle: t('invValuation.gapUnlayeredSub'), warn: true },
    overlay: { label: t('invValuation.gapOverlayLabel'), subtitle: t('invValuation.gapOverlaySub'), warn: true },
    cost: { label: t('invValuation.gapCostLabel'), subtitle: t('invValuation.gapCostSub'), warn: false },
  }[gapKind];

  const gapDisplay =
    gapKind === 'cost' ? fmt(Math.abs(valuationGap)) : hasGap ? fmt(valuationGap) : fmt(0);

  const gapSign =
    gapKind === 'cost'
      ? valuationGap < 0
        ? t('invValuation.gapFifoHigher')
        : t('invValuation.gapAvgHigher')
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('invValuation.title')}</h3>
          <p className="text-xs text-slate-500">
            {t('invValuation.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('invValuation.labelCostMethod')}</span>
          <Select
            value={costMethod}
            items={methodItems}
            onValueChange={(v) => v && updateMethod(v as InventoryCostMethod)}
            disabled={isPending}
          >
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COST_METHOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge className="bg-violet-50 text-violet-700">{costMethodLabel(costMethod)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/50">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">{t('invValuation.kpiWac')}</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{fmt(averageTotal)}</p>
          <p className="text-[11px] text-slate-400 mt-1">{t('invValuation.kpiProductsInStock', { n: String(products.length) })}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/50">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">{t('invValuation.kpiFifo')}</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{fmt(fifoTotal)}</p>
          <p className="text-[11px] text-slate-400 mt-1">{t('invValuation.kpiOpenLayers', { n: String(layers.length) })}</p>
        </div>
        <div
          className={cn(
            'rounded-xl border p-4',
            gapCard.warn
              ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20'
              : gapKind === 'cost'
                ? 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50'
                : 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50',
          )}
        >
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">{gapCard.label}</p>
          <p
            className={cn(
              'text-xl font-bold tabular-nums mt-0.5',
              gapCard.warn
                ? 'text-amber-800 dark:text-amber-200'
                : gapKind === 'cost'
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-900 dark:text-white',
            )}
          >
            {gapDisplay}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {gapSign ?? gapCard.subtitle}
          </p>
        </div>
      </div>

      {gapKind === 'unlayered' && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-amber-800/90 dark:text-amber-200/90 rounded-lg border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2.5">
          <p>
            {t('invValuation.unlayeredWarning', { qty: totalUnlayeredQty.toLocaleString(), val: fmt(valuationGap) })}
          </p>
          {canBackfill && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 h-8 text-xs border-amber-300 bg-white hover:bg-amber-50 dark:bg-slate-900"
              onClick={() => backfillLayers()}
              disabled={backfilling}
            >
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              {backfilling ? t('invValuation.creatingLayers') : t('invValuation.createLayersBtn')}
            </Button>
          )}
        </div>
      )}

      {gapKind === 'overlay' && (
        <p className="text-xs text-amber-800/90 dark:text-amber-200/90 rounded-lg border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2.5">
          {t('invValuation.overlayWarning', { qty: totalOverlayQty.toLocaleString() })}
        </p>
      )}

      {gapKind === 'cost' && (
        <p className="text-xs text-slate-600 dark:text-slate-400 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 px-3 py-2.5">
          {t('invValuation.costNoteBody', { val: fmt(Math.abs(valuationGap)), sign: (gapSign ?? '').toLowerCase(), method: costMethod })}
        </p>
      )}

      <Tabs value={view} onValueChange={(v) => setView(v as 'products' | 'layers')}>
        <TabsList className="h-8">
          <TabsTrigger value="products" className="text-xs px-3 h-7">
            {t('invValuation.tabByProduct', { n: String(products.length) })}
          </TabsTrigger>
          <TabsTrigger value="layers" className="text-xs px-3 h-7">
            {t('invValuation.tabLayers', { n: String(layers.length) })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-3">
          <ReportTableShell>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={reportTableHead}>{t('invValuation.colProduct')}</th>
                  <th className={reportTableHeadRight}>{t('invValuation.colQty')}</th>
                  <th className={reportTableHeadRight}>{t('invValuation.colAvgCost')}</th>
                  <th className={cn(reportTableHeadRight, costMethod === 'average' && 'text-violet-600')}>
                    {t('invValuation.colAvgValue')}
                  </th>
                  <th className={cn(reportTableHeadRight, costMethod === 'fifo' && 'text-emerald-600')}>
                    {t('invValuation.colFifoValue')}
                  </th>
                  <th className={reportTableHeadRight}>{t('invValuation.colVariance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {productRows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                    <ProductCell
                      name={p.name}
                      sku={p.sku}
                      category={p.category?.name}
                      brand={p.brand}
                    />
                    <td className={cellRight}>{p.stock_quantity.toLocaleString()}</td>
                    <td className={cellRight}>{fmt(p.cost_price || 0)}</td>
                    <td className={cn(cellRight, costMethod === 'average' && activeCol)}>{fmt(p.avgValue)}</td>
                    <td className={cn(cellRight, costMethod === 'fifo' && activeCol)}>
                      {p.fifoValue > 0 ? fmt(p.fifoValue) : '—'}
                    </td>
                    <td className={cellRight}>
                      {p.unlayeredQty > 0 ? (
                        <span className="text-amber-700 dark:text-amber-300" title="Units without FIFO layer">
                          {t('invValuation.unlayeredSuffix', { n: p.unlayeredQty.toLocaleString() })}
                          <span className="block text-[10px] font-normal opacity-80">{fmt(p.unlayeredValue)}</span>
                        </span>
                      ) : p.overlayQty > 0 ? (
                        <span className="text-amber-700 dark:text-amber-300" title="FIFO layers exceed on-hand qty">
                          +{p.overlayQty.toLocaleString()} layers
                        </span>
                      ) : Math.abs(p.gap) > 0.01 ? (
                        <span
                          className={cn(
                            p.gap < 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-400',
                          )}
                          title="Average value minus FIFO value"
                        >
                          {p.gap > 0 ? '−' : '+'}
                          {fmt(Math.abs(p.gap))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {productRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                      {t('invValuation.noProducts')}
                    </td>
                  </tr>
                )}
              </tbody>
              {productRows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 font-semibold">
                    <td className={cell}>{t('invValuation.footerTotals')}</td>
                    <td className={cellRight}>
                      {productRows.reduce((s, p) => s + p.stock_quantity, 0).toLocaleString()}
                    </td>
                    <td className={cellRight}>—</td>
                    <td className={cn(cellRight, costMethod === 'average' && activeCol)}>{fmt(averageTotal)}</td>
                    <td className={cn(cellRight, costMethod === 'fifo' && activeCol)}>{fmt(fifoTotal)}</td>
                    <td className={cellRight}>
                      {totalUnlayeredQty > 0
                        ? t('invValuation.unlayeredSuffix', { n: totalUnlayeredQty.toLocaleString() })
                        : Math.abs(totalCostVariance) > 0.01
                          ? fmt(Math.abs(totalCostVariance))
                          : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </ReportTableShell>
        </TabsContent>

        <TabsContent value="layers" className="mt-3">
          <ReportTableShell>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={reportTableHead}>{t('invValuation.colProduct')}</th>
                  <th className={reportTableHeadRight}>{t('invValuation.colQty')}</th>
                  <th className={reportTableHeadRight}>{t('invValuation.colUnitCost')}</th>
                  <th className={reportTableHeadRight}>{t('invValuation.colLayerValue')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {layers.map((l) => {
                  const prod = productsById.get(l.product_id);
                  return (
                    <tr key={l.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                      <ProductCell
                        name={l.product?.name || prod?.name || 'Product'}
                        sku={l.product?.sku || prod?.sku}
                        category={prod?.category?.name || l.product?.category?.name}
                        brand={prod?.brand || l.product?.brand}
                      />
                      <td className={cellRight}>{l.quantity_remaining.toLocaleString()}</td>
                      <td className={cellRight}>{fmt(l.unit_cost)}</td>
                      <td className={cn(cellRight, 'font-medium')}>
                        {fmt(l.quantity_remaining * l.unit_cost)}
                      </td>
                    </tr>
                  );
                })}
                {layers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">
                      {t('invValuation.noLayers')}
                    </td>
                  </tr>
                )}
              </tbody>
              {layers.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 font-semibold">
                    <td className={cell}>{t('invValuation.footerTotal')}</td>
                    <td className={cellRight}>
                      {layers.reduce((s, l) => s + l.quantity_remaining, 0).toLocaleString()}
                    </td>
                    <td className={cellRight}>—</td>
                    <td className={cellRight}>{fmt(fifoTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </ReportTableShell>
        </TabsContent>
      </Tabs>
    </div>
  );
}
