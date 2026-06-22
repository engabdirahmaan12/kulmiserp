import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceClient,
  logPlatformAction,
  requirePlatformUserFromRequest,
} from '@/lib/platform/auth.server';

export async function GET(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'ai.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceClient();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ data: settings }, { data: logs }, { count: storeCount }] = await Promise.all([
    admin.from('platform_settings').select('*').eq('key', 'ai').maybeSingle(),
    admin
      .from('ai_usage_logs')
      .select('store_id, tokens_used, estimated_cost_usd, created_at, stores(name)')
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .limit(500),
    admin.from('stores').select('id', { count: 'exact', head: true }).eq('ai_enabled', true),
  ]);

  const requests = logs?.length ?? 0;
  const tokens = logs?.reduce((s, l) => s + (l.tokens_used ?? 0), 0) ?? 0;
  const cost = logs?.reduce((s, l) => s + Number(l.estimated_cost_usd ?? 0), 0) ?? 0;
  const uniqueStores = new Set(logs?.map((l) => l.store_id)).size;

  const byStore = new Map<string, { name: string; requests: number; tokens: number; cost: number }>();
  for (const log of logs ?? []) {
    const name = (log.stores as { name?: string } | null)?.name ?? 'Unknown';
    const cur = byStore.get(log.store_id) ?? { name, requests: 0, tokens: 0, cost: 0 };
    cur.requests += 1;
    cur.tokens += log.tokens_used ?? 0;
    cur.cost += Number(log.estimated_cost_usd ?? 0);
    byStore.set(log.store_id, cur);
  }

  return NextResponse.json({
    data: {
      settings: settings?.value ?? { enabled: true },
      summary: {
        requests,
        tokens,
        cost,
        active_stores: storeCount ?? 0,
        stores_using_ai: uniqueStores,
      },
      top_stores: [...byStore.entries()]
        .map(([store_id, v]) => ({ store_id, ...v }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 20),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'ai.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as {
    global_enabled?: boolean;
    default_monthly_requests?: number;
    default_monthly_tokens?: number;
    store_id?: string;
    store_ai_enabled?: boolean;
    store_ai_limit?: number | null;
  };

  const admin = createServiceClient();

  if (body.global_enabled !== undefined || body.default_monthly_requests !== undefined) {
    const { data: existing } = await admin.from('platform_settings').select('value').eq('key', 'ai').maybeSingle();
    const value = {
      ...(existing?.value as object ?? {}),
      ...(body.global_enabled !== undefined ? { enabled: body.global_enabled } : {}),
      ...(body.default_monthly_requests !== undefined ? { default_monthly_requests: body.default_monthly_requests } : {}),
      ...(body.default_monthly_tokens !== undefined ? { default_monthly_tokens: body.default_monthly_tokens } : {}),
    };
    await admin.from('platform_settings').upsert({
      key: 'ai',
      value,
      updated_at: new Date().toISOString(),
      updated_by: platform.user.id,
    });
  }

  if (body.store_id) {
    await admin.from('stores').update({
      ai_enabled: body.store_ai_enabled,
      ai_monthly_limit: body.store_ai_limit,
      updated_at: new Date().toISOString(),
    }).eq('id', body.store_id);
  }

  await logPlatformAction({
    actor: platform.user, role: platform.role, action: 'ai.settings_update',
    resourceType: 'platform_settings', resourceId: 'ai', storeId: body.store_id, newData: body, req,
  });

  return NextResponse.json({ data: { ok: true } });
}
