import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function hashOtp(otp: string): string {
  return createHmac('sha256', process.env.EMAIL_OTP_PEPPER!)
    .update(otp)
    .digest('hex');
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; otp?: string; new_password?: string };
    const email = body.email?.toLowerCase().trim();
    const { otp, new_password } = body;

    if (!email || !otp || !new_password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (new_password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const otpHash = hashOtp(otp);

    // Look up the OTP record
    const { data: record, error: lookupErr } = await supabaseAdmin
      .from('password_reset_otps')
      .select('id, expires_at, used')
      .eq('email', email)
      .eq('otp_hash', otpHash)
      .eq('used', false)
      .maybeSingle();

    if (lookupErr) {
      console.error('OTP lookup error:', lookupErr);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }

    if (!record) {
      return NextResponse.json({ error: 'Invalid or expired code. Please try again.' }, { status: 400 });
    }

    if (new Date(record.expires_at) < new Date()) {
      // Clean up expired record
      await supabaseAdmin.from('password_reset_otps').delete().eq('id', record.id);
      return NextResponse.json({ error: 'Code has expired. Please request a new one.' }, { status: 400 });
    }

    // Mark OTP as used immediately (prevent replay)
    await supabaseAdmin
      .from('password_reset_otps')
      .update({ used: true })
      .eq('id', record.id);

    // Find user (auth schema isn't exposed via PostgREST, so use the Admin API)
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (listError) {
      console.error('listUsers error:', listError);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
    const authUser = list.users.find((u) => u.email?.toLowerCase() === email);

    if (!authUser) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Update the password via admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      authUser.id,
      { password: new_password }
    );

    if (updateError) {
      console.error('Password update error:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Reset password route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
