import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, requirePlatformUserFromRequest } from '@/lib/platform/auth.server';

export async function GET(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'security.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceClient();
  const [{ data: securitySettings }, { data: loginActivity }] = await Promise.all([
    admin.from('platform_settings').select('*').eq('key', 'security').maybeSingle(),
    admin.from('platform_login_activity').select('*').order('created_at', { ascending: false }).limit(100),
  ]);

  return NextResponse.json({
    data: {
      settings: securitySettings?.value ?? { require_2fa: false, session_timeout_hours: 24 },
      login_activity: loginActivity ?? [],
      current_user: {
        id: platform.user.id,
        email: platform.user.email,
        role: platform.role,
      },
    },
  });
}

export async function PATCH(req: NextRequest) {
  const platform = await requirePlatformUserFromRequest(req, 'security.manage');
  if (!platform) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { require_2fa?: boolean; session_timeout_hours?: number };
  const admin = createServiceClient();

  const { data: existing } = await admin.from('platform_settings').select('value').eq('key', 'security').maybeSingle();
  const value = { ...(existing?.value as object ?? {}), ...body };

  await admin.from('platform_settings').upsert({
    key: 'security',
    value,
    updated_at: new Date().toISOString(),
    updated_by: platform.user.id,
  });

  return NextResponse.json({ data: value });
}
