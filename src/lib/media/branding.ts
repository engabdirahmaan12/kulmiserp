import type { Store } from '@/types';
import { cn } from '@/lib/utils';

export type LogoShape = 'circle' | 'rounded-12' | 'rounded-24' | 'square' | 'custom';

export interface StoreBrandingSettings {
  logo_shape?: LogoShape;
  logo_radius?: number;
  show_product_images_on_invoice?: boolean;
}

export function getStoreBrandingSettings(store?: Store | null): StoreBrandingSettings {
  const s = (store?.settings ?? {}) as Record<string, unknown>;
  return {
    logo_shape: (s.logo_shape as LogoShape) ?? 'rounded-12',
    logo_radius: typeof s.logo_radius === 'number' ? s.logo_radius : 12,
    show_product_images_on_invoice: s.show_product_images_on_invoice !== false,
  };
}

export function logoShapeClass(shape: LogoShape): string {
  switch (shape) {
    case 'circle':
      return 'rounded-full';
    case 'rounded-12':
      return 'rounded-xl';
    case 'rounded-24':
      return 'rounded-3xl';
    case 'square':
      return 'rounded-none';
    case 'custom':
      return '';
    default:
      return 'rounded-xl';
  }
}

export function logoShapeStyle(shape: LogoShape, customRadius?: number): React.CSSProperties | undefined {
  if (shape === 'custom' && customRadius != null) {
    return { borderRadius: `${customRadius}px` };
  }
  return undefined;
}

export function logoShapeLabel(shape: LogoShape): string {
  const labels: Record<LogoShape, string> = {
    circle: 'Circle',
    'rounded-12': 'Rounded 12px',
    'rounded-24': 'Rounded 24px',
    square: 'Square',
    custom: 'Custom radius',
  };
  return labels[shape];
}

export const LOGO_SHAPE_OPTIONS: LogoShape[] = [
  'circle',
  'rounded-12',
  'rounded-24',
  'square',
  'custom',
];

export function pickProductThumb(imageUrl?: string | null, thumbnailUrl?: string | null): string | null {
  return thumbnailUrl || imageUrl || null;
}

export function cnLogo(
  shape: LogoShape,
  customRadius?: number,
  className?: string,
): { className: string; style?: React.CSSProperties } {
  return {
    className: cn('object-cover', logoShapeClass(shape), className),
    style: logoShapeStyle(shape, customRadius),
  };
}
