'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Bell, MessageCircle, AlertTriangle, Package, CreditCard,
  Calendar, TrendingDown, Loader2, ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Alert {
  id: string;
  type: 'low_stock' | 'overdue_debt' | 'expiring_subscription' | 'unpaid_invoice';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  metadata?: Record<string, unknown>;
  whatsappMessage?: string;
  phone?: string;
}

function openWhatsApp(phone: string | undefined, message: string) {
  const clean = (phone ?? '').replace(/\D/g, '');
  const encoded = encodeURIComponent(message);
  const url = clean
    ? `https://wa.me/${clean}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function AlertCard({ alert }: { alert: Alert }) {
  const ICON = {
    low_stock: Package,
    overdue_debt: CreditCard,
    expiring_subscription: Calendar,
    unpaid_invoice: TrendingDown,
  };
  const COLORS = {
    info: 'border-blue-200 bg-blue-50 dark:bg-blue-950/20',
    warning: 'border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20',
    error: 'border-red-200 bg-red-50 dark:bg-red-950/20',
  };
  const BADGE_COLORS = {
    info: 'bg-blue-100 text-blue-800',
    warning: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
  };

  const Icon = ICON[alert.type] ?? Bell;

  return (
    <div className={cn('rounded-xl border p-4', COLORS[alert.severity])}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm">{alert.title}</p>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', BADGE_COLORS[alert.severity])}>
              {alert.severity}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{alert.message}</p>
        </div>
        {alert.whatsappMessage && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5 text-green-700 border-green-300 hover:bg-green-50"
            onClick={() => openWhatsApp(alert.phone, alert.whatsappMessage!)}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp
            <ExternalLink className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function RemindersContent() {
  const { currentStore } = useAuthStore();
  const { t, locale } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'low_stock' | 'overdue_debt' | 'expiring_subscription'>('all');

  const { data: alerts, isLoading } = useQuery<Alert[]>({
    queryKey: ['reminders', currentStore?.id, locale],
    enabled: !!currentStore,
    queryFn: async () => {
      if (!currentStore) return [];
      const supabase = createClient();
      const result: Alert[] = [];

      // Low stock products (fetch all tracked active products and filter client-side)
      const { data: lowStock } = await supabase
        .from('products')
        .select('id, name, stock_quantity, min_stock_level, sku')
        .eq('store_id', currentStore.id)
        .eq('track_inventory', true)
        .eq('is_active', true)
        .limit(200);
      const lowStockFiltered = (lowStock ?? []).filter(
        (p) => (p.stock_quantity ?? 0) <= (p.min_stock_level ?? 0)
      ).slice(0, 20);

      lowStockFiltered.forEach((p) => {
        result.push({
          id: `low_stock_${p.id}`,
          type: 'low_stock',
          title: t('reminders.lowStockTitle', { name: p.name }),
          message: t('reminders.lowStockMessage', { qty: String(p.stock_quantity ?? 0), min: String(p.min_stock_level ?? 0) }),
          severity: (p.stock_quantity ?? 0) === 0 ? 'error' : 'warning',
          metadata: { product_id: p.id },
        });
      });

      // Overdue customer debts (credit_amount > 0)
      const { data: overdueSales } = await supabase
        .from('sales')
        .select('id, invoice_number, total_amount, paid_amount, credit_amount, customer:customers(full_name, phone)')
        .eq('store_id', currentStore.id)
        .gt('credit_amount', 0)
        .eq('status', 'completed')
        .limit(20);

      (overdueSales ?? []).forEach((s) => {
        const customer = s.customer as { full_name?: string; phone?: string } | null;
        const balance = Number(s.credit_amount ?? (s.total_amount ?? 0) - (s.paid_amount ?? 0));
        const waMsg = `Assalaamu Calaykum ${customer?.full_name ?? 'Customer'},\n\nWaxaan kugu xusuusinayaa inaad leedahay deyn ah $${balance.toFixed(2)} ee invoice ${s.invoice_number}.\n\nFuraha xisaabta: KULMIS ERP`;
        result.push({
          id: `debt_${s.id}`,
          type: 'overdue_debt',
          title: t('reminders.debtTitle', { name: customer?.full_name ?? 'Customer' }),
          message: t('reminders.debtMessage', { invoice: s.invoice_number ?? '', balance: balance.toFixed(2) }),
          severity: 'warning',
          whatsappMessage: waMsg,
          phone: customer?.phone,
        });
      });

      // Expiring subscription
      if (currentStore.subscription_status === 'trial' && currentStore.trial_ends_at) {
        const daysLeft = Math.ceil(
          (new Date(currentStore.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (daysLeft <= 7) {
          result.push({
            id: 'expiring_sub',
            type: 'expiring_subscription',
            title: t('reminders.trialExpiringTitle'),
            message: daysLeft !== 1
              ? t('reminders.trialExpiringMessage', { n: String(daysLeft) })
              : t('reminders.trialExpiringMessageSingular'),
            severity: daysLeft <= 2 ? 'error' : 'warning',
          });
        }
      }

      if (currentStore.subscription_status === 'expired') {
        result.push({
          id: 'sub_expired',
          type: 'expiring_subscription',
          title: t('reminders.subExpiredTitle'),
          message: t('reminders.subExpiredMessage'),
          severity: 'error',
        });
      }

      return result;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const filtered = (alerts ?? []).filter(
    (a) => filter === 'all' || a.type === filter
  );

  const counts = {
    all: alerts?.length ?? 0,
    low_stock: alerts?.filter((a) => a.type === 'low_stock').length ?? 0,
    overdue_debt: alerts?.filter((a) => a.type === 'overdue_debt').length ?? 0,
    expiring_subscription: alerts?.filter((a) => a.type === 'expiring_subscription').length ?? 0,
  };

  return (
    <PageShell>
      <PageHeader
        title={t('reminders.title')}
        description={t('reminders.description')}
        icon={Bell}
        variant="banner"
        actions={
          counts.all > 0 ? (
            <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">
              {t('reminders.activeBadge', { n: String(counts.all) })}
            </Badge>
          ) : undefined
        }
      />

      <StatStrip>
        <StatChip label={t('reminders.statAll')} value={String(counts.all)} accent="blue" />
        <StatChip label={t('reminders.statLowStock')} value={String(counts.low_stock)} accent={counts.low_stock > 0 ? 'orange' : 'slate'} />
        <StatChip label={t('reminders.statDebts')} value={String(counts.overdue_debt)} accent={counts.overdue_debt > 0 ? 'red' : 'slate'} />
        <StatChip label={t('reminders.statSubscription')} value={String(counts.expiring_subscription)} accent={counts.expiring_subscription > 0 ? 'violet' : 'slate'} />
      </StatStrip>

      <PageFilterBar>
        <div className="flex gap-2 flex-wrap">
          {([
            { key: 'all', label: t('reminders.filterAll'), icon: Bell },
            { key: 'low_stock', label: t('reminders.filterLowStock'), icon: Package },
            { key: 'overdue_debt', label: t('reminders.filterDebts'), icon: CreditCard },
            { key: 'expiring_subscription', label: t('reminders.filterSubscription'), icon: Calendar },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                filter === key
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200/40'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {counts[key] > 0 && (
                <span className={cn(
                  'ml-1 text-xs rounded-full px-1.5 py-0.5 font-medium',
                  filter === key ? 'bg-white/20' : 'bg-white'
                )}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </PageFilterBar>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <DataPanel>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <Bell className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg mb-1">{t('reminders.allClear')}</h3>
            <p className="text-muted-foreground text-sm">{t('reminders.allClearSub')}</p>
          </div>
        </DataPanel>
      ) : (
        <div className="space-y-3">
          {filtered.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}

      {/* WhatsApp info card */}
      <DataPanel className="border-green-200 bg-green-50/50 p-4">
        <div className="flex items-start gap-3">
          <MessageCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-900">{t('reminders.whatsappTitle')}</p>
            <p className="text-sm text-slate-600 mt-1">{t('reminders.whatsappDesc')}</p>
          </div>
        </div>
      </DataPanel>

      {counts.low_stock > 0 && (
        <DataPanel className="border-orange-200 bg-orange-50/50 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
            <p className="text-sm text-slate-600">
              {t('reminders.lowStockWarning', { n: String(counts.low_stock) })}
            </p>
          </div>
        </DataPanel>
      )}
    </PageShell>
  );
}
