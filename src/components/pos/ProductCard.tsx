'use client';

import { memo, useCallback, useState } from 'react';
import Image from 'next/image';
import {
  Coffee,
  Laptop,
  Package,
  Pill,
  Plus,
  Shirt,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePosStore } from '@/lib/stores/pos';
import type { Product } from '@/types';
import { computeDiscountedPrice } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getEffectivePriceTier, pickDefaultSaleUnit } from '@/lib/pos/units';
import { productBaseUnitCode, profitAtUnit, resolveTierPrice } from '@/lib/units/conversion';
import { useAuthStore } from '@/lib/stores/auth';

export type PosProduct = Product & {
  category?: { name: string; color: string } | null;
  base_unit_code?: string;
};

interface ProductCardProps {
  product: PosProduct;
  onAddProduct: (product: Product) => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);

interface CategoryVisual {
  Icon: LucideIcon;
  bg: string;
  iconColor: string;
  darkBg: string;
  darkIcon: string;
}

function getCategoryVisual(categoryName?: string): CategoryVisual {
  const n = (categoryName || '').toLowerCase();

  if (/drink|beverage|juice|coffee|tea|water|soda/.test(n)) {
    return {
      Icon: Coffee,
      bg: 'bg-gradient-to-br from-cyan-50 to-teal-50',
      iconColor: 'text-cyan-600',
      darkBg: 'dark:from-cyan-950/50 dark:to-teal-950/40',
      darkIcon: 'dark:text-cyan-400',
    };
  }
  if (/electronic|phone|computer|device|tech|gadget/.test(n)) {
    return {
      Icon: Laptop,
      bg: 'bg-gradient-to-br from-violet-50 to-indigo-50',
      iconColor: 'text-violet-600',
      darkBg: 'dark:from-violet-950/50 dark:to-indigo-950/40',
      darkIcon: 'dark:text-violet-400',
    };
  }
  if (/cloth|fashion|apparel|wear|shirt|shoe/.test(n)) {
    return {
      Icon: Shirt,
      bg: 'bg-gradient-to-br from-rose-50 to-pink-50',
      iconColor: 'text-rose-600',
      darkBg: 'dark:from-rose-950/50 dark:to-pink-950/40',
      darkIcon: 'dark:text-rose-400',
    };
  }
  if (/grocery|food|snack|grain|produce|market/.test(n)) {
    return {
      Icon: ShoppingBag,
      bg: 'bg-gradient-to-br from-amber-50 to-orange-50',
      iconColor: 'text-amber-600',
      darkBg: 'dark:from-amber-950/50 dark:to-orange-950/40',
      darkIcon: 'dark:text-amber-400',
    };
  }
  if (/medic|pharm|health|drug|vitamin/.test(n)) {
    return {
      Icon: Pill,
      bg: 'bg-gradient-to-br from-emerald-50 to-green-50',
      iconColor: 'text-emerald-600',
      darkBg: 'dark:from-emerald-950/50 dark:to-green-950/40',
      darkIcon: 'dark:text-emerald-400',
    };
  }

  return {
    Icon: Package,
    bg: 'bg-gradient-to-br from-slate-50 to-slate-100',
    iconColor: 'text-slate-500',
    darkBg: 'dark:from-slate-800/60 dark:to-slate-900/60',
    darkIcon: 'dark:text-slate-400',
  };
}

function ProductCardInner({ product, onAddProduct }: ProductCardProps) {
  const { t } = useTranslation();
  const { currentStore } = useAuthStore();
  const customer = usePosStore((s) => s.customer);
  const [imgError, setImgError] = useState(false);
  const [flash, setFlash] = useState(false);

  const cartBadge = usePosStore(
    useCallback((s) => {
      let lineCount = 0;
      let singleQty = 0;
      for (const item of s.items) {
        if (item.product_id !== product.id) continue;
        lineCount += 1;
        if (lineCount === 1) singleQty = item.quantity;
      }
      if (lineCount === 0) return 0;
      if (lineCount === 1) return singleQty;
      return lineCount;
    }, [product.id]),
  );
  const isInCart = cartBadge > 0;
  const isOutOfStock = product.track_inventory && product.stock_quantity <= 0;
  const isLowStock =
    product.track_inventory &&
    product.stock_quantity <= product.min_stock_level &&
    product.stock_quantity > 0;
  const defaultUnit = pickDefaultSaleUnit(product);
  const conversion = defaultUnit?.conversion_factor ?? 1;
  const tier = getEffectivePriceTier(
    product,
    customer,
    (currentStore?.settings ?? {}) as Record<string, unknown>,
  );
  const listPrice = defaultUnit
    ? resolveTierPrice(
        defaultUnit,
        tier,
        {
          retail: product.selling_price,
          wholesale: product.wholesale_price,
          distributor: product.distributor_price,
        },
        conversion,
      )
    : resolveTierPrice(
        {
          retail_price: product.selling_price,
          wholesale_price: product.wholesale_price,
          distributor_price: product.distributor_price,
        },
        tier,
        undefined,
        1,
      );
  const ad = product.active_discount;
  const { discountedPrice, discountAmount: discAmt } = ad && ad.discount_value > 0
    ? computeDiscountedPrice(listPrice, ad.discount_type, ad.discount_value)
    : { discountedPrice: listPrice, discountAmount: 0 };
  const hasDiscount = discAmt > 0;
  const profit = profitAtUnit(discountedPrice, product.cost_price, conversion).profit;
  const showImage = Boolean(product.image_url) && !imgError;
  const categoryVisual = getCategoryVisual(product.category?.name);
  const { Icon: CategoryIcon } = categoryVisual;
  const codeLabel = product.barcode || product.sku;
  const baseUnit = product.base_unit_code ?? productBaseUnitCode(product);

  const handleClick = () => {
    if (isOutOfStock) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 450);
    onAddProduct(product);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isOutOfStock}
      aria-label={`Add ${product.name} to cart`}
      className={cn(
        'pos-product-card group relative flex flex-col rounded-2xl border p-2.5 text-left',
        'bg-white/95 backdrop-blur-sm shadow-sm',
        'border-slate-100/90',
        'transition-all duration-200 ease-out',
        'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-teal-500/10 hover:border-teal-200/80',
        'active:scale-[0.98]',
        'dark:bg-slate-900/90 dark:border-slate-700/60',
        'dark:hover:border-teal-500/40 dark:hover:shadow-teal-500/5',
        isInCart && 'ring-2 ring-teal-500/50 border-teal-300/80 dark:border-teal-500/50 dark:ring-teal-400/30',
        isOutOfStock && 'opacity-55 cursor-not-allowed hover:translate-y-0 hover:shadow-sm',
        flash && 'pos-product-card-flash',
      )}
    >
      {/* Cart quantity badge */}
      {isInCart && (
        <span
          key={cartBadge}
          className="absolute -top-1.5 -right-1.5 z-20 flex h-6 min-w-6 items-center justify-center rounded-full bg-teal-600 px-1.5 text-[11px] font-bold text-white shadow-md shadow-teal-600/30 animate-in zoom-in-50 duration-200 dark:bg-teal-500"
        >
          {cartBadge}
        </span>
      )}

      {/* Low stock badge — qty in base units */}
      {isLowStock && !isOutOfStock && (
        <span className="absolute top-2 left-2 z-10 rounded-full bg-orange-500/90 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm tabular-nums">
          {product.stock_quantity} {baseUnit}
        </span>
      )}

      {/* Image / category icon */}
      <div
        className={cn(
          'relative mb-2.5 aspect-[4/3] w-full overflow-hidden rounded-xl',
          !showImage && categoryVisual.bg,
          !showImage && categoryVisual.darkBg,
        )}
      >
        {showImage ? (
          <Image
            src={product.image_url!}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 16vw"
            loading="lazy"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-2xl bg-white/70 shadow-inner',
                'dark:bg-slate-800/70',
              )}
            >
              <CategoryIcon
                className={cn('h-6 w-6', categoryVisual.iconColor, categoryVisual.darkIcon)}
                strokeWidth={1.75}
              />
            </div>
          </div>
        )}

        {/* Profit badge — on image area to avoid cart badge overlap */}
        {profit > 0 && !isOutOfStock && (
          <span className="absolute bottom-2 left-2 z-10 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 backdrop-blur-sm">
            +{fmt(profit)}
          </span>
        )}

        {/* Hover add hint */}
        {!isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-teal-600/0 opacity-0 transition-all duration-200 group-hover:bg-teal-600/10 group-hover:opacity-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg translate-y-1 group-hover:translate-y-0 transition-transform duration-200">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </span>
          </div>
        )}

        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px]">
            <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-600 shadow dark:bg-slate-900/95 dark:text-red-400">
              {t('pos.outOfStock')}
            </span>
          </div>
        )}
      </div>

      {/* Product info */}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <p className="text-[13px] font-semibold leading-snug text-slate-900 line-clamp-2 dark:text-slate-100">
          {product.name}
        </p>

        {(product.category?.name || product.brand) && (
          <p className="text-[10px] text-slate-400 truncate">
            {[product.category?.name, product.brand].filter(Boolean).join(' · ')}
          </p>
        )}

        {codeLabel && (
          <p className="truncate text-[10px] font-mono text-slate-400 dark:text-slate-500">
            {codeLabel}
          </p>
        )}

        {/* Discount badge */}
        {hasDiscount && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">
              -{ad!.discount_type === 'percentage' ? `${ad!.discount_value}%` : fmt(ad!.discount_value)}
            </span>
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-1 pt-1.5">
          <div className="flex flex-col">
            {hasDiscount && (
              <span className="text-[10px] line-through text-slate-400 tabular-nums">
                {fmt(product.selling_price)}
              </span>
            )}
            <span className={cn(
              'text-base font-bold tabular-nums',
              hasDiscount ? 'text-red-600 dark:text-red-400' : 'text-teal-600 dark:text-teal-400'
            )}>
              {fmt(discountedPrice)}
            </span>
          </div>

          {product.track_inventory && (
            <span
              className={cn(
                'text-[10px] font-semibold tabular-nums shrink-0',
                isOutOfStock
                  ? 'text-red-500'
                  : isLowStock
                    ? 'text-orange-500'
                    : 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              {isOutOfStock ? '0' : product.stock_quantity} {baseUnit}
            </span>
          )}
        </div>
        
      </div>
    </button>
  );
}

function productCardPropsAreEqual(prev: ProductCardProps, next: ProductCardProps) {
  const a = prev.product;
  const b = next.product;
  return (
    prev.onAddProduct === next.onAddProduct &&
    a.id === b.id &&
    a.name === b.name &&
    a.selling_price === b.selling_price &&
    a.cost_price === b.cost_price &&
    a.stock_quantity === b.stock_quantity &&
    a.min_stock_level === b.min_stock_level &&
    a.image_url === b.image_url &&
    a.barcode === b.barcode &&
    a.sku === b.sku &&
    a.unit === b.unit &&
    a.base_unit_code === b.base_unit_code &&
    a.track_inventory === b.track_inventory &&
    a.category?.name === b.category?.name &&
    a.brand === b.brand &&
    a.active_discount?.discount_value === b.active_discount?.discount_value &&
    a.active_discount?.promotion_id === b.active_discount?.promotion_id
  );
}

export const ProductCard = memo(ProductCardInner, productCardPropsAreEqual);
