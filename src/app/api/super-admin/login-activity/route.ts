import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, requirePlatformUserFromRequest } from '@/lib/platform/auth.server';

export async function POST(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req);
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { email?: string; success?: boolean };
  const admin = createServiceClient();

  await admin.from('platform_login_activity').insert({
    user_id: platform.user.id,
    email: body.email ?? platform.user.email,
    platform_role: platform.role,
    ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    user_agent: req.headers.get('user-agent') ?? null,
    success: body.success ?? true,
  });

  return NextResponse.json({ data: { ok: true } });
}
