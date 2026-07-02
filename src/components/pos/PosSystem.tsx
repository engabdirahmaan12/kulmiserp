'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { usePosStore } from '@/lib/stores/pos';
import { ProductGrid } from './ProductGrid';
import { CartPanel } from './CartPanel';
import { CheckoutModal } from './CheckoutModal';
import { HeldCartsSheet } from './HeldCartsSheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarcodeScannerField } from '@/components/barcode/BarcodeScannerField';
import { PauseCircle, ShoppingBag, Package } from 'lucide-react';
import type { Product, ProductUnit, QuantityPriceRow } from '@/types';
import { computeDiscountedPrice } from '@/types';
import { buildCartItemFromProduct, getEffectivePriceTier, getSaleUnitsForProduct } from '@/lib/pos/units';
import { ProductAddUnitDialog } from './ProductAddUnitDialog';
import { productBaseUnitCode } from '@/lib/units/conversion';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { buildBarcodeIndex, type BarcodeScanHit } from '@/lib/barcode/utils';
import { useBarcodeScanner } from '@/lib/barcode/useBarcodeScanner';
import {
  deleteHeldCartFromDatabase,
  fetchHeldCartsFromDatabase,
  saveHeldCartToDatabase,
} from '@/lib/pos/held-cart-persistence';
import { useTranslation } from '@/lib/i18n/useTranslation';

async function fetchProducts(storeId: string) {
  const supabase = createClient();
  const [{ data, error }, { data: discountData }, { data: qtyPriceData }] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:product_categories(name, color), product_units(*, unit_type:unit_types(*))')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('name'),
    supabase.rpc('get_store_active_discounts', { p_store_id: storeId }),
    supabase
      .from('product_quantity_prices')
      .select('id, product_id, unit_type_id, price_tier, min_qty, max_qty, price')
      .eq('store_id', storeId)
      .eq('is_active', true),
  ]);
  if (error) throw error;

  const discountMap = new Map<string, Product['active_discount']>();
  if (discountData) {
    for (const d of discountData as Array<{
      product_id: string; source: string; discount_type: string;
      discount_value: number; promotion_id?: string; promotion_name?: string;
    }>) {
      discountMap.set(d.product_id, {
        source: d.source as 'product' | 'promotion',
        discount_type: d.discount_type as 'percentage' | 'fixed',
        discount_value: d.discount_value,
        promotion_id: d.promotion_id,
        promotion_name: d.promotion_name,
      });
    }
  }

  // Group quantity-break prices by "product_id:unit_type_id" so they can be
  // attached to the matching product_units row below.
  const qtyPriceMap = new Map<string, QuantityPriceRow[]>();
  for (const row of (qtyPriceData ?? []) as Array<QuantityPriceRow & { product_id: string; unit_type_id: string }>) {
    const key = `${row.product_id}:${row.unit_type_id}`;
    const list = qtyPriceMap.get(key) ?? [];
    list.push({ id: row.id, price_tier: row.price_tier, min_qty: row.min_qty, max_qty: row.max_qty, price: row.price });
    qtyPriceMap.set(key, list);
  }

  return (data ?? []).map((p) => ({
    ...p,
    active_discount: discountMap.get(p.id) ?? null,
    base_unit_code: productBaseUnitCode(p),
    product_units: (p.product_units ?? []).map((pu: ProductUnit) => ({
      ...pu,
      quantity_prices: qtyPriceMap.get(`${p.id}:${pu.unit_type_id}`) ?? [],
    })),
  })) as (Product & { category: { name: string; color: string } | null; base_unit_code?: string })[];
}

async function fetchCategories(storeId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from('product_categories')
    .select('*')
    .eq('store_id', storeId)
    .order('name');
  return data || [];
}

export default function PosSystem() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeBrand, setActiveBrand] = useState<string>('all');
  const [showHeld, setShowHeld] = useState(false);
  const [holdName, setHoldName] = useState('');
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [addUnitProduct, setAddUnitProduct] = useState<Product | null>(null);
  const [mobileView, setMobileView] = useState<'products' | 'cart'>('products');

  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();
  const {
    items,
    addItem,
    customer,
    isCheckoutOpen,
    setCheckoutOpen,
    offline_queue,
    held_carts,
    holdCart,
    mergeHeldCarts,
    markHeldCartPersisted,
    resumeCart,
  } = usePosStore();
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', currentStore?.id],
    queryFn: () => fetchProducts(currentStore!.id),
    enabled: !!currentStore,
    staleTime: 60 * 1000,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', currentStore?.id],
    queryFn: () => fetchCategories(currentStore!.id),
    enabled: !!currentStore,
  });

  const barcodeIndex = useMemo(() => buildBarcodeIndex(products), [products]);

  const applyProductDiscount = useCallback((cartItem: ReturnType<typeof buildCartItemFromProduct>, product: Product) => {
    if (!cartItem) return null;
    const ad = product.active_discount;
    if (ad && ad.discount_value > 0) {
      const { discountAmount: da } = computeDiscountedPrice(cartItem.unit_price, ad.discount_type, ad.discount_value);
      return {
        ...cartItem,
        discount_amount: da,
        subtotal: cartItem.unit_price * cartItem.quantity - da + cartItem.tax_amount,
      };
    }
    return cartItem;
  }, []);

  const commitAddToCart = useCallback((cartItem: NonNullable<ReturnType<typeof buildCartItemFromProduct>>, product: Product) => {
    const finalItem = applyProductDiscount(cartItem, product) ?? cartItem;
    const ok = addItem(finalItem);
    if (!ok) {
      toast.error(t('pos.outOfStockToast', { name: product.name }));
      return false;
    }
    const ad = product.active_discount;
    if (ad && ad.discount_value > 0) {
      toast.success(
        t('pos.addedWithDiscount', { name: product.name, source: ad.source === 'promotion' ? (ad.promotion_name ?? '') : t('pos.productDiscount') }),
        { duration: 2000 },
      );
    } else {
      toast.success(t('pos.added', { name: product.name }), { duration: 1200 });
    }
    return true;
  }, [addItem, applyProductDiscount, t]);

  const handleAddProductWithUnit = useCallback((product: Product, saleUnitId?: string) => {
    const saleUnits = getSaleUnitsForProduct(product);
    const pickedUnit = saleUnitId
      ? saleUnits.find((u) => u.unit_type_id === saleUnitId)
      : undefined;

    if (saleUnits.length > 1 && !pickedUnit) {
      setAddUnitProduct(product);
      return;
    }

    const tier = getEffectivePriceTier(
      product,
      customer,
      (currentStore?.settings ?? {}) as Record<string, unknown>,
    );
    const cartItem = buildCartItemFromProduct(product, tier, pickedUnit ?? undefined, items);
    if (!cartItem) {
      toast.error(t('pos.outOfStockToast', { name: product.name }));
      return;
    }
    commitAddToCart(cartItem, product);
  }, [commitAddToCart, customer, currentStore?.settings, items, t]);

  const handleAddProduct = useCallback((product: Product) => {
    handleAddProductWithUnit(product);
  }, [handleAddProductWithUnit]);

  const onBarcodeScan = useCallback(
    (code: string, hit?: BarcodeScanHit) => {
      if (hit) {
        handleAddProductWithUnit(hit.product, hit.saleUnitId);
        setSearch('');
      } else {
        toast.error(t('pos.noProductForCode', { code }));
      }
    },
    [handleAddProductWithUnit, t],
  );

  const { hiddenInputRef, handleHiddenInputKeyDown } = useBarcodeScanner({
    index: barcodeIndex,
    onScan: onBarcodeScan,
    enabled: !isCheckoutOpen,
  });

  useEffect(() => {
    if (!currentStore?.id) return;
    fetchHeldCartsFromDatabase(currentStore.id)
      .then((dbCarts) => mergeHeldCarts(dbCarts))
      .catch(() => { /* offline / unauthenticated */ });
  }, [currentStore?.id, mergeHeldCarts]);

  useEffect(() => {
    const resumeId = sessionStorage.getItem('resume_pos_held_id');
    if (!resumeId || !currentStore) return;
    sessionStorage.removeItem('resume_pos_held_id');
    fetchHeldCartsFromDatabase(currentStore.id)
      .then((carts) => {
        const cart = carts.find((c) => c.id === resumeId || c.db_sale_id === resumeId);
        if (cart) {
          mergeHeldCarts([cart]);
          resumeCart(cart.id);
          toast.success('Held cart restored');
        }
      })
      .catch(() => toast.error('Failed to restore held cart'));
  }, [currentStore, mergeHeldCarts, resumeCart]);

  // Keyboard shortcut: F2 checkout, F3 hold
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && items.length > 0) {
        e.preventDefault();
        setCheckoutOpen(true);
      }
      if (e.key === 'F3' && items.length > 0) {
        e.preventDefault();
        setShowHoldDialog(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, setCheckoutOpen]);

  const filteredProducts = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.barcode?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.category?.name?.toLowerCase().includes(q);
    const matchCategory = activeCategory === 'all' || p.category_id === activeCategory;
    const matchBrand = activeBrand === 'all' || p.brand === activeBrand;
    return matchSearch && matchCategory && matchBrand;
  });

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.brand?.trim()) set.add(p.brand.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const handleScannerField = (code: string) => {
    const hit = barcodeIndex.get(code.trim().toLowerCase());
    if (hit) {
      onBarcodeScan(code, hit);
    } else {
      toast.error(t('pos.noProductForCode', { code }));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Hidden input for USB wedge when not in search field */}
      <input
        ref={hiddenInputRef}
        type="text"
        className="absolute opacity-0 pointer-events-none h-0 w-0"
        aria-hidden
        onKeyDown={handleHiddenInputKeyDown}
      />

      <div className="flex items-center gap-2 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm px-4 py-2.5 shrink-0 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex-1 max-w-lg">
          <BarcodeScannerField
            value={search}
            onChange={setSearch}
            onScan={handleScannerField}
            placeholder={t('pos.searchScan')}
            autoFocus
            inputClassName="h-10 bg-slate-50/80 rounded-xl border-slate-200"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="hidden sm:flex gap-1.5 h-10 rounded-xl border-slate-200"
          onClick={() => items.length > 0 ? setShowHoldDialog(true) : setShowHeld(true)}
        >
          <PauseCircle className="h-4 w-4" />
          {t('pos.hold')}
          {held_carts.length > 0 && (
            <Badge className="h-4 w-4 p-0 text-[10px] bg-orange-500 ml-0.5">{held_carts.length}</Badge>
          )}
        </Button>

        {offline_queue.length > 0 && (
          <Badge variant="secondary" className="bg-orange-100 text-orange-700 gap-1 hidden sm:flex">
            {t('pos.offlineCount', { count: offline_queue.length })}
          </Badge>
        )}

        <Button
          variant={mobileView === 'cart' ? 'default' : 'outline'}
          size="sm"
          className="md:hidden h-9 relative"
          onClick={() => setMobileView(mobileView === 'cart' ? 'products' : 'cart')}
        >
          <ShoppingBag className="h-4 w-4" />
          {itemCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 text-[10px] bg-teal-600">
              {itemCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className={cn('flex gap-2 px-4 py-2 overflow-x-auto bg-white border-b border-slate-100 shrink-0 dark:bg-slate-900 dark:border-slate-800', mobileView === 'cart' && 'hidden md:flex')}>
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
            activeCategory === 'all'
              ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/25'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          )}
        >
          {t('pos.all')}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeCategory === cat.id
                ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/25'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            )}
          >
            {cat.name}
          </button>
        ))}
        {brandOptions.length > 0 && (
          <span className="shrink-0 w-px h-5 bg-slate-200 mx-1 self-center" aria-hidden />
        )}
        {brandOptions.map((brand) => (
          <button
            key={brand}
            type="button"
            onClick={() => setActiveBrand(activeBrand === brand ? 'all' : brand)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeBrand === brand
                ? 'bg-violet-600 text-white shadow-sm shadow-violet-600/25'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            )}
          >
            {brand}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className={cn('flex-1 overflow-auto bg-slate-50/60 dark:bg-slate-950', mobileView === 'cart' && 'hidden md:flex md:flex-col')}>
          <ProductGrid products={filteredProducts} isLoading={isLoading} onAddProduct={handleAddProduct} />
          {filteredProducts.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <Package className="h-12 w-12" />
              <p className="text-sm">{t('pos.noProducts')}</p>
            </div>
          )}
        </div>

        <div className={cn(
          'border-l border-slate-200 bg-white flex flex-col min-h-0 overflow-hidden',
          'w-full md:w-80 lg:w-96',
          mobileView === 'products' && 'hidden md:flex'
        )}>
          <CartPanel products={products} />
        </div>
      </div>

      <CheckoutModal
        open={isCheckoutOpen}
        onClose={() => setCheckoutOpen(false)}
        products={products}
        onComplete={() => setMobileView('products')}
      />

      <ProductAddUnitDialog
        open={!!addUnitProduct}
        product={addUnitProduct}
        tier={getEffectivePriceTier(
          addUnitProduct,
          customer,
          (currentStore?.settings ?? {}) as Record<string, unknown>,
        )}
        cartItems={items}
        currency={currentStore?.currency ?? 'USD'}
        onClose={() => setAddUnitProduct(null)}
        onAdd={(item) => {
          if (!addUnitProduct) return false;
          const withDiscount = applyProductDiscount(item, addUnitProduct) ?? item;
          return commitAddToCart(withDiscount, addUnitProduct);
        }}
      />
      <HeldCartsSheet open={showHeld} onClose={() => setShowHeld(false)} />

      {showHoldDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl p-4 w-full max-w-sm shadow-xl space-y-3">
            <p className="font-semibold text-slate-900">{t('pos.holdCurrentCart')}</p>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder={t('pos.cartNamePlaceholder')}
              value={holdName}
              onChange={(e) => setHoldName(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowHoldDialog(false)}>{t('pos.cancel')}</Button>
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={async () => {
                  const name = holdName || `${t('pos.hold')} ${held_carts.length + 1}`;
                  const held = holdCart(name);
                  setHoldName('');
                  setShowHoldDialog(false);
                  if (held && currentStore && user) {
                    try {
                      const dbId = await saveHeldCartToDatabase({
                        storeId: currentStore.id,
                        userId: user.id,
                        name,
                        items: held.items,
                        customer: held.customer ?? null,
                        discount_amount: held.discount_amount,
                        discount_type: held.discount_type,
                      });
                      markHeldCartPersisted(held.id, dbId);
                    } catch {
                      toast.warning('Cart held locally — cloud sync failed');
                    }
                  }
                  toast.success(t('pos.cartHeld'));
                }}
              >
                {t('pos.hold')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
