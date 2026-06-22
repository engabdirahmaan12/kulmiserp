'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, CheckCircle2, Loader2, Mail, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

const emailSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

const resetSchema = z.object({
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string(),
}).refine((d) => d.new_password === d.confirm_password, {
  message: "Passwords don't match",
  path: ['confirm_password'],
});

type EmailForm = z.infer<typeof emailSchema>;
type ResetForm = z.infer<typeof resetSchema>;
type Step = 'email' | 'otp' | 'success';

const RESEND_COOLDOWN = 60; // seconds

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    register: regEmail,
    handleSubmit: handleEmailSubmit,
    formState: { errors: emailErrors },
  } = useForm<EmailForm>({ resolver: zodResolver(emailSchema) });

  const {
    register: regReset,
    handleSubmit: handleResetSubmit,
    formState: { errors: resetErrors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  const sendOtp = async (emailVal: string) => {
    setIsSending(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailVal }),
      });
      const json = await res.json() as { success?: boolean; error?: string };

      if (!res.ok) {
        toast.error(json.error ?? 'Failed to send code. Please try again.');
        return false;
      }

      return true;
    } catch {
      toast.error('Network error. Please check your connection.');
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const onSendCode = async (data: EmailForm) => {
    const ok = await sendOtp(data.email);
    if (ok) {
      setEmail(data.email);
      setStep('otp');
      startCooldown();
      toast.success('Code sent! Check your email inbox.');
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || isSending) return;
    const ok = await sendOtp(email);
    if (ok) {
      setOtp('');
      startCooldown();
      toast.success('New code sent!');
    }
  };

  const onResetPassword = async (data: ResetForm) => {
    if (otp.length < 6) {
      toast.error('Please enter the 6-digit code first.');
      return;
    }
    setIsResetting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, new_password: data.new_password }),
      });
      const json = await res.json() as { success?: boolean; error?: string };

      if (!res.ok) {
        toast.error(json.error ?? 'Something went wrong. Please try again.');
        if (json.error?.includes('expired')) {
          setOtp('');
        }
        return;
      }

      setStep('success');
    } catch {
      toast.error('Network error. Please check your connection.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Card className="shadow-lg shadow-slate-200/40 border-slate-100 bg-white/95 backdrop-blur-sm rounded-2xl">
      <CardHeader className="space-y-1 pb-4">
        <div className="flex items-center gap-2 mb-2">
          {step !== 'success' && (
            <button
              type="button"
              onClick={() => step === 'otp' ? setStep('email') : undefined}
              className="text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Back"
            >
              <Link href={step === 'email' ? '/login' : '#'} onClick={step === 'otp' ? (e) => { e.preventDefault(); setStep('email'); } : undefined}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </button>
          )}
          <CardTitle className="text-2xl font-bold text-slate-900">
            {step === 'email' && 'Forgot password?'}
            {step === 'otp' && 'Check your email'}
            {step === 'success' && 'Password reset!'}
          </CardTitle>
        </div>
        <CardDescription>
          {step === 'email' && "Enter your email and we'll send you a 6-digit reset code."}
          {step === 'otp' && (
            <>We sent a code to <strong>{email}</strong>. It expires in 5 minutes.</>
          )}
          {step === 'success' && 'Your password has been changed. You can now sign in.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* ── Step 1: Email ── */}
        {step === 'email' && (
          <form onSubmit={handleEmailSubmit(onSendCode)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  className={`pl-10 ${emailErrors.email ? 'border-red-500' : ''}`}
                  {...regEmail('email')}
                />
              </div>
              {emailErrors.email && (
                <p className="text-xs text-red-500">{emailErrors.email.message}</p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40 h-11"
              disabled={isSending}
            >
              {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSending ? 'Sending code…' : 'Send reset code'}
            </Button>
            <p className="text-center text-sm text-slate-500">
              Remember it?{' '}
              <Link href="/login" className="text-blue-600 hover:underline font-medium">
                Sign in
              </Link>
            </p>
          </form>
        )}

        {/* ── Step 2: OTP + New Password ── */}
        {step === 'otp' && (
          <form onSubmit={handleResetSubmit(onResetPassword)} className="space-y-5">
            <div className="space-y-2">
              <Label>6-digit code</Label>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new_password">New password</Label>
              <Input
                id="new_password"
                type="password"
                placeholder="At least 8 characters"
                className={resetErrors.new_password ? 'border-red-500' : ''}
                {...regReset('new_password')}
              />
              {resetErrors.new_password && (
                <p className="text-xs text-red-500">{resetErrors.new_password.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm_password">Confirm password</Label>
              <Input
                id="confirm_password"
                type="password"
                placeholder="Repeat new password"
                className={resetErrors.confirm_password ? 'border-red-500' : ''}
                {...regReset('confirm_password')}
              />
              {resetErrors.confirm_password && (
                <p className="text-xs text-red-500">{resetErrors.confirm_password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40 h-11"
              disabled={isResetting || otp.length < 6}
            >
              {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isResetting ? 'Resetting…' : 'Reset password'}
            </Button>

            <button
              type="button"
              onClick={onResend}
              disabled={cooldown > 0 || isSending}
              className="flex items-center justify-center gap-1.5 w-full text-sm text-slate-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {cooldown > 0
                ? `Resend code in ${cooldown}s`
                : isSending
                  ? 'Sending…'
                  : "Didn't receive it? Resend code"}
            </button>
          </form>
        )}

        {/* ── Step 3: Success ── */}
        {step === 'success' && (
          <div className="text-center space-y-5 py-2">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <p className="text-slate-600 text-sm">
              Your password has been successfully reset. You can now sign in with your new password.
            </p>
            <Link
              href="/login"
              className="flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-sm font-semibold text-white hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md shadow-blue-200/40"
            >
              Sign in now
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
