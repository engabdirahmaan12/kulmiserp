import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceClient,
  logPlatformAction,
  requirePlatformUserFromRequest,
} from '@/lib/platform/auth.server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const platform = await requirePlatformUserFromRequest(req, 'stores.view');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await context.params;
  const admin = createServiceClient();

  const { data: store, error } = await admin
    .from('stores')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const [{ data: stats }, { data: plan }, ownerRes, membersRes] = await Promise.all([
    admin.rpc('platform_get_store_stats', { p_store_id: id }),
    admin.from('subscription_plans').select('*').eq('slug', store.subscription_plan ?? 'free_trial').maybeSingle(),
    store.owner_id ? admin.auth.admin.getUserById(store.owner_id) : Promise.resolve({ data: { user: null } }),
    admin
      .from('store_users')
      .select('id, role, is_active, user_id, user_profiles(full_name, phone)')
      .eq('store_id', id),
  ]);

  const { data: ownerProfile } = store.owner_id
    ? await admin.from('user_profiles').select('full_name, phone').eq('id', store.owner_id).maybeSingle()
    : { data: null };

  let usageStats = stats;
  if (!usageStats) {
    const [products, sales, purchases] = await Promise.all([
      admin.from('products').select('id', { count: 'exact', head: true }).eq('store_id', id),
      admin.from('sales').select('id', { count: 'exact', head: true }).eq('store_id', id),
      admin.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('store_id', id),
    ]);
    usageStats = {
      products_count: products.count ?? 0,
      sales_count: sales.count ?? 0,
      purchases_count: purchases.count ?? 0,
      invoices_count: 0,
      revenue: 0,
      users_count: membersRes.data?.length ?? 0,
      ai_requests_month: 0,
      ai_tokens_month: 0,
      ai_cost_month: 0,
    };
  }

  return NextResponse.json({
    data: {
      store,
      plan,
      owner: {
        id: store.owner_id,
        email: ownerRes.data.user?.email ?? store.email,
        full_name: ownerProfile?.full_name ?? '—',
        phone: ownerProfile?.phone ?? store.phone,
        last_sign_in: ownerRes.data.user?.last_sign_in_at ?? null,
      },
      members: membersRes.data ?? [],
      usage: usageStats,
    },
  });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const platform = await requirePlatformUserFromRequest(req, 'subscriptions.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await context.params;
  const body = await req.json() as {
    action: 'extend' | 'reset_password' | 'impersonate' | 'change_plan' | 'cancel' | 'reactivate';
    days?: number;
    months?: number;
    years?: number;
    plan_slug?: string;
    new_password?: string;
  };

  const admin = createServiceClient();
  const { data: store } = await admin.from('stores').select('*').eq('id', id).single();
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  if (body.action === 'extend') {
    const { data, error } = await admin.rpc('platform_extend_subscription', {
      p_store_id: id,
      p_days: body.days ?? 0,
      p_months: body.months ?? 0,
      p_years: body.years ?? 0,
      p_plan_slug: body.plan_slug ?? null,
      p_actor_id: platform.user.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logPlatformAction({
      actor: platform.user,
      role: platform.role,
      action: 'subscription.extend',
      resourceType: 'store',
      resourceId: id,
      storeId: id,
      newData: { days: body.days, months: body.months, years: body.years, plan: body.plan_slug },
      req,
    });
    return NextResponse.json({ data });
  }

  if (body.action === 'change_plan') {
    if (!body.plan_slug) return NextResponse.json({ error: 'plan_slug required' }, { status: 400 });
    const { data, error } = await admin
      .from('stores')
      .update({ subscription_plan: body.plan_slug, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logPlatformAction({
      actor: platform.user,
      role: platform.role,
      action: 'subscription.change_plan',
      resourceType: 'store',
      resourceId: id,
      storeId: id,
      newData: { plan: body.plan_slug },
      req,
    });
    return NextResponse.json({ data });
  }

  if (body.action === 'cancel') {
    const { data, error } = await admin
      .from('stores')
      .update({ subscription_status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logPlatformAction({
      actor: platform.user, role: platform.role, action: 'subscription.cancel',
      resourceType: 'store', resourceId: id, storeId: id, req,
    });
    return NextResponse.json({ data });
  }

  if (body.action === 'reactivate') {
    const { data, error } = await admin
      .from('stores')
      .update({
        subscription_status: 'active',
        is_active: true,
        frozen_at: null,
        freeze_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logPlatformAction({
      actor: platform.user, role: platform.role, action: 'subscription.reactivate',
      resourceType: 'store', resourceId: id, storeId: id, req,
    });
    return NextResponse.json({ data });
  }

  if (body.action === 'reset_password') {
    const perm = await requirePlatformUserFromRequest(req, 'stores.reset_password');
    if (!perm) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!store.owner_id) return NextResponse.json({ error: 'No owner' }, { status: 400 });

    const tempPassword = body.new_password ?? `Kulmis${Math.random().toString(36).slice(2, 10)}!`;
    const { error } = await admin.auth.admin.updateUserById(store.owner_id, { password: tempPassword });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logPlatformAction({
      actor: platform.user, role: platform.role, action: 'store.reset_password',
      resourceType: 'store', resourceId: id, storeId: id, req,
    });
    return NextResponse.json({ data: { temporary_password: tempPassword } });
  }

  if (body.action === 'impersonate') {
    const perm = await requirePlatformUserFromRequest(req, 'stores.impersonate');
    if (!perm) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!store.owner_id) return NextResponse.json({ error: 'No owner' }, { status: 400 });

    const { data: ownerAuth } = await admin.auth.admin.getUserById(store.owner_id);
    const email = ownerAuth?.user?.email;
    if (!email) return NextResponse.json({ error: 'Owner email not found' }, { status: 400 });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const { data: linkData, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/dashboard` },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logPlatformAction({
      actor: platform.user, role: platform.role, action: 'store.impersonate',
      resourceType: 'store', resourceId: id, storeId: id, req,
    });
    return NextResponse.json({
      data: {
        magic_link: linkData.properties?.action_link ?? null,
        owner_email: email,
      },
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
