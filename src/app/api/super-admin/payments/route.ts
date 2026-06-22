import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceClient,
  logPlatformAction,
  requirePlatformUserFromRequest,
} from '@/lib/platform/auth.server';

export async function GET(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'payments.view');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

  const admin = createServiceClient();
  let query = admin
    .from('payment_transactions')
    .select(`
      *,
      store:stores(id, name, email)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const summary = {
    total: data?.length ?? 0,
    success: data?.filter((p) => p.status === 'success').length ?? 0,
    failed: data?.filter((p) => p.status === 'failed').length ?? 0,
    pending: data?.filter((p) => ['initiated', 'pending', 'verifying'].includes(p.status)).length ?? 0,
    revenue: data?.filter((p) => p.status === 'success').reduce((s, p) => s + Number(p.amount_usd), 0) ?? 0,
  };

  return NextResponse.json({ data, summary });
}

export async function PATCH(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'payments.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as {
    transaction_id: string;
    action: 'verify' | 'refund' | 'extend_subscription';
    days?: number;
    months?: number;
  };

  const admin = createServiceClient();
  const { data: tx } = await admin
    .from('payment_transactions')
    .select('*')
    .eq('id', body.transaction_id)
    .single();

  if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  if (body.action === 'verify') {
    const { data, error } = await admin
      .from('payment_transactions')
      .update({
        status: 'success',
        verified_at: new Date().toISOString(),
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.transaction_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await admin.rpc('platform_extend_subscription', {
      p_store_id: tx.store_id,
      p_days: 0,
      p_months: tx.months ?? 1,
      p_years: 0,
      p_plan_slug: tx.plan_id,
      p_actor_id: platform.user.id,
    });

    await logPlatformAction({
      actor: platform.user, role: platform.role, action: 'payment.verify',
      resourceType: 'payment', resourceId: body.transaction_id, storeId: tx.store_id, req,
    });
    return NextResponse.json({ data });
  }

  if (body.action === 'refund') {
    const { data, error } = await admin
      .from('payment_transactions')
      .update({ status: 'cancelled', failure_reason: 'Refunded by platform admin', updated_at: new Date().toISOString() })
      .eq('id', body.transaction_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logPlatformAction({
      actor: platform.user, role: platform.role, action: 'payment.refund',
      resourceType: 'payment', resourceId: body.transaction_id, storeId: tx.store_id, req,
    });
    return NextResponse.json({ data });
  }

  if (body.action === 'extend_subscription') {
    await admin.rpc('platform_extend_subscription', {
      p_store_id: tx.store_id,
      p_days: body.days ?? 0,
      p_months: body.months ?? tx.months ?? 1,
      p_years: 0,
      p_plan_slug: tx.plan_id,
      p_actor_id: platform.user.id,
    });
    await logPlatformAction({
      actor: platform.user, role: platform.role, action: 'payment.extend_subscription',
      resourceType: 'payment', resourceId: body.transaction_id, storeId: tx.store_id, req,
    });
    return NextResponse.json({ data: { ok: true } });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
