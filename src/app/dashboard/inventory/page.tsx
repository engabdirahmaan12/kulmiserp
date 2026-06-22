'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { usePermission } from '@/lib/hooks/usePermission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductFormModal } from '@/components/inventory/ProductFormModal';
import { ProductDetailSheet } from '@/components/inventory/ProductDetailSheet';
import { StockAdjustModal } from '@/components/inventory/StockAdjustModal';
import {
  Package, Plus, Search, Edit, AlertTriangle, Filter,
  ArrowUpDown, MoreHorizontal, Tag,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { Product } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { ProductImage } from '@/components/media/ProductImage';
import { ReportExportActions } from '@/components/reports/ReportLayout';
import { exportProductsCsv, exportProductsExcel } from '@/lib/export/inventory-export';
import { btnPrimary, inputSoft, tableHead } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { computeDiscountedPrice, type ActiveDiscount } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatAlternateStockSummary } from '@/lib/units/conversion';

async function fetchInventory(storeId: string) {
  const supabase = createClient();
  const [{ data: products, error }, { data: discounts }] = await Promise.all([
    supabase.from('products').select('*, category:product_categories(name, color), base_unit:unit_types!base_unit_id(code), product_units(*, unit_type:unit_types(code, allows_decimal))').eq('store_id', storeId).order('name'),
    supabase.rpc('get_store_active_discounts', { p_store_id: storeId }).then((r) => r),
  ]);
  if (error) throw error;

  const discountMap: Record<string, ActiveDiscount> = {};
  if (discounts && Array.isArray(discounts)) {
    for (const d of (discounts as Array<{ product_id: string; discount_type: 'percentage' | 'fixed'; discount_value: number; source?: string; status?: string }>)) {
      if (d.product_id) discountMap[d.product_id] = { discount_type: d.discount_type, discount_value: d.discount_value, source: d.source, status: d.status };
    }
  }

  return (products ?? []).map((p) => ({
    ...p,
    active_discount: discountMap[p.id] ?? null,
    base_unit_code: (p.base_unit as { code?: string } | null)?.code ?? p.unit ?? 'PCS',
  })) as (Product & {
    category: { name: string; color: string } | null;
    active_discount: ActiveDiscount | null;
    base_unit_code: string;
  })[];
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<PageShell><div className="p-8 text-slate-500">Loading inventory…</div></PageShell>}>
      <InventoryPageInner />
    </Suspense>
  );
}

function InventoryPageInner() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<(Product & { category: { name: string; color: string } | null }) | null>(null);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const { currentStore } = useAuthStore();
  const { canWrite, canDelete, role } = usePermission();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    if (searchParams.get('view') === 'stock') {
      setFilterLowStock(true);
    }
  }, [searchParams]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', currentStore?.id],
    queryFn: () => fetchInventory(currentStore!.id),
    enabled: !!currentStore,
  });

  const { mutate: toggleProduct } = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const supabase = createClient();
      await supabase.from('products').update({ is_active }).eq('id', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      toast.success(t('inventory.productUpdated'));
    },
  });

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.category?.name?.toLowerCase().includes(q);
    const matchLowStock = !filterLowStock || (p.track_inventory && p.stock_quantity <= p.min_stock_level);
    const matchCategory = filterCategory === 'all' || p.category_id === filterCategory;
    const matchBrand = filterBrand === 'all' || p.brand === filterBrand;
    return matchSearch && matchLowStock && matchCategory && matchBrand;
  });

  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      if (p.category_id && p.category?.name) map.set(p.category_id, p.category.name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [products]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.brand?.trim()) set.add(p.brand.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const lowStockCount = products.filter(
    (p) => p.track_inventory && p.stock_quantity <= p.min_stock_level
  ).length;

  const canManage = canWrite('inventory') && role !== 'cashier';

  const activeCount = products.filter((p) => p.is_active).length;
  const outOfStock = products.filter((p) => p.track_inventory && p.stock_quantity <= 0).length;

  return (
    <PageShell>
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.description')}
        icon={Package}
        variant="banner"
        actions={
          <div className="flex items-center gap-2">
            <ReportExportActions
              showAiLink={false}
              showPrintButton={false}
              disabled={!filtered.length}
              onExportCsv={() => exportProductsCsv(filtered)}
              onExportExcel={() => exportProductsExcel(filtered)}
            />
            {canManage ? (
              <Button
                onClick={() => { setEditProduct(null); setShowForm(true); }}
                className={cn(btnPrimary, 'gap-2 h-10 rounded-xl font-semibold')}
              >
                <Plus className="h-4 w-4" /> {t('inventory.addProduct')}
              </Button>
            ) : null}
          </div>
        }
      />

      <StatStrip>
        <StatChip label={t('inventory.totalProducts')} value={String(products.length)} accent="blue" />
        <StatChip label={t('inventory.active')} value={String(activeCount)} sub={t('inventory.inCatalog')} accent="emerald" />
        <StatChip label={t('inventory.lowStock')} value={String(lowStockCount)} accent={lowStockCount > 0 ? 'orange' : 'slate'} />
        <StatChip label={t('inventory.outOfStock')} value={String(outOfStock)} accent={outOfStock > 0 ? 'red' : 'slate'} />
      </StatStrip>

      <PageFilterBar>
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t('inventory.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(inputSoft, 'pl-9')}
            />
          </div>
          <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v ?? 'all')}>
            <SelectTrigger className="w-40 h-10 rounded-xl">
              <SelectValue placeholder={t('inventory.category')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('inventory.allCategories')}</SelectItem>
              {categoryOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterBrand} onValueChange={(v) => setFilterBrand(v ?? 'all')}>
            <SelectTrigger className="w-36 h-10 rounded-xl">
              <SelectValue placeholder={t('inventory.brand')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('inventory.allBrands')}</SelectItem>
              {brandOptions.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={filterLowStock ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterLowStock(!filterLowStock)}
            className={cn(
              'rounded-xl h-10',
              filterLowStock && 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 border-0'
            )}
          >
            <AlertTriangle className="h-4 w-4 mr-1" />
            {t('inventory.lowStock')}
            {lowStockCount > 0 && (
              <Badge className="ml-1 h-4 w-4 p-0 text-[10px] bg-white text-orange-600">
                {lowStockCount}
              </Badge>
            )}
          </Button>
        </div>
      </PageFilterBar>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm border-b border-slate-100">
                <tr>
                  <th className={tableHead}>{t('inventory.product')}</th>
                  <th className={cn(tableHead, 'hidden sm:table-cell')}>{t('inventory.sku')}</th>
                  <th className={cn(tableHead, 'hidden md:table-cell')}>{t('inventory.category')}</th>
                  <th className={cn(tableHead, 'hidden lg:table-cell')}>{t('inventory.brand')}</th>
                  <th className={cn(tableHead, 'text-right')}>{t('inventory.price')}</th>
                  <th className={cn(tableHead, 'text-right hidden lg:table-cell')}>{t('inventory.discount')}</th>
                  <th className={cn(tableHead, 'text-right')}>{t('inventory.stock')}</th>
                  <th className={cn(tableHead, 'text-center')}>{t('inventory.status')}</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((product) => {
                  const isLow = product.track_inventory && product.stock_quantity <= product.min_stock_level;
                  const isOut = product.track_inventory && product.stock_quantity <= 0;
                  const baseCode = (product as { base_unit_code?: string }).base_unit_code ?? product.unit ?? 'PCS';
                  const altStock = formatAlternateStockSummary(
                    product.stock_quantity ?? 0,
                    product.base_unit_id,
                    (product as { product_units?: Parameters<typeof formatAlternateStockSummary>[2] }).product_units ?? [],
                  );

                  return (
                    <tr key={product.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductImage
                            src={product.image_url}
                            alt={product.name}
                            categoryName={product.category?.name}
                            size="xs"
                          />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setDetailProduct(product)}
                              className="font-medium text-slate-900 truncate text-left hover:text-teal-600 hover:underline"
                            >
                              {product.name}
                            </button>
                            <p className="text-xs text-slate-400 truncate md:hidden">
                              {[product.category?.name, product.brand].filter(Boolean).join(' · ') || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                        <code className="text-xs bg-slate-100 rounded px-1 py-0.5">{product.sku || '—'}</code>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {product.category ? (
                          <Badge variant="secondary" className="text-xs">
                            {product.category.name}
                          </Badge>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {product.brand ? (
                          <Badge variant="outline" className="text-xs border-slate-200 text-slate-600">
                            {product.brand}
                          </Badge>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const ad = (product as Product & { active_discount?: ActiveDiscount | null }).active_discount;
                          const discounted = ad ? computeDiscountedPrice(product.selling_price, ad).discountedPrice : null;
                          return (
                            <div>
                              {discounted !== null ? (
                                <>
                                  <p className="font-semibold text-emerald-600">
                                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(discounted)}
                                  </p>
                                  <p className="text-xs text-slate-400 line-through">
                                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(product.selling_price)}
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="font-semibold text-slate-900">
                                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(product.selling_price)}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    {t('inventory.cost', { amount: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(product.cost_price) })}
                                  </p>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        {(() => {
                          const ad = (product as Product & { active_discount?: ActiveDiscount | null }).active_discount;
                          if (!ad) return <span className="text-xs text-slate-300">—</span>;
                          const statusColor = ad.status === 'active' ? 'bg-emerald-100 text-emerald-700' : ad.status === 'scheduled' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
                          return (
                            <div className="flex flex-col items-end gap-1">
                              <Badge className={cn('border-0 text-[10px] gap-0.5', statusColor)}>
                                <Tag className="h-2.5 w-2.5" />
                                {ad.discount_type === 'percentage' ? `${ad.discount_value}%` : t('inventory.off', { value: ad.discount_value })}
                              </Badge>
                              <span className="text-[10px] text-slate-400 capitalize">{ad.status}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {product.track_inventory ? (
                          <div>
                            <p className={`font-semibold tabular-nums ${isOut ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-slate-900'}`}>
                              {product.stock_quantity}{' '}
                              <span className="text-xs font-medium text-slate-500">
                                {(product as { base_unit_code?: string }).base_unit_code ?? product.unit ?? 'PCS'}
                              </span>
                            </p>
                            {altStock && (
                              <p className="text-[10px] text-slate-400 truncate max-w-[120px]" title={altStock}>
                                ≈ {altStock}
                              </p>
                            )}
                            {isLow && !isOut && (
                              <p className="text-xs text-orange-500">{t('inventory.lowStockLabel')}</p>
                            )}
                            {isOut && (
                              <p className="text-xs text-red-500">{t('inventory.outOfStockLabel')}</p>
                            )}
                            <p className="text-[10px] text-slate-400 tabular-nums">
                              Min {product.min_stock_level} {baseCode}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">{t('inventory.notTracked')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          variant={product.is_active ? 'default' : 'secondary'}
                          className={product.is_active ? 'bg-green-100 text-green-700 border-0' : 'bg-slate-100 text-slate-500'}
                        >
                          {product.is_active ? t('inventory.activeStatus') : t('inventory.inactiveStatus')}
                        </Badge>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent">
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setDetailProduct(product)}>
                                <Package className="mr-2 h-4 w-4" />
                                {t('inventory.viewDetails')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setEditProduct(product); setShowForm(true); }}>
                                <Edit className="mr-2 h-4 w-4" />
                                {t('inventory.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setAdjustProduct(product)}>
                                <ArrowUpDown className="mr-2 h-4 w-4" />
                                {t('inventory.adjustStock')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => toggleProduct({ id: product.id, is_active: !product.is_active })}
                              >
                                {product.is_active ? t('inventory.deactivate') : t('inventory.activate')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Package className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">{t('inventory.noProducts')}</p>
                {canManage && (
                  <Button
                    variant="link"
                    className="mt-2 text-blue-600"
                    onClick={() => setShowForm(true)}
                  >
                    {t('inventory.addFirstProduct')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DataPanel>

      {showForm && (
        <ProductFormModal
          open={showForm}
          product={editProduct}
          onClose={() => { setShowForm(false); setEditProduct(null); }}
        />
      )}

      {adjustProduct && (
        <StockAdjustModal
          open={!!adjustProduct}
          product={adjustProduct}
          onClose={() => setAdjustProduct(null)}
        />
      )}

      <ProductDetailSheet
        product={detailProduct}
        open={!!detailProduct}
        onClose={() => setDetailProduct(null)}
        onEdit={(p) => {
          setDetailProduct(null);
          setEditProduct(p);
          setShowForm(true);
        }}
      />
    </PageShell>
  );
}
