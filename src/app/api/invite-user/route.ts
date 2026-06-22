import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_ROLES = ['owner', 'manager', 'cashier', 'accountant', 'purchase_officer'] as const;
type ValidRole = typeof VALID_ROLES[number];

export async function POST(req: NextRequest) {
  try {
    // ── 1. Verify caller is authenticated ──────────────────────────────────
    const cookieStore = await cookies();
    const supabaseUser = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    );

    const { data: { user: callerUser }, error: authError } = await supabaseUser.auth.getUser();

    if (authError || !callerUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 2. Parse & validate body ───────────────────────────────────────────
    const body = await req.json() as {
      email?: string;
      full_name?: string;
      role?: string;
      store_id?: string;
    };
    const { email, full_name, role, store_id } = body;

    if (!email || !full_name || !role || !store_id) {
      return NextResponse.json(
        { error: 'Missing required fields: email, full_name, role, store_id' },
        { status: 400 },
      );
    }

    if (!VALID_ROLES.includes(role as ValidRole)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` },
        { status: 400 },
      );
    }

    // ── 3. Verify caller is owner/manager of the target store ──────────────
    const { data: callerMembership, error: membershipError } = await supabaseAdmin
      .from('store_users')
      .select('role, is_active')
      .eq('store_id', store_id)
      .eq('user_id', callerUser.id)
      .single();

    if (membershipError || !callerMembership || !callerMembership.is_active) {
      return NextResponse.json(
        { error: 'You are not a member of this store' },
        { status: 403 },
      );
    }

    const callerRole = callerMembership.role as string;
    if (callerRole !== 'owner' && callerRole !== 'manager') {
      return NextResponse.json(
        { error: 'Only owners and managers can invite users' },
        { status: 403 },
      );
    }

    // Managers cannot create owners
    if (callerRole === 'manager' && role === 'owner') {
      return NextResponse.json(
        { error: 'Managers cannot assign the owner role' },
        { status: 403 },
      );
    }

    // ── 4. Verify store exists and is active ───────────────────────────────
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id, is_active')
      .eq('id', store_id)
      .single();

    if (!store || !store.is_active) {
      return NextResponse.json({ error: 'Store not found or inactive' }, { status: 404 });
    }

    // ── 5. Find or create the invited user ────────────────────────────────
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000,
    });
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    let userId: string;
    const existingUser = existingUsers.users.find((u) => u.email === email);

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const password = (
        Math.random().toString(36).slice(-10) +
        Math.random().toString(36).toUpperCase().slice(-4) +
        '!'
      );
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }
      userId = newUser.user.id;

      await supabaseAdmin.from('user_profiles').upsert({
        id: userId,
        full_name,
        preferred_language: 'en',
        is_super_admin: false,
      });
    }

    // ── 6. Add or reactivate store membership ─────────────────────────────
    const { data: existingStoreUser } = await supabaseAdmin
      .from('store_users')
      .select('id, is_active')
      .eq('store_id', store_id)
      .eq('user_id', userId)
      .single();

    if (existingStoreUser) {
      if (existingStoreUser.is_active) {
        return NextResponse.json(
          { error: 'This user is already a member of the store' },
          { status: 409 },
        );
      }
      const { error: updateError } = await supabaseAdmin
        .from('store_users')
        .update({ role, is_active: true })
        .eq('id', existingStoreUser.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabaseAdmin.from('store_users').insert({
        store_id,
        user_id: userId,
        role,
        is_active: true,
        custom_permissions: {},
      });
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, user_id: userId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
