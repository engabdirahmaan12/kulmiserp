import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomInt } from 'crypto';

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

const EMAIL_HTML = (otp: string) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">KULMIS ERP</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0f172a;">Reset your password</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6;">
              We received a request to reset your password. Use the code below — it expires in <strong>5 minutes</strong>.
            </p>
            <div style="background:#f1f5f9;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Your reset code</p>
              <p style="margin:0;font-size:42px;font-weight:800;letter-spacing:12px;color:#2563eb;font-variant-numeric:tabular-nums;">${otp}</p>
            </div>
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              If you didn't request this, you can safely ignore this email. Your password will not be changed.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
              &copy; ${new Date().getFullYear()} KULMIS ERP · Secure password reset
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    const email = body.email?.toLowerCase().trim();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    // Dev mode: skip email send, log OTP to console
    const devMode = process.env.OTP_DEV_MODE === 'true';

    // Check user exists (auth schema isn't exposed via PostgREST, so use the Admin API)
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (listError) {
      console.error('listUsers error:', listError);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
    const authUser = list.users.find((u) => u.email?.toLowerCase() === email);

    // Always return success — never reveal if email is registered
    if (!authUser) {
      return NextResponse.json({ success: true });
    }

    // Generate 6-digit OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Remove previous OTPs for this email
    await supabaseAdmin
      .from('password_reset_otps')
      .delete()
      .eq('email', email);

    // Store new hashed OTP
    const { error: insertErr } = await supabaseAdmin
      .from('password_reset_otps')
      .insert({ email, otp_hash: otpHash, expires_at: expiresAt });

    if (insertErr) {
      console.error('OTP insert error:', insertErr);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }

    if (devMode) {
      console.log(`[DEV] Password reset OTP for ${email}: ${otp}`);
      return NextResponse.json({ success: true });
    }

    // Send via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${process.env.RESEND_FROM_NAME ?? 'KULMIS ERP'} <${process.env.RESEND_FROM_EMAIL}>`,
        to: [email],
        subject: `${otp} — your KULMIS ERP password reset code`,
        html: EMAIL_HTML(otp),
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error('Resend error:', resendRes.status, errBody);
      // Surface the real Resend reason in non-production so setup issues
      // (unverified domain, invalid key, test-mode recipient) are visible.
      const detail = process.env.NODE_ENV !== 'production'
        ? `Email send failed (${resendRes.status}): ${errBody}`
        : 'Failed to send email. Please try again.';
      return NextResponse.json({ error: detail }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Forgot password route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
