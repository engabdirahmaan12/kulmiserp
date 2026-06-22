import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceClient,
  logPlatformAction,
  requirePlatformUserFromRequest,
} from '@/lib/platform/auth.server';

export async function GET(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'stores.view');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

  const admin = createServiceClient();
  let query = admin
    .from('stores')
    .select(`
      id, name, slug, email, phone, country, address,
      subscription_plan, subscription_status, subscription_ends_at, trial_ends_at,
      is_active, ai_enabled, storage_bytes, last_login_at, frozen_at, freeze_reason,
      owner_id, created_at, updated_at
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (status) query = query.eq('subscription_status', status);

  const { data: stores, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ownerIds = [...new Set((stores ?? []).map((s) => s.owner_id).filter(Boolean))];
  const ownerMap = new Map<string, { full_name: string; email: string }>();

  if (ownerIds.length) {
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('id, full_name')
      .in('id', ownerIds);
    for (const p of profiles ?? []) {
      ownerMap.set(p.id, { full_name: p.full_name ?? '—', email: '' });
    }
    for (const ownerId of ownerIds) {
      const { data: authUser } = await admin.auth.admin.getUserById(ownerId);
      if (authUser?.user?.email) {
        const existing = ownerMap.get(ownerId) ?? { full_name: '—', email: '' };
        ownerMap.set(ownerId, { ...existing, email: authUser.user.email });
      }
    }
  }

  const enriched = (stores ?? []).map((s) => ({
    ...s,
    owner_name: ownerMap.get(s.owner_id)?.full_name ?? '—',
    owner_email: ownerMap.get(s.owner_id)?.email ?? s.email,
  }));

  return NextResponse.json({ data: enriched });
}

export async function PATCH(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'stores.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as {
    store_id: string;
    is_active?: boolean;
    subscription_status?: string;
    subscription_plan?: string;
    subscription_ends_at?: string | null;
    trial_ends_at?: string | null;
    ai_enabled?: boolean;
    ai_monthly_limit?: number | null;
    country?: string;
    freeze_reason?: string | null;
    action?: 'suspend' | 'activate' | 'freeze' | 'disable';
  };

  const { store_id, action, ...updates } = body;
  if (!store_id) return NextResponse.json({ error: 'store_id required' }, { status: 400 });

  const admin = createServiceClient();
  const { data: before } = await admin.from('stores').select('*').eq('id', store_id).single();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (action === 'suspend') {
    patch.is_active = false;
    patch.subscription_status = 'suspended';
    patch.frozen_at = new Date().toISOString();
  } else if (action === 'activate') {
    patch.is_active = true;
    patch.subscription_status = 'active';
    patch.frozen_at = null;
    patch.freeze_reason = null;
  } else if (action === 'freeze') {
    patch.is_active = false;
    patch.frozen_at = new Date().toISOString();
    patch.freeze_reason = updates.freeze_reason ?? 'Frozen by platform admin';
  } else if (action === 'disable') {
    patch.is_active = false;
    patch.subscription_status = 'disabled';
  }

  const allowed = [
    'is_active', 'subscription_status', 'subscription_plan',
    'subscription_ends_at', 'trial_ends_at', 'ai_enabled', 'ai_monthly_limit', 'country', 'freeze_reason',
  ];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) patch[k] = v;
  }

  const { data, error } = await admin.from('stores').update(patch).eq('id', store_id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logPlatformAction({
    actor: platform.user,
    role: platform.role,
    action: action ?? 'store.update',
    resourceType: 'store',
    resourceId: store_id,
    storeId: store_id,
    oldData: before,
    newData: data,
    req,
  });

  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'stores.delete');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('store_id');
  if (!storeId) return NextResponse.json({ error: 'store_id required' }, { status: 400 });

  const admin = createServiceClient();
  const { data: before } = await admin.from('stores').select('*').eq('id', storeId).single();

  // Soft delete — never remove store data
  const { data, error } = await admin
    .from('stores')
    .update({
      is_active: false,
      subscription_status: 'disabled',
      frozen_at: new Date().toISOString(),
      freeze_reason: 'Store disabled by super admin',
      updated_at: new Date().toISOString(),
    })
    .eq('id', storeId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logPlatformAction({
    actor: platform.user,
    role: platform.role,
    action: 'store.disable',
    resourceType: 'store',
    resourceId: storeId,
    storeId,
    oldData: before,
    newData: data,
    req,
  });

  return NextResponse.json({ data, message: 'Store disabled (data preserved)' });
}
