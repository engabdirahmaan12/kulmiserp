'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { costMethodLabel, inventoryValue } from '@/lib/inventory/costing';
import { formatUnitQty, fromBaseQty } from '@/lib/units/conversion';
import type { ProductUnit } from '@/types';
import { format } from 'date-fns';
import { ProductGallery } from '@/components/media/ProductGallery';
import { ProductImage } from '@/components/media/ProductImage';
import { Edit, History, Package } from 'lucide-react';
import type { Product, ProductCostHistory } from '@/types';
import { cn } from '@/lib/utils';

type ProductRow = Product & {
  category?: { name: string; color?: string } | null;
};

interface ProductDetailSheetProps {
  product: ProductRow | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (product: ProductRow) => void;
}

export function ProductDetailSheet({ product, open, onClose, onEdit }: ProductDetailSheetProps) {
  const { currentStore } = useAuthStore();
  const currency = currentStore?.currency || 'USD';
  const [tab, setTab] = useState<'overview' | 'cost-history'>('overview');

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data: costHistory = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['product-cost-history', product?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('product_cost_history')
        .select('*, supplier:suppliers(name)')
        .eq('product_id', product!.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as (ProductCostHistory & { supplier?: { name: string } | null })[];
    },
    enabled: !!product && open,
  });

  const { data: productImages = [] } = useQuery({
    queryKey: ['product-images', product?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('product_images')
        .select('*')
        .eq('product_id', product!.id)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!product && open,
  });

  const galleryImages =
    productImages.length > 0
      ? productImages.map((img) => ({
          id: img.id,
          image_url: img.image_url,
          thumbnail_url: img.thumbnail_url,
          is_primary: img.is_primary,
        }))
      : product?.image_url
        ? [{ id: 'main', image_url: product.image_url, is_primary: true }]
        : [];

  const { data: productUnits = [] } = useQuery({
    queryKey: ['product-units-detail', product?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('product_units')
        .select('*, unit_type:unit_types(id, code, name, allows_decimal)')
        .eq('product_id', product!.id)
        .order('conversion_factor', { ascending: true });
      if (error) throw error;
      return (data ?? []) as (ProductUnit & { unit_type?: { id: string; code: string; name: string; allows_decimal: boolean } })[];
    },
    enabled: !!product && open,
  });

  const baseUnit = productUnits.find((u) => u.unit_type_id === product?.base_unit_id)
    ?? productUnits.find((u) => u.conversion_factor === 1);
  const baseCode = baseUnit?.unit_type?.code ?? product?.unit ?? 'PCS';
  const alternateUnits = productUnits.filter((u) => u.unit_type_id !== product?.base_unit_id && u.conversion_factor !== 1);

  if (!product) return null;

  const stockBase = product.stock_quantity ?? 0;
  const val = inventoryValue(stockBase, product.cost_price);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col overflow-hidden"
      >
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <SheetTitle className="text-lg font-semibold truncate">{product.name}</SheetTitle>
              <p className="text-xs text-slate-500 mt-1">
                {[product.sku, product.brand, product.category?.name].filter(Boolean).join(' · ') || 'Product details'}
              </p>
            </div>
            {onEdit && (
              <Button variant="outline" size="sm" className="shrink-0 h-8 rounded-lg gap-1" onClick={() => onEdit(product)}>
                <Edit className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex flex-col flex-1 min-h-0">
          <TabsList className="mx-5 mt-3 shrink-0 w-auto justify-start bg-slate-100/80 p-1 rounded-xl">
            <TabsTrigger value="overview" className="rounded-lg gap-1.5 text-xs">
              <Package className="h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="cost-history" className="rounded-lg gap-1.5 text-xs">
              <History className="h-3.5 w-3.5" /> Cost history
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-auto px-5 py-4 mt-0 space-y-4">
            {galleryImages.length > 0 ? (
              <ProductGallery images={galleryImages} productName={product.name} />
            ) : (
              <ProductImage
                src={product.image_url}
                alt={product.name}
                categoryName={product.category?.name}
                size="lg"
                className="mx-auto"
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Stat label={`Stock (${baseCode})`} value={formatUnitQty(stockBase, baseUnit?.unit_type?.allows_decimal ?? false)} />
              <Stat label="Average cost" value={fmt(product.cost_price)} accent="teal" sub={`per ${baseCode}`} />
              <Stat label="Inventory value" value={fmt(val)} accent="blue" />
              <Stat label="Sell price" value={fmt(product.selling_price)} />
            </div>

            {alternateUnits.length > 0 && (
              <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Stock in other units</p>
                <div className="space-y-1.5">
                  {alternateUnits.map((u) => {
                    const code = u.unit_type?.code ?? '?';
                    const qty = fromBaseQty(stockBase, u.conversion_factor);
                    const allowsDec = u.unit_type?.allows_decimal ?? false;
                    return (
                      <div key={u.id ?? u.unit_type_id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">
                          {code}
                          <span className="text-[10px] text-slate-400 ml-1">({u.conversion_factor} {baseCode})</span>
                        </span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          {formatUnitQty(qty, allowsDec)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-100 p-3 text-sm space-y-2 dark:border-slate-800">
              <Row label="Costing method" value={costMethodLabel(currentStore?.inventory_cost_method)} />
              <Row label="Base unit" value={baseCode} />
              <Row label="Min stock" value={`${product.min_stock_level} ${baseCode}`} />
              <Row label="Status" value={product.is_active ? 'Active' : 'Inactive'} />
            </div>

            <p className="text-xs text-slate-400">
              Inventory value = {formatUnitQty(stockBase, false)} {baseCode} × {fmt(product.cost_price)} = {fmt(val)}
            </p>
          </TabsContent>

          <TabsContent value="cost-history" className="flex-1 overflow-auto px-5 py-4 mt-0 min-h-0">
            {loadingHistory ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : costHistory.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">
                <History className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No cost history yet. Receive a purchase order to record cost changes.
              </div>
            ) : (
              <ReportTableShell>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className={reportTableHead}>Date</th>
                      <th className={reportTableHead}>Supplier</th>
                      <th className={reportTableHeadRight}>Qty</th>
                      <th className={reportTableHeadRight}>Purchase $</th>
                      <th className={reportTableHeadRight}>Prev avg</th>
                      <th className={reportTableHeadRight}>New avg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {costHistory.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                          {format(new Date(row.created_at), 'MMM d, yyyy')}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[100px]">
                            {row.supplier?.name ?? '—'}
                          </p>
                          {row.purchase_reference && (
                            <p className="text-[10px] text-slate-400">{row.purchase_reference}</p>
                          )}
                        </td>
                        <td className={cn(reportTableHeadRight.replace('text-left', ''), 'px-3 py-2.5 tabular-nums')}>
                          {row.purchase_qty}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(row.purchase_unit_cost)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{fmt(row.previous_average_cost)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                          {fmt(row.new_average_cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ReportTableShell>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('text-lg font-bold mt-0.5', accent === 'teal' && 'text-teal-600', accent === 'blue' && 'text-blue-600')}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}
