'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, StatStrip, StatChip } from '@/components/layout/PageShell';
import { btnPrimary, inputSoft } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Bookmark, Search, Package, TrendingUp } from 'lucide-react';
import type { Product } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface BrandStat {
  name: string;
  product_count: number;
  total_stock: number;
  stock_value: number;
}

async function fetchBrands(storeId: string): Promise<{ brands: BrandStat[]; products: (Product & { category?: { name: string } | null })[] }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('products')
    .select('*, category:product_categories(name)')
    .eq('store_id', storeId)
    .not('brand', 'is', null)
    .order('name');
  if (error) throw error;
  const products = (data ?? []) as (Product & { category?: { name: string } | null })[];
  const map = new Map<string, BrandStat>();
  for (const p of products) {
    if (!p.brand) continue;
    const existing = map.get(p.brand) ?? { name: p.brand, product_count: 0, total_stock: 0, stock_value: 0 };
    existing.product_count++;
    existing.total_stock += p.stock_quantity;
    existing.stock_value += p.stock_quantity * p.cost_price;
    map.set(p.brand, existing);
  }
  const brands = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { brands, products };
}

export default function BrandsPage() {
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string>('');
  const [newName, setNewName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['brands', currentStore?.id],
    queryFn: () => fetchBrands(currentStore!.id),
    enabled: !!currentStore,
  });

  const currency = currentStore?.currency ?? 'USD';
  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  const brands = data?.brands ?? [];
  const products = data?.products ?? [];

  const filtered = brands.filter((b) =>
    !search || b.name.toLowerCase().includes(search.toLowerCase())
  );

  const brandProducts = selectedBrand
    ? products.filter((p) => p.brand === selectedBrand)
    : [];

  const { mutate: renameBrand, isPending: renaming } = useMutation({
    mutationFn: async ({ oldName, newBrandName }: { oldName: string; newBrandName: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from('products')
        .update({ brand: newBrandName.trim() })
        .eq('store_id', currentStore!.id)
        .eq('brand', oldName);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands', currentStore?.id] });
      toast.success(t('brands.brandRenamed'));
      setShowRenameDialog(false);
      setSelectedBrand(newName.trim());
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openRename = (name: string) => {
    setRenameTarget(name);
    setNewName(name);
    setShowRenameDialog(true);
  };

  const BRAND_COLORS = [
    'bg-blue-100 text-blue-700',
    'bg-green-100 text-green-700',
    'bg-purple-100 text-purple-700',
    'bg-orange-100 text-orange-700',
    'bg-teal-100 text-teal-700',
    'bg-pink-100 text-pink-700',
    'bg-yellow-100 text-yellow-700',
    'bg-indigo-100 text-indigo-700',
  ];

  const totalProducts = brands.reduce((s, b) => s + b.product_count, 0);
  const totalStock = brands.reduce((s, b) => s + b.total_stock, 0);
  const totalValue = brands.reduce((s, b) => s + b.stock_value, 0);

  return (
    <PageShell>
      <PageHeader
        title={t('brands.title')}
        description={t('brands.description')}
        icon={Bookmark}
        variant="banner"
      />

      <StatStrip>
        <StatChip label={t('brands.count')} value={String(brands.length)} accent="blue" />
        <StatChip label={t('brands.products')} value={String(totalProducts)} accent="emerald" />
        <StatChip label={t('brands.totalStock')} value={totalStock.toLocaleString()} accent="violet" />
        <StatChip label={t('brands.stockValue')} value={fmtC(totalValue)} accent="orange" />
      </StatStrip>

      <PageFilterBar>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder={t('brands.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(inputSoft, 'pl-9')}
          />
        </div>
      </PageFilterBar>

      {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <Bookmark className="h-16 w-16 mb-4 opacity-20" />
            <p className="text-base font-medium mb-1">{t('brands.noBrandsFound')}</p>
            <p className="text-sm">{t('brands.derivedHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((brand, i) => (
              <div
                key={brand.name}
                onClick={() => setSelectedBrand(brand.name)}
                className="group bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer hover:border-blue-200 hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${BRAND_COLORS[i % BRAND_COLORS.length]}`}>
                    {brand.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{brand.name}</p>
                    <p className="text-xs text-slate-400">{t('brands.productsCount', { count: brand.product_count })}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 rounded-lg p-2">
                    <p className="text-slate-400">{t('brands.totalStock')}</p>
                    <p className="font-semibold text-slate-900">{brand.total_stock.toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <p className="text-slate-400">{t('brands.stockValue')}</p>
                    <p className="font-semibold text-slate-900">{fmtC(brand.stock_value)}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); openRename(brand.name); }}
                  className="mt-2 w-full text-xs text-slate-400 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100"
                >
                  {t('brands.renameBrand')}
                </button>
              </div>
            ))}
          </div>
        )}
      {/* Brand Products Side Sheet */}
      <Sheet open={!!selectedBrand} onOpenChange={() => setSelectedBrand(null)}>
        <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col overflow-hidden">
          <SheetHeader className="shrink-0 px-5 pt-5 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2">
              <Bookmark className="h-5 w-5 text-blue-600" />
              {selectedBrand}
            </SheetTitle>
          </SheetHeader>
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <p className="text-sm text-slate-500">{t('brands.productsCount', { count: brandProducts.length })}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { if (selectedBrand) openRename(selectedBrand); }}
            >
              {t('brands.renameBrandBtn')}
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-3 space-y-2">
            {brandProducts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border">
                  <Package className="h-4 w-4 text-slate-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {[p.category?.name, p.sku || t('brands.noSku')].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(p.selling_price)}
                  </p>
                  <p className="text-xs text-slate-400">{t('brands.stock', { count: p.stock_quantity })}</p>
                </div>
              </div>
            ))}
            {brandProducts.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('brands.noProducts')}</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('brands.renameBrandTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>{t('brands.newBrandName')}</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('brands.newBrandPlaceholder')}
            />
            <p className="text-xs text-slate-400 mt-1">
              {t('brands.renameWarning', { name: renameTarget })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameDialog(false)}>{t('brands.cancel')}</Button>
            <Button
              onClick={() => renameBrand({ oldName: renameTarget, newBrandName: newName })}
              disabled={!newName.trim() || newName.trim() === renameTarget || renaming}
              className={btnPrimary}
            >
              {renaming ? t('brands.renaming') : t('brands.rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
