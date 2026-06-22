import {
  Coffee,
  Laptop,
  Monitor,
  Package,
  Pill,
  Shirt,
  ShoppingBag,
  Sofa,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

export interface CategoryVisual {
  Icon: LucideIcon;
  bg: string;
  iconColor: string;
}

export function getCategoryVisual(categoryName?: string): CategoryVisual {
  const n = (categoryName || '').toLowerCase();

  if (/phone|mobile|smartphone|tablet/.test(n)) {
    return { Icon: Smartphone, bg: 'bg-gradient-to-br from-sky-50 to-blue-50', iconColor: 'text-sky-600' };
  }
  if (/tv|television|display|monitor/.test(n)) {
    return { Icon: Monitor, bg: 'bg-gradient-to-br from-indigo-50 to-violet-50', iconColor: 'text-indigo-600' };
  }
  if (/furniture|sofa|chair|table|bed/.test(n)) {
    return { Icon: Sofa, bg: 'bg-gradient-to-br from-amber-50 to-orange-50', iconColor: 'text-amber-700' };
  }
  if (/drink|beverage|juice|coffee|tea|water|soda/.test(n)) {
    return { Icon: Coffee, bg: 'bg-gradient-to-br from-cyan-50 to-teal-50', iconColor: 'text-cyan-600' };
  }
  if (/electronic|laptop|computer|device|tech|gadget|accessory/.test(n)) {
    return { Icon: Laptop, bg: 'bg-gradient-to-br from-violet-50 to-indigo-50', iconColor: 'text-violet-600' };
  }
  if (/cloth|fashion|apparel|wear|shirt|shoe/.test(n)) {
    return { Icon: Shirt, bg: 'bg-gradient-to-br from-rose-50 to-pink-50', iconColor: 'text-rose-600' };
  }
  if (/grocery|food|snack|grain|produce|market/.test(n)) {
    return { Icon: ShoppingBag, bg: 'bg-gradient-to-br from-amber-50 to-orange-50', iconColor: 'text-amber-600' };
  }
  if (/medic|pharm|health|drug|vitamin/.test(n)) {
    return { Icon: Pill, bg: 'bg-gradient-to-br from-emerald-50 to-green-50', iconColor: 'text-emerald-600' };
  }

  return { Icon: Package, bg: 'bg-gradient-to-br from-slate-50 to-slate-100', iconColor: 'text-slate-500' };
}
