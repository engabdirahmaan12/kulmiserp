'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { usePermission } from '@/lib/hooks/usePermission';
import { useAuthStore } from '@/lib/stores/auth';
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  FileClock,
  History,
  Package,
  Tag,
  Bookmark,
  ShoppingBag,
  ClipboardList,
  Users,
  Truck,
  AlertCircle,
  Receipt,
  Calculator,
  BarChart3,
  Sparkles,
  Bell,
  UserCog,
  CreditCard,
  Settings,
  ChevronLeft,
  Store,
  LogOut,
  Shield,
  Percent,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/hooks/useAuth';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { NAV_GROUPS } from '@/lib/i18n/nav-config';
import { StoreLogo } from '@/components/media/StoreLogo';
import { X } from 'lucide-react';

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  /** Show close button (mobile drawer) */
  showMobileClose?: boolean;
}

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  module: string | null;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

export function Sidebar({ isCollapsed, onToggle, showMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { canRead, role } = usePermission();
  const { user, currentStore, storeUser, stores, switchStore } = useAuthStore();
  const { signOut } = useAuth();
  const { t, isRtl } = useTranslation();

  const navGroups: NavGroup[] = NAV_GROUPS;

  const isItemVisible = (item: NavItem): boolean => {
    if (!item.module) return true;
    return canRead(item.module);
  };

  const isActive = (href: string): boolean => {
    const [path, queryString] = href.split('?');

    if (path === '/dashboard') {
      return pathname === '/dashboard' && !searchParams.get('tab') && !searchParams.get('view');
    }

    const pathMatches = pathname === path || pathname.startsWith(path + '/');
    if (!pathMatches) return false;

    if (!queryString) {
      if (path === '/dashboard/accounting') {
        const tab = searchParams.get('tab');
        return !tab || tab === 'dashboard';
      }
      if (path === '/dashboard/settings') {
        const tab = searchParams.get('tab');
        return !tab || tab === 'store';
      }
      if (path === '/dashboard/inventory') {
        return !searchParams.get('view');
      }
      return true;
    }

    const expected = new URLSearchParams(queryString);
    if (path === '/dashboard/settings') {
      const tab = searchParams.get('tab');
      const expectedTab = expected.get('tab');
      if (expectedTab === 'tax' || expectedTab === 'currency') {
        return tab === expectedTab;
      }
    }
    for (const [key, value] of expected.entries()) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  };

  const initials = user?.full_name
    ? user.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  const roleColors: Record<string, string> = {
    owner: 'bg-purple-100 text-purple-700',
    manager: 'bg-blue-100 text-blue-700',
    cashier: 'bg-green-100 text-green-700',
    accountant: 'bg-orange-100 text-orange-700',
    purchase_officer: 'bg-teal-100 text-teal-700',
  };

  const isSubscriptionExpired =
    currentStore &&
    currentStore.subscription_status !== 'active' &&
    currentStore.subscription_status !== 'trial';

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-slate-100 bg-white transition-all duration-300 ease-in-out shadow-sm',
        isRtl ? 'border-l' : 'border-r',
        isCollapsed ? 'w-[64px]' : 'w-[240px]'
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex h-14 shrink-0 items-center border-b border-slate-100 px-3',
        isCollapsed ? 'justify-center' : 'justify-between',
      )}>
        {!isCollapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <StoreLogo size="sm" />
            <div className="min-w-0">
              <span className="font-bold text-slate-900 text-sm block truncate">{currentStore?.name ?? 'KULMIS'}</span>
              <span className="block text-[9px] font-semibold text-slate-400 uppercase tracking-widest -mt-0.5">ERP</span>
            </div>
          </div>
        )}
        {isCollapsed && (
          <StoreLogo size="sm" />
        )}
        {!isCollapsed && (
          <div className="flex items-center gap-1">
            {showMobileClose && (
              <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7 lg:hidden">
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="h-7 w-7 text-slate-400 hover:text-slate-600 rounded-lg hidden lg:inline-flex"
            >
              <ChevronLeft className={cn('h-4 w-4 transition-transform', isRtl && 'rotate-180')} />
            </Button>
          </div>
        )}
      </div>

      {/* Collapse toggle for collapsed state — rendered in-flow */}
      {isCollapsed && (
        <div className="flex justify-center py-2 border-b border-slate-100">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-7 w-7 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <ChevronLeft className={cn('h-4 w-4 rotate-180', isRtl && 'rotate-0')} />
          </Button>
        </div>
      )}

      {/* Store Selector */}
      {!isCollapsed && currentStore && (
        <div className="border-b border-slate-100 p-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-slate-50 transition-colors">
              <StoreLogo size="xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-800">{currentStore.name}</p>
                <p className="text-[10px] text-slate-400 capitalize">{currentStore.subscription_status}</p>
              </div>
            </DropdownMenuTrigger>
            {stores.length > 1 && (
              <DropdownMenuContent className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t('nav.switchStore')}</DropdownMenuLabel>
                  {stores.map((s) => (
                    <DropdownMenuItem key={s.id} onClick={() => switchStore(s.id)}>
                      <Store className="mr-2 h-4 w-4" />
                      {s.name}
                      {s.id === currentStore.id && (
                        <Badge variant="secondary" className="ms-auto">{t('common.active')}</Badge>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      )}

      {/* Subscription Warning */}
      {!isCollapsed && isSubscriptionExpired && (
        <div className="mx-2.5 my-2 rounded-xl bg-red-50 border border-red-100 p-2.5">
          <p className="text-xs font-semibold text-red-700">{t('nav.subscriptionExpired')}</p>
          <Link href="/dashboard/billing" className="text-xs text-red-600 underline mt-0.5 block">
            {t('nav.renewNow')} {isRtl ? '←' : '→'}
          </Link>
        </div>
      )}

      {/* Navigation */}
      <ScrollArea className="flex-1 min-h-0 py-2">
        <nav className={cn('px-2.5', isCollapsed && 'px-2')}>
          {navGroups.map((group, groupIdx) => {
            const visibleItems = group.items.filter(isItemVisible);
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.labelKey} className={cn(groupIdx > 0 && 'mt-1')}>
                {/* Group divider + label */}
                {groupIdx > 0 && (
                  <div className={cn('border-t border-slate-100 mb-1 mt-1', isCollapsed ? 'mx-0.5' : 'mx-0')} />
                )}
                {!isCollapsed && (
                  <p className="mb-0.5 px-2 pt-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {t(group.labelKey)}
                  </p>
                )}

                <div className={cn('space-y-0.5', isCollapsed && 'flex flex-col items-center')}>
                  {visibleItems.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    const itemKey = `${item.labelKey}-${item.href}`;

                    if (isCollapsed) {
                      return (
                        <Tooltip key={itemKey}>
                          <TooltipTrigger
                            render={
                              <Link
                                href={item.href}
                                className={cn(
                                  'flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200',
                                  active
                                    ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200/40'
                                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
                                )}
                              />
                            }
                          >
                            <Icon className="h-4 w-4" />
                          </TooltipTrigger>
                          <TooltipContent side={isRtl ? 'left' : 'right'} className="font-medium">{t(item.labelKey)}</TooltipContent>
                        </Tooltip>
                      );
                    }

                    return (
                      <Link
                        key={itemKey}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150',
                          active
                            ? 'bg-blue-600 text-white shadow-sm shadow-blue-200/60'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600')} />
                        <span className="truncate">{t(item.labelKey)}</span>
                        {active && <div className={cn('h-1.5 w-1.5 rounded-full bg-white/60', isRtl ? 'me-auto' : 'ms-auto')} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      {/* User Section */}
      <div className="border-t border-slate-100 p-2.5">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-red-500 mx-auto transition-colors cursor-pointer"
              onClick={() => signOut()}
            >
              <LogOut className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side={isRtl ? 'left' : 'right'}>{t('nav.signOut')}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-slate-50 transition-colors outline-none">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={user?.avatar_url} />
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[10px] font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-semibold text-slate-800">
                  {user?.full_name || 'User'}
                </p>
                {role && (
                  <span
                    className={cn(
                      'inline-block rounded px-1 py-0.5 text-[9px] font-semibold',
                      roleColors[role] || 'bg-slate-100 text-slate-600'
                    )}
                  >
                    {t(`roles.${role}` as 'roles.owner')}
                  </span>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('nav.myAccount')}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => router.push('/dashboard/settings')}>
                  {t('nav.profileSettings')}
                </DropdownMenuItem>
                {user?.is_super_admin && (
                  <DropdownMenuItem onClick={() => router.push('/super-admin')}>
                    <Shield className="me-2 h-4 w-4" />
                    {t('nav.platformAdmin')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-red-600 focus:text-red-600">
                <LogOut className="me-2 h-4 w-4" />
                {t('nav.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </aside>
  );
}
