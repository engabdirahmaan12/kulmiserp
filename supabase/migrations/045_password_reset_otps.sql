-- Password reset OTPs table
-- Stores hashed OTPs for email-based password reset (verified via Resend)

create table if not exists password_reset_otps (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null,
  otp_hash    text        not null,
  expires_at  timestamptz not null,
  used        boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists password_reset_otps_lookup_idx
  on password_reset_otps (email, otp_hash)
  where not used;

-- Only server-side (service role) access — no public policies
alter table password_reset_otps enable row level security;
