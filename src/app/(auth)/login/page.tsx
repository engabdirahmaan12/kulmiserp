'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, Mail, Lock, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n/useTranslation';

type LoginForm = {
  email: string;
  password: string;
  remember?: boolean;
};

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const { t } = useTranslation();

  const loginSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(t('validation.email')),
        password: z.string().min(6, t('validation.minPassword')),
        remember: z.boolean().optional(),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: false },
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          toast.error(t('auth.invalidCredentials'));
        } else if (error.message.includes('Email not confirmed')) {
          toast.error(t('auth.verifyEmail'));
        } else {
          toast.error(error.message);
        }
        return;
      }

      toast.success(t('auth.welcomeBackToast'));
      router.push('/dashboard');
      router.refresh();
    } catch {
      toast.error(t('errors.generic'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-xl shadow-slate-300/30 p-7 sm:p-9">
      <div className="space-y-1.5 mb-7">
        <h1 className="text-[1.7rem] font-bold tracking-tight text-slate-900">{t('auth.welcomeBack')}</h1>
        <p className="text-sm text-slate-500">{t('auth.signInSubtitle')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-slate-700 font-medium">{t('auth.email')}</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              {...register('email')}
              className={`h-12 ps-11 rounded-xl bg-slate-50/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:bg-white transition-colors ${errors.email ? 'border-red-400' : ''}`}
            />
          </div>
          {errors.email && (
            <p className="text-xs text-red-500">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-slate-700 font-medium">{t('auth.password')}</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="current-password"
              {...register('password')}
              className={`h-12 ps-11 pe-11 rounded-xl bg-slate-50/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:bg-white transition-colors ${errors.password ? 'border-red-400' : ''}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute end-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-red-500">{errors.password.message}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={watch('remember')}
            onCheckedChange={(checked) => setValue('remember', !!checked)}
          />
          <Label htmlFor="remember" className="text-sm font-normal text-slate-600 cursor-pointer">
            {t('auth.rememberMe')}
          </Label>
        </div>

        <Button
          type="submit"
          className="group w-full h-12 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[15px] font-semibold shadow-lg shadow-blue-500/25 transition-all"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              {t('auth.signingIn')}
            </>
          ) : (
            <>
              {t('auth.signIn')}
              <ArrowRight className="ms-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
            </>
          )}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-600">
        {t('auth.noAccount')}{' '}
        <Link href="/register" className="text-blue-600 font-semibold hover:underline">
          {t('auth.createOneFree')}
        </Link>
      </div>
    </div>
  );
}
