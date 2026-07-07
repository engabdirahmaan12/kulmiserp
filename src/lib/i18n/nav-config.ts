import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, ShoppingCart, FileText, FileClock, History,
  Package, Tag, Bookmark, Percent, ShoppingBag, ClipboardList,
  Users, Truck, AlertCircle, Receipt, BarChart3,
  UserCog, Settings, Sparkles, CreditCard, ArrowLeftRight,
} from 'lucide-react';

export interface NavItemConfig {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /** Permission module key; null = visible to all store members */
  module: string | null;
}

export interface NavGroupConfig {
  labelKey: string;
  items: NavItemConfig[];
}

/** Store Owner sidebar — sub-modules live inside Accounting & Settings pages */
export const NAV_GROUPS: NavGroupConfig[] = [
  {
    labelKey: 'nav.groups.sales',
    items: [
      { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, module: null },
      { href: '/dashboard/pos', labelKey: 'nav.pos', icon: ShoppingCart, module: 'pos' },
      { href: '/dashboard/custom-sales', labelKey: 'nav.customInvoice', icon: FileText, module: null },
      { href: '/dashboard/drafts', labelKey: 'nav.draftInvoices', icon: FileClock, module: null },
      { href: '/dashboard/sales-history', labelKey: 'nav.salesHistory', icon: History, module: null },
    ],
  },
  {
    labelKey: 'nav.groups.products',
    items: [
      { href: '/dashboard/inventory', labelKey: 'nav.products', icon: Package, module: 'inventory' },
      { href: '/dashboard/categories', labelKey: 'nav.categories', icon: Tag, module: null },
      { href: '/dashboard/brands', labelKey: 'nav.brands', icon: Bookmark, module: null },
      { href: '/dashboard/promotions', labelKey: 'nav.promotions', icon: Percent, module: null },
    ],
  },
  {
    labelKey: 'nav.groups.purchasing',
    items: [
      { href: '/dashboard/purchase', labelKey: 'nav.purchaseOrders', icon: ShoppingBag, module: 'purchases' },
      { href: '/dashboard/purchase-history', labelKey: 'nav.purchaseHistory', icon: ClipboardList, module: 'purchases' },
      { href: '/dashboard/suppliers', labelKey: 'nav.suppliers', icon: Truck, module: 'suppliers' },
    ],
  },
  {
    labelKey: 'nav.groups.customers',
    items: [
      { href: '/dashboard/customers', labelKey: 'nav.customers', icon: Users, module: 'customers' },
      { href: '/dashboard/debts', labelKey: 'nav.debts', icon: AlertCircle, module: null },
    ],
  },
  {
    labelKey: 'nav.groups.finance',
    items: [
      { href: '/dashboard/expenses', labelKey: 'nav.expenses', icon: Receipt, module: 'accounting' },
      { href: '/dashboard/reports', labelKey: 'nav.reports', icon: BarChart3, module: 'reports' },
      { href: '/dashboard/transactions', labelKey: 'nav.transactions', icon: ArrowLeftRight, module: null },
    ],
  },
  {
    labelKey: 'nav.groups.management',
    items: [
      { href: '/dashboard/users', labelKey: 'nav.userManagement', icon: UserCog, module: 'users' },
      { href: '/dashboard/billing', labelKey: 'nav.billing', icon: CreditCard, module: 'billing' },
      { href: '/dashboard/settings', labelKey: 'nav.settings', icon: Settings, module: 'settings' },
      { href: '/dashboard/intelligence', labelKey: 'nav.aiAssistant', icon: Sparkles, module: null },
    ],
  },
];

export const NAVBAR_QUICK_LINKS = [
  { labelKey: 'navbar.newSale', href: '/dashboard/pos', icon: ShoppingCart, color: 'text-blue-600 bg-blue-50' },
  { labelKey: 'navbar.addProduct', href: '/dashboard/inventory', icon: Package, color: 'text-blue-600 bg-blue-50' },
  { labelKey: 'nav.customers', href: '/dashboard/customers', icon: Users, color: 'text-violet-600 bg-violet-50' },
  { labelKey: 'navbar.newInvoice', href: '/dashboard/custom-sales', icon: FileText, color: 'text-orange-600 bg-orange-50' },
  { labelKey: 'nav.expenses', href: '/dashboard/expenses', icon: Receipt, color: 'text-red-600 bg-red-50' },
  { labelKey: 'nav.aiAssistant', href: '/dashboard/intelligence', icon: Sparkles, color: 'text-indigo-600 bg-indigo-50' },
] as const;
