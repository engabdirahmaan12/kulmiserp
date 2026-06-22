import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, requirePlatformUserFromRequest } from '@/lib/platform/auth.server';

export async function GET(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'notifications.view');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get('unread') === 'true';

  const admin = createServiceClient();
  let query = admin
    .from('platform_notifications')
    .select('*, store:stores(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (unreadOnly) query = query.eq('is_read', false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    unread_count: data?.filter((n) => !n.is_read).length ?? 0,
  });
}

export async function PATCH(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'notifications.view');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { id?: string; mark_all_read?: boolean };
  const admin = createServiceClient();

  if (body.mark_all_read) {
    await admin.from('platform_notifications').update({ is_read: true }).eq('is_read', false);
    return NextResponse.json({ data: { ok: true } });
  }

  if (body.id) {
    await admin.from('platform_notifications').update({ is_read: true }).eq('id', body.id);
    return NextResponse.json({ data: { ok: true } });
  }

  return NextResponse.json({ error: 'id or mark_all_read required' }, { status: 400 });
}
