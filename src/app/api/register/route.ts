import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side admin client — never exposed to browser
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request: Request) {
  try {
    const { email, password, businessName, fullName } = await request.json();

    if (!email || !password || !businessName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Create auth user via admin API — bypasses email confirmation entirely
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email — no confirmation email sent
      user_metadata: { full_name: fullName ?? '' },
    });

    if (userError) {
      const errMsg = userError.message || userError.code || 'Failed to create account';
      console.error('Auth createUser error:', userError);

      // Handle duplicate email gracefully
      if (errMsg.toLowerCase().includes('already been registered') ||
          errMsg.toLowerCase().includes('already registered') ||
          errMsg.toLowerCase().includes('duplicate')) {
        return NextResponse.json({ error: 'EMAIL_EXISTS' }, { status: 409 });
      }
      if (errMsg.includes('Database error creating new user')) {
        return NextResponse.json({
          error: 'Account setup failed on the server. Please run migration 003_fix_auth_user_trigger.sql in Supabase SQL Editor, then try again.',
        }, { status: 500 });
      }
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const userId = userData.user.id;

    // 2. Create store
    const slug = businessName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);

    const { data: store, error: storeError } = await supabaseAdmin
      .from('stores')
      .insert({
        name: businessName,
        slug: `${slug}-${Date.now()}`,
        owner_id: userId,
        subscription_status: 'trial',
        subscription_plan: 'free_trial',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (storeError) {
      // Rollback: delete user if store creation fails
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: storeError.message }, { status: 500 });
    }

    // 3. Add user to store_users as owner
    await supabaseAdmin.from('store_users').insert({
      store_id: store.id,
      user_id: userId,
      role: 'owner',
    });

    // 4. Create user profile
    await supabaseAdmin.from('user_profiles').upsert({
      id: userId,
      full_name: fullName ?? null,
    }, { onConflict: 'id' });

    // 5. Create default chart of accounts
    await supabaseAdmin.rpc('create_default_chart_of_accounts', {
      p_store_id: store.id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Register API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
