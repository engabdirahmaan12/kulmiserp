import { NextResponse } from 'next/server';
import { createServiceClient, requirePlatformUser } from '@/lib/platform/auth.server';

export async function GET() {
  const platform = await requirePlatformUser('stores.view');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceClient();
  const { data, error } = await admin.rpc('platform_dashboard_stats');
  if (error) {
    // Fallback if migration not applied yet
    const [storesRes, usersRes] = await Promise.all([
      admin.from('stores').select('subscription_status, is_active, created_at'),
      admin.from('store_users').select('id', { count: 'exact', head: true }),
    ]);
    const stores = storesRes.data ?? [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return NextResponse.json({
      data: {
        total_stores: stores.length,
        active_stores: stores.filter((s) => s.subscription_status === 'active').length,
        trial_stores: stores.filter((s) => s.subscription_status === 'trial').length,
        expired_stores: stores.filter((s) => s.subscription_status === 'expired').length,
        suspended_stores: stores.filter((s) => !s.is_active || s.subscription_status === 'suspended').length,
        new_stores_today: stores.filter((s) => new Date(s.created_at) >= today).length,
        total_users: usersRes.count ?? 0,
        active_subscriptions: stores.filter((s) => s.subscription_status === 'active').length,
        monthly_revenue: 0,
        ai_requests_month: 0,
        ai_tokens_month: 0,
      },
    });
  }

  await admin.rpc('platform_check_expiring_stores');
  return NextResponse.json({ data });
}
