'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useAuthStore } from '@/lib/stores/auth';
import { cnLogo, getStoreBrandingSettings } from '@/lib/media/branding';
import { cn } from '@/lib/utils';

interface StoreLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showFallbackInitial?: boolean;
  alt?: string;
  /** Preview overrides (settings panel) */
  srcOverride?: string | null;
  shapeOverride?: import('@/lib/media/branding').LogoShape;
  radiusOverride?: number;
}

const SIZE_MAP = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
};

const PX_MAP = { xs: 28, sm: 32, md: 40, lg: 64, xl: 96 };

export function StoreLogo({
  size = 'sm',
  className,
  showFallbackInitial = true,
  alt = 'Store logo',
  srcOverride,
  shapeOverride,
  radiusOverride,
}: StoreLogoProps) {
  const { currentStore } = useAuthStore();
  const branding = getStoreBrandingSettings(currentStore);
  const shape = shapeOverride ?? branding.logo_shape ?? 'rounded-12';
  const radius = radiusOverride ?? branding.logo_radius ?? 12;
  const { className: shapeClass, style } = cnLogo(shape, radius, SIZE_MAP[size]);
  const [err, setErr] = useState(false);

  const logoSrc = srcOverride !== undefined ? srcOverride : currentStore?.logo_url;

  if (logoSrc && !err) {
    return (
      <Image
        src={logoSrc}
        alt={alt}
        width={PX_MAP[size]}
        height={PX_MAP[size]}
        className={cn(shapeClass, 'border border-slate-200/80 shadow-sm', className)}
        style={style}
        onError={() => setErr(true)}
      />
    );
  }

  if (!showFallbackInitial) {
    return (
      <div
        className={cn(
          shapeClass,
          'bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold',
          SIZE_MAP[size],
          className,
        )}
        style={style}
      >
        K
      </div>
    );
  }

  const initial = currentStore?.name?.charAt(0)?.toUpperCase() || 'S';
  return (
    <div
      className={cn(
        shapeClass,
        'bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-sm',
        SIZE_MAP[size],
        size === 'xs' && 'text-xs',
        size === 'sm' && 'text-sm',
        size === 'md' && 'text-base',
        size === 'lg' && 'text-2xl',
        size === 'xl' && 'text-3xl',
        className,
      )}
      style={style}
    >
      {initial}
    </div>
  );
}
