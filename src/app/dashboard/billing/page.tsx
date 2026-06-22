'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, DataPanel } from '@/components/layout/PageShell';
import { btnPrimary } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { SomaliPaymentModal } from '@/components/billing/SomaliPaymentModal';
import { useTranslation } from '@/lib/i18n/useTranslation';

type TKey = Parameters<ReturnType<typeof useTranslation>['t']>[0];

const PLAN_DEFS = [
  {
    id: 'basic',
    price: 29,
    nameKey: 'billing.planBasicName' as TKey,
    descKey: 'billing.planBasicDesc' as TKey,
    featureKeys: ['billing.planBasicF1', 'billing.planBasicF2', 'billing.planBasicF3', 'billing.planBasicF4'] as TKey[],
    popular: false,
  },
  {
    id: 'business',
    price: 79,
    nameKey: 'billing.planBusinessName' as TKey,
    descKey: 'billing.planBusinessDesc' as TKey,
    featureKeys: ['billing.planBusinessF1', 'billing.planBusinessF2', 'billing.planBusinessF3', 'billing.planBusinessF4', 'billing.planBusinessF5'] as TKey[],
    popular: true,
  },
  {
    id: 'enterprise',
    price: 199,
    nameKey: 'billing.planEnterpriseName' as TKey,
    descKey: 'billing.planEnterpriseDesc' as TKey,
    featureKeys: ['billing.planEnterpriseF1', 'billing.planEnterpriseF2', 'billing.planEnterpriseF3', 'billing.planEnterpriseF4', 'billing.planEnterpriseF5'] as TKey[],
    popular: false,
  },
];

export default function BillingPage() {
  const [showPayment, setShowPayment] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{ id: string; price: number } | null>(null);
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();

  const { data: payments = [] } = useQuery({
    queryKey: ['billing-payments', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('payment_transactions')
        .select('id,plan_id,provider,amount_usd,months,status,merchant_reference,initiated_at,activated_at')
        .eq('store_id', currentStore!.id)
        .order('initiated_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!currentStore,
  });

  const statusInfo = {
    trial: { label: t('billing.statusTrial'), color: 'bg-blue-100 text-blue-700', icon: Clock },
    active: { label: t('billing.statusActive'), color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
    expired: { label: t('billing.statusExpired'), color: 'bg-red-100 text-red-700', icon: AlertCircle },
    suspended: { label: t('billing.statusSuspended'), color: 'bg-orange-100 text-orange-700', icon: AlertCircle },
    cancelled: { label: t('billing.statusCancelled'), color: 'bg-slate-100 text-slate-700', icon: AlertCircle },
  };

  const status = (currentStore?.subscription_status as keyof typeof statusInfo) ?? 'trial';
  const StatusInfo = statusInfo[status] ?? statusInfo.trial;
  const StatusIcon = StatusInfo.icon;

  const trialEnd = currentStore?.trial_ends_at ? new Date(currentStore.trial_ends_at) : null;
  const subEnd = currentStore?.subscription_ends_at ? new Date(currentStore.subscription_ends_at) : null;
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000)) : null;

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        title={t('billing.title')}
        description={t('billing.description')}
        icon={CreditCard}
        variant="banner"
        actions={
          <Button
            onClick={() => setShowPayment(true)}
            className={cn(btnPrimary, 'gap-2 h-10 rounded-xl font-semibold bg-white/20 hover:bg-white/30 border border-white/30 text-white shadow-none')}
          >
            <CreditCard className="h-4 w-4" />
            {status === 'active' ? t('billing.upgradePlan') : t('billing.subscribeNow')}
          </Button>
        }
      />

      <DataPanel className="p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">{currentStore?.name}</h2>
              <Badge className={cn('gap-1 border-0', StatusInfo.color)}>
                <StatusIcon className="h-3 w-3" />
                {StatusInfo.label}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 mt-1 capitalize">
              {t('billing.labelPlan', { plan: currentStore?.subscription_plan?.replace('_', ' ') || t('billing.freeTrial') })}
            </p>
            {status === 'trial' && daysLeft !== null && (
              <p className={cn('text-sm mt-1', daysLeft <= 3 ? 'text-red-600 font-semibold' : 'text-slate-500')}>
                {t('billing.daysLeft', { n: String(daysLeft) })}
              </p>
            )}
            {status === 'active' && subEnd && (
              <p className="text-sm text-slate-500 mt-1">
                {t('billing.renewsOn', { date: format(subEnd, 'MMM d, yyyy') })}
              </p>
            )}
            {status === 'expired' && (
              <p className="text-sm text-red-600 font-medium mt-1">
                {t('billing.subExpired')}
              </p>
            )}
          </div>
        </div>
      </DataPanel>

      <div>
        <h3 className="font-semibold text-slate-900 mb-3">{t('billing.sectionPlans')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PLAN_DEFS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                'rounded-2xl border-2 p-5 relative bg-white shadow-sm transition-all hover:shadow-md',
                plan.popular ? 'border-blue-500 shadow-lg shadow-blue-100/50' : 'border-slate-100'
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1 text-xs font-semibold text-white">
                    {t('billing.mostPopular')}
                  </span>
                </div>
              )}
              <div className="mb-4">
                <h4 className="font-bold text-lg text-slate-900">{t(plan.nameKey)}</h4>
                <p className="text-2xl font-bold mt-1 text-slate-900">
                  ${plan.price}
                  <span className="text-sm font-normal text-slate-500">{t('billing.perMonth')}</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">{t(plan.descKey)}</p>
              </div>
              <ul className="space-y-2 mb-4">
                {plan.featureKeys.map((fk) => (
                  <li key={fk} className="flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    {t(fk)}
                  </li>
                ))}
              </ul>
              <Button
                className={cn(plan.popular ? btnPrimary : '', 'w-full rounded-xl')}
                variant={plan.popular ? 'default' : 'outline'}
                onClick={() => { setSelectedPlan({ id: plan.id, price: plan.price }); setShowPayment(true); }}
              >
                {t('billing.selectPlan', { name: t(plan.nameKey) })}
              </Button>
            </div>
          ))}
        </div>
      </div>

      {payments.length > 0 && (
        <div>
          <h3 className="font-semibold text-slate-900 mb-3">{t('billing.sectionHistory')}</h3>
          <DataPanel>
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-100">
                <tr>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase text-slate-500">{t('billing.colDate')}</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase text-slate-500">{t('billing.colPlan')}</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase text-slate-500">{t('billing.colProvider')}</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase text-slate-500">{t('billing.colAmount')}</th>
                  <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase text-slate-500">{t('billing.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => {
                  const statusColors: Record<string, string> = {
                    success: 'bg-green-100 text-green-700',
                    pending: 'bg-orange-100 text-orange-700',
                    initiated: 'bg-blue-100 text-blue-700',
                    failed: 'bg-red-100 text-red-700',
                    cancelled: 'bg-slate-100 text-slate-600',
                    expired: 'bg-slate-100 text-slate-600',
                  };
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2.5 text-slate-500">{format(new Date(p.initiated_at), 'MMM d, yyyy')}</td>
                      <td className="px-4 py-2.5 font-medium capitalize">{p.plan_id?.replace('_', ' ')} × {p.months}mo</td>
                      <td className="px-4 py-2.5 text-slate-500 uppercase">{p.provider}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">${(p.amount_usd * p.months).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge className={cn('border-0', statusColors[p.status] ?? 'bg-slate-100 text-slate-600')}>
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataPanel>
        </div>
      )}

      {/* Payment Modal */}
      {selectedPlan && (
        <SomaliPaymentModal
          open={showPayment}
          onClose={() => { setShowPayment(false); setSelectedPlan(null); }}
          plan={selectedPlan.id}
          amount={selectedPlan.price}
          months={1}
        />
      )}
      {!selectedPlan && showPayment && (
        <SomaliPaymentModal
          open={showPayment}
          onClose={() => setShowPayment(false)}
          plan="business"
          amount={79}
          months={1}
        />
      )}
    </PageShell>
  );
}
