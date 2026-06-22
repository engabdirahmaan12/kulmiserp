import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, requirePlatformUserFromRequest } from '@/lib/platform/auth.server';

export async function GET(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'audit.view');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);
  const action = searchParams.get('action');
  const storeId = searchParams.get('store_id');

  const admin = createServiceClient();
  let query = admin
    .from('platform_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (action) query = query.eq('action', action);
  if (storeId) query = query.eq('store_id', storeId);

  const { data: platformLogs, error } = await query;
  if (error) {
    // Fallback to store audit_logs if migration not applied
    const { data: storeLogs } = await admin
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return NextResponse.json({ data: storeLogs ?? [], source: 'store_audit' });
  }

  const { data: loginActivity } = await admin
    .from('platform_login_activity')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({
    data: platformLogs ?? [],
    login_activity: loginActivity ?? [],
  });
}
