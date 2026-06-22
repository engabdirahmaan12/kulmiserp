'use client';

import {
  Bell, Menu, Search, WifiOff, ChevronRight,
  ShoppingCart, Package, Users, Receipt, BarChart3,
  Plus, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/lib/stores/auth';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useStoreAlerts } from '@/lib/hooks/useIntelligence';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { NAVBAR_QUICK_LINKS } from '@/lib/i18n/nav-config';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';

interface NavbarProps {
  onMenuClick: () => void;
  title?: string;
  onOpenCommand?: () => void;
}

const SEARCH_LINKS = NAVBAR_QUICK_LINKS;

export function Navbar({ onMenuClick, title, onOpenCommand }: NavbarProps) {
  const { currentStore, user } = useAuthStore();
  const { signOut } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(true);
  const { data: alerts = [] } = useStoreAlerts();

  const initials = user?.full_name
    ? user.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const openSearch = () => onOpenCommand?.();
  const alertCount = alerts.filter((a) => a.severity !== 'info').length;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 gap-3 shadow-sm shadow-slate-100/50 z-10">
        {/* Left */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="lg:hidden h-8 w-8 shrink-0 text-slate-500 hover:text-slate-700"
          >
            <Menu className="h-5 w-5" />
          </Button>
          {title && (
            <div className="hidden sm:flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-slate-800 truncate">{title}</span>
              {currentStore?.currency && (
                <span className="text-xs font-bold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 shrink-0">
                  {currentStore.currency}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Center — Search */}
        <div className="flex-1 max-w-sm hidden md:block">
          <button
            onClick={openSearch}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 hover:bg-white hover:border-slate-300 hover:shadow-sm transition-all duration-200 group"
          >
            <Search className="h-3.5 w-3.5 shrink-0 group-hover:text-slate-500 transition-colors" />
            <span className="flex-1 text-left">{t('navbar.searchPlaceholder')}</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Mobile search */}
          <Button
            variant="ghost"
            size="icon"
            onClick={openSearch}
            className="md:hidden h-8 w-8 text-slate-500"
          >
            <Search className="h-4 w-4" />
          </Button>

          {/* Online status */}
          <div className={cn(
            'hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
            isOnline ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600',
          )}>
            <div className={cn('h-1.5 w-1.5 rounded-full', isOnline ? 'bg-blue-500 animate-pulse' : 'bg-red-500')} />
            <span className="hidden lg:inline">{isOnline ? t('navbar.live') : t('navbar.offline')}</span>
            {!isOnline && <WifiOff className="h-3 w-3" />}
          </div>

          {/* Quick create */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-background text-slate-600 hover:border-blue-200 hover:text-blue-600 hover:bg-blue-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {SEARCH_LINKS.map(({ labelKey, href, icon: Icon, color }) => (
                <DropdownMenuItem key={href} onClick={() => router.push(href)} className="gap-2.5">
                  <div className={cn('flex h-6 w-6 items-center justify-center rounded-md', color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  {t(labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notifications */}
          <Popover>
            <PopoverTrigger
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-muted hover:text-slate-700 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Bell className="h-4 w-4" />
              {alertCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 border-2 border-white flex items-center justify-center text-[9px] text-white font-bold">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0 shadow-xl shadow-slate-200/40">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <h3 className="text-sm font-semibold text-slate-900">{t('navbar.smartAlerts')}</h3>
                {alertCount > 0 && <Badge variant="secondary" className="text-xs">{alertCount} active</Badge>}
              </div>
              <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                {alerts.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-slate-400 text-center">{t('navbar.noAlerts')}</p>
                ) : alerts.slice(0, 8).map((n) => (
                  <div key={n.id} className="flex gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors">
                    <div className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.severity === 'error' ? 'bg-red-500' : n.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500',
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{n.message}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 border-t bg-slate-50/60">
                <Link href="/dashboard/reminders" className="flex items-center justify-center gap-1 text-xs text-blue-600 hover:underline font-semibold">
                  {t('navbar.viewAllAlerts')} <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </PopoverContent>
          </Popover>

          <LanguageSwitcher className="hidden sm:flex" />

          {/* Profile Avatar */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl p-0 hover:bg-slate-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[10px] font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-3 py-2">
                <p className="text-sm font-semibold text-slate-900 truncate">{user?.full_name || 'User'}</p>
                <p className="text-xs text-slate-400 truncate">{user?.email || ''}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/dashboard/settings')}>
                {t('nav.profileSettings')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/dashboard/billing')}>
                {t('nav.billing')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-red-600 focus:text-red-600">
                {t('nav.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  );
}
