'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n/useTranslation';

const PLANS = ['free_trial', 'basic', 'business', 'enterprise'];
const STATUSES = ['trial', 'active', 'expired', 'suspended', 'cancelled'];

export default function AdminBillingPage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: stores, isLoading } = useQuery({
    queryKey: ['admin-billing-stores'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stores?limit=100');
      if (!res.ok) throw new Error('Failed to load stores');
      const json = await res.json() as {
        data: Array<{
          id: string;
          name: string;
          subscription_plan?: string;
          subscription_status?: string;
          subscription_ends_at?: string;
          trial_ends_at?: string;
        }>;
      };
      return json.data ?? [];
    },
  });

  const { mutate: updatePlan } = useMutation({
    mutationFn: async ({ id, plan, status }: { id: string; plan: string; status: string }) => {
      const subscriptionEndsAt = status === 'active'
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const res = await fetch('/api/admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: id,
          subscription_plan: plan,
          subscription_status: status,
          subscription_ends_at: subscriptionEndsAt,
        }),
      });

      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? 'Update failed');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-billing-stores'] });
      toast.success(t('admin.toastBillingUpdated'));
    },
    onError: (err: Error) => toast.error(err.message || t('admin.toastBillingError')),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.billingTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('admin.billingDesc')}</p>
      </div>

      <div className="grid gap-4">
        {stores?.map((store) => (
          <Card key={store.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{store.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">{t('admin.labelPlan')}</p>
                  <p className="font-medium capitalize">{store.subscription_plan?.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{t('admin.labelStatus')}</p>
                  <p className="font-medium capitalize">{store.subscription_status}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{t('admin.labelSubEnds')}</p>
                  <p className="font-medium">
                    {store.subscription_ends_at
                      ? new Date(store.subscription_ends_at).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{t('admin.labelTrialEnds')}</p>
                  <p className="font-medium">
                    {store.trial_ends_at
                      ? new Date(store.trial_ends_at).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {PLANS.map((plan) => (
                  STATUSES.slice(0, 2).map((status) => (
                    <Button
                      key={`${plan}-${status}`}
                      size="sm"
                      variant={
                        store.subscription_plan === plan && store.subscription_status === status
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() => updatePlan({ id: store.id, plan, status })}
                      className="h-7 text-xs capitalize"
                    >
                      {plan.replace('_', ' ')} / {status}
                    </Button>
                  ))
                ))}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => updatePlan({ id: store.id, plan: store.subscription_plan ?? 'free_trial', status: 'expired' })}
                  className="h-7 text-xs"
                >
                  {t('admin.btnExpireNow')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
