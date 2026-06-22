'use client';

import { useState } from 'react';
import Image from 'next/image';
import { getCategoryVisual } from '@/lib/media/category-visual';
import { cn } from '@/lib/utils';

interface ProductImageProps {
  src?: string | null;
  alt: string;
  categoryName?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'pos';
  className?: string;
  rounded?: 'md' | 'lg' | 'xl' | '2xl';
  priority?: boolean;
}

const SIZE = {
  xs: { box: 'h-9 w-9', px: 36 },
  sm: { box: 'h-12 w-12', px: 48 },
  md: { box: 'h-20 w-20', px: 80 },
  lg: { box: 'h-32 w-32', px: 128 },
  pos: { box: 'h-[7.5rem] w-full', px: 200 },
};

const ROUNDED = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
};

export function ProductImage({
  src,
  alt,
  categoryName,
  size = 'sm',
  className,
  rounded = 'lg',
  priority = false,
}: ProductImageProps) {
  const [err, setErr] = useState(false);
  const visual = getCategoryVisual(categoryName);
  const { box, px } = SIZE[size];
  const round = ROUNDED[rounded];

  if (src && !err) {
    if (size === 'pos') {
      return (
        <div className={cn('relative overflow-hidden bg-slate-100', box, round, className)}>
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(max-width:640px) 50vw, 200px"
            className="object-cover"
            loading={priority ? undefined : 'lazy'}
            priority={priority}
            onError={() => setErr(true)}
          />
        </div>
      );
    }

    return (
      <div className={cn('relative overflow-hidden bg-slate-100 shrink-0', box, round, className)}>
        <Image
          src={src}
          alt={alt}
          width={px}
          height={px}
          className="object-cover h-full w-full"
          loading={priority ? undefined : 'lazy'}
          priority={priority}
          onError={() => setErr(true)}
        />
      </div>
    );
  }

  const Icon = visual.Icon;
  return (
    <div
      className={cn(
        'flex items-center justify-center shrink-0',
        visual.bg,
        box,
        round,
        className,
      )}
    >
      <Icon className={cn('h-1/2 w-1/2 max-h-10 max-w-10', visual.iconColor)} strokeWidth={1.5} />
    </div>
  );
}
