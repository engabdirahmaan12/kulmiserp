import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceClient,
  logPlatformAction,
  requirePlatformUserFromRequest,
} from '@/lib/platform/auth.server';

export async function GET(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'plans.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceClient();
  const { data, error } = await admin
    .from('subscription_plans')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'plans.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const admin = createServiceClient();
  const { data, error } = await admin.from('subscription_plans').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logPlatformAction({
    actor: platform.user, role: platform.role, action: 'plan.create',
    resourceType: 'plan', resourceId: data.id, newData: data, req,
  });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'plans.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { id: string; [key: string]: unknown };
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const admin = createServiceClient();
  const { data: before } = await admin.from('subscription_plans').select('*').eq('id', id).single();
  const { data, error } = await admin
    .from('subscription_plans')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logPlatformAction({
    actor: platform.user, role: platform.role, action: 'plan.update',
    resourceType: 'plan', resourceId: id, oldData: before, newData: data, req,
  });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'plans.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const admin = createServiceClient();
  const { data, error } = await admin
    .from('subscription_plans')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logPlatformAction({
    actor: platform.user, role: platform.role, action: 'plan.deactivate',
    resourceType: 'plan', resourceId: id, newData: data, req,
  });
  return NextResponse.json({ data });
}
