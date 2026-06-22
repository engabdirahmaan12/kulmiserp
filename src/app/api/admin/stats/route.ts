import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function requireSuperAdmin(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (user.app_metadata?.role !== 'super_admin') return null;
  return user;
}

export async function GET(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [storesRes, usersRes] = await Promise.all([
    supabaseAdmin.from('stores').select('subscription_status, is_active, created_at'),
    supabaseAdmin.from('store_users').select('id', { count: 'exact', head: true }),
  ]);

  const stores = storesRes.data ?? [];
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return NextResponse.json({
    data: {
      totalTenants: stores.length,
      activeTenants: stores.filter((s) => s.subscription_status === 'active').length,
      trialTenants: stores.filter((s) => s.subscription_status === 'trial').length,
      expiredTenants: stores.filter((s) => s.subscription_status === 'expired').length,
      suspendedTenants: stores.filter((s) => s.subscription_status === 'suspended').length,
      cancelledTenants: stores.filter((s) => s.subscription_status === 'cancelled').length,
      inactiveTenants: stores.filter((s) => !s.is_active).length,
      newLast30Days: stores.filter((s) => new Date(s.created_at) >= thirtyDaysAgo).length,
      totalUsers: usersRes.count ?? 0,
    },
  });
}
