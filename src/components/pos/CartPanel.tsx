'use client';

import { usePosStore } from '@/lib/stores/pos';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Trash2, Plus, Minus, User, Tag, ShoppingCart } from 'lucide-react';
import { CustomerSearch } from './CustomerSearch';
import { CartItemEditModal } from './CartItemEditModal';
import { CartLineUnitSelect } from './CartLineUnitSelect';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CartItem, Product } from '@/types';
import { getDefaultPriceTier } from '@/lib/pos/units';
import { PRICE_TIER_LABELS } from '@/lib/units/conversion';
import { findBelowCostItems, getPosAllowBelowCost } from '@/lib/pos/pricing';
import { validateCartStock } from '@/lib/pos/stock';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function CartPanel({ products = [] }: { products?: Product[] }) {
  const { t } = useTranslation();
  const {
    items,
    customer,
    cart_tier,
    discount_amount,
    discount_type,
    removeItem,
    updateQuantity,
    replaceCartLine,
    syncStockLimits,
    setCartTier,
    setCustomer,
    setDiscount,
    clearCart,
    setCheckoutOpen,
  } = usePosStore();

  const { currentStore } = useAuthStore();
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [editItem, setEditItem] = useState<CartItem | null>(null);

  const currency = currentStore?.currency || 'USD';
  const allowBelowCost = getPosAllowBelowCost(
    (currentStore?.settings ?? {}) as Record<string, unknown>,
  );

  const cartStockKey = items
    .map((i) => `${i.line_key}:${i.quantity}:${i.sale_unit_id ?? ''}:${i.product_id}`)
    .join('|');
  const productStockKey = products
    .map((p) => `${p.id}:${p.stock_quantity}`)
    .join('|');

  useEffect(() => {
    if (items.length === 0 || products.length === 0) return;
    syncStockLimits(products);
  }, [cartStockKey, productStockKey, items.length, products, syncStockLimits]);

  // When a customer is assigned/cleared, pre-set the cart-level tier to their
  // price level (walk-in → store default). The cashier can still flip it after.
  useEffect(() => {
    const tier = getDefaultPriceTier(customer, (currentStore?.settings ?? {}) as Record<string, unknown>);
    setCartTier(tier, products);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when customer tier changes
  }, [customer?.id, customer?.price_tier, products.length]);

  const productMap = new Map(products.map((p) => [p.id, p]));

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity - i.discount_amount, 0);
  const taxAmount = items.reduce((s, i) => {
    const base = i.unit_price * i.quantity - i.discount_amount;
    return s + base * (i.tax_rate / 100);
  }, 0);
  const discountAmt =
    discount_type === 'percentage'
      ? subtotal * (discount_amount / 100)
      : discount_amount;
  const total = subtotal - discountAmt + taxAmount;

  const handleQtyInput = (item: CartItem, raw: string) => {
    const qty = item.allows_decimal ? parseFloat(raw) : parseInt(raw, 10);
    if (!raw || Number.isNaN(qty)) return;
    if (qty <= 0) {
      removeItem(item.line_key);
      return;
    }
    if (item.track_inventory && item.max_stock !== undefined && qty > item.max_stock) {
      toast.error(t('pos.onlyInStock', { count: item.max_stock }));
      updateQuantity(item.line_key, item.max_stock, products);
      return;
    }
    updateQuantity(item.line_key, qty, products);
  };

  const handleCheckout = () => {
    if (!allowBelowCost) {
      const bad = findBelowCostItems(items);
      if (bad.length > 0) {
        toast.error(t('pos.belowCostError', { name: bad[0].product_name }));
        return;
      }
    }
    const stockErr = validateCartStock(items, products);
    if (stockErr) {
      toast.error(stockErr);
      return;
    }
    setCheckoutOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-indigo-600" />
          {t('pos.cart')}
          {items.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-[10px] font-bold text-white">
              {items.length}
            </span>
          )}
        </h3>
        {items.length > 0 && (
          <button
            onClick={clearCart}
            className="text-xs text-red-500 hover:text-red-700 font-medium"
          >
            {t('pos.clearAll')}
          </button>
        )}
      </div>

      {/* Cart-level Retail / Wholesale price switch — one tap reprices the whole cart. */}
      <div className="border-b border-slate-100 px-4 py-2.5">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          {(['retail', 'wholesale'] as const).map((tier) => {
            const active = cart_tier === tier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setCartTier(tier, products)}
                className={cn(
                  'rounded-lg py-2 text-sm font-semibold transition-all',
                  active
                    ? tier === 'wholesale'
                      ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white/70',
                )}
              >
                {tier === 'retail' ? t('pos.priceRetail') : t('pos.priceWholesale')}
              </button>
            );
          })}
        </div>
        {customer?.price_tier && customer.price_tier === cart_tier && (
          <p className="mt-1 text-[10px] text-slate-400 text-center">{t('pos.tierFromCustomer')}</p>
        )}
      </div>

      <div className="border-b border-slate-100 px-4 py-2">
        {customer ? (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600">
              <User className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{customer.full_name}</p>
              <p className="text-xs text-slate-500">
                {customer.phone}
                {customer.price_tier ? (
                  <span className="ml-1.5 text-indigo-600 font-medium">
                    · {PRICE_TIER_LABELS[customer.price_tier as keyof typeof PRICE_TIER_LABELS] ?? customer.price_tier}
                  </span>
                ) : null}
              </p>
            </div>
            <button
              onClick={() => setCustomer(null)}
              className="text-slate-400 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCustomerSearch(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            <User className="h-4 w-4" />
            {t('pos.addCustomerOptional')}
          </button>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
            <ShoppingCart className="h-8 w-8 opacity-30" />
            <p className="text-sm">{t('pos.cartEmpty')}</p>
            <p className="text-xs">{t('pos.clickToAdd')}</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {items.map((item) => (
              <div
                key={item.line_key}
                className="flex gap-2 rounded-lg bg-slate-50 p-2.5 cursor-pointer hover:bg-slate-100/80 transition-colors"
                onDoubleClick={() => setEditItem(item)}
                title={t('pos.editTooltip')}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-900 truncate">{item.product_name}</p>
                    <CartLineUnitSelect
                      item={item}
                      product={productMap.get(item.product_id) ?? null}
                      cartItems={items}
                      customer={customer}
                      storeSettings={(currentStore?.settings ?? {}) as Record<string, unknown>}
                      onUnitChange={(oldKey, newItem) => replaceCartLine(oldKey, newItem)}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    {fmt(item.unit_price)} × {item.quantity} = {fmt(item.unit_price * item.quantity - item.discount_amount)}
                  </p>
                  {item.discount_amount > 0 && (
                    <p className="text-[10px] text-green-600">{t('pos.discShort')} -{fmt(item.discount_amount)}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); updateQuantity(item.line_key, item.quantity - 1, products); }}
                    className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <Input
                    type="number"
                    min={item.allows_decimal ? 0.001 : 1}
                    step={item.allows_decimal ? 'any' : 1}
                    value={item.quantity}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleQtyInput(item, e.target.value)}
                    className="h-7 w-12 px-1 text-center text-sm font-semibold"
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); updateQuantity(item.line_key, item.quantity + 1, products); }}
                    disabled={item.track_inventory && item.max_stock !== undefined && item.quantity >= item.max_stock}
                    className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-40 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeItem(item.line_key); }}
                    className="ml-1 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {items.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2 shrink-0">
          {showDiscount ? (
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder={t('pos.discountPlaceholder')}
                value={discount_amount || ''}
                onChange={(e) => setDiscount(parseFloat(e.target.value) || 0, discount_type)}
                className="h-8 text-sm"
              />
              <div className="flex rounded-md border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setDiscount(discount_amount, 'fixed')}
                  className={cn(
                    'px-2 text-xs font-medium transition-colors',
                    discount_type === 'fixed' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  $
                </button>
                <button
                  onClick={() => setDiscount(discount_amount, 'percentage')}
                  className={cn(
                    'px-2 text-xs font-medium transition-colors',
                    discount_type === 'percentage' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  %
                </button>
              </div>
              <button
                onClick={() => { setShowDiscount(false); setDiscount(0, 'fixed'); }}
                className="text-xs text-slate-400 hover:text-red-500"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDiscount(true)}
              className="flex w-full items-center gap-2 text-xs text-slate-500 hover:text-blue-600 transition-colors"
            >
              <Tag className="h-3.5 w-3.5" />
              {t('pos.addDiscount')}
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="border-t border-slate-200 px-4 py-3 space-y-1.5 shrink-0">
          <div className="flex justify-between text-sm text-slate-600">
            <span>{t('pos.subtotal')}</span>
            <span>{currency} {fmt(subtotal)}</span>
          </div>
          {discountAmt > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>{t('pos.discount')}</span>
              <span>-{currency} {fmt(discountAmt)}</span>
            </div>
          )}
          {taxAmount > 0 && (
            <div className="flex justify-between text-sm text-slate-600">
              <span>{t('pos.tax')}</span>
              <span>{currency} {fmt(taxAmount)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-bold text-slate-900">
            <span className="text-base">{t('pos.total')}</span>
            <span className="text-lg text-indigo-600">{currency} {fmt(total)}</span>
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 p-4 shrink-0 bg-white">
        <Button
          className="w-full h-12 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-base font-semibold shadow-md shadow-emerald-200/40 rounded-xl"
          disabled={items.length === 0}
          onClick={handleCheckout}
        >
          {t('pos.checkoutWithTotal', { amount: `${currency} ${fmt(total)}` })}
        </Button>
      </div>

      <CustomerSearch
        open={showCustomerSearch}
        onClose={() => setShowCustomerSearch(false)}
        onSelect={(c) => { setCustomer(c); setShowCustomerSearch(false); }}
      />

      <CartItemEditModal
        open={!!editItem}
        item={editItem}
        product={editItem ? productMap.get(editItem.product_id) ?? null : null}
        allowBelowCost={allowBelowCost}
        currency={currency}
        onClose={() => setEditItem(null)}
        onReplace={(lineKey, newItem) => replaceCartLine(lineKey, newItem)}
      />
    </div>
  );
}
