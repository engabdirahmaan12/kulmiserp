'use client';

import { memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductCard, type PosProduct } from './ProductCard';
import type { Product } from '@/types';

interface ProductGridProps {
  products: PosProduct[];
  isLoading: boolean;
  onAddProduct: (product: Product) => void;
}

const GRID_CLASS =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-3 sm:p-4';

function ProductCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900/90">
      <Skeleton className="mb-2.5 aspect-[4/3] w-full rounded-xl" />
      <Skeleton className="mb-1.5 h-3.5 w-full" />
      <Skeleton className="mb-2 h-3 w-2/3" />
      <div className="flex justify-between">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  );
}

function ProductGridInner({ products, isLoading, onAddProduct }: ProductGridProps) {
  if (isLoading) {
    return (
      <div className={GRID_CLASS}>
        {Array.from({ length: 18 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className={GRID_CLASS}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAddProduct={onAddProduct} />
      ))}
    </div>
  );
}

export const ProductGrid = memo(ProductGridInner);
