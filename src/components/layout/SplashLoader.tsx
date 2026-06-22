'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface SplashLoaderProps {
  isLoading: boolean;
}

export function SplashLoader({ isLoading }: SplashLoaderProps) {
  const [show, setShow] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => setShow(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  if (!show) return null;

  return (
    <div
      suppressHydrationWarning
      className={cn(
        'fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white transition-opacity duration-500',
        !isLoading && 'opacity-0 pointer-events-none'
      )}
    >
      {/* Logo */}
      <div suppressHydrationWarning className="mb-8 flex flex-col items-center gap-3">
        <div suppressHydrationWarning className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 shadow-2xl">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 14C8 11.8 9.8 10 12 10h6c2.2 0 4 1.8 4 4v16c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4V14z" fill="white" fillOpacity="0.9"/>
            <path d="M24 14c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white" fillOpacity="0.7"/>
            <path d="M24 26c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white"/>
          </svg>
          <div suppressHydrationWarning className="absolute inset-0 rounded-2xl border-2 border-blue-400 opacity-75 animate-ping" />
        </div>
        <div suppressHydrationWarning className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">KULMIS</h1>
          <p className="text-sm text-slate-500 mt-0.5 tracking-widest uppercase">ERP Platform</p>
        </div>
      </div>

      {/* Loading bar */}
      <div suppressHydrationWarning className="w-48 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div suppressHydrationWarning className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full animate-loading-bar" />
      </div>
      
      <p className="mt-4 text-sm text-slate-400 animate-pulse">{t('common.loadingWorkspace')}</p>
    </div>
  );
}
