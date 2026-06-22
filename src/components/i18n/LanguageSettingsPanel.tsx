'use client';

import { LanguageSwitcher } from './LanguageSwitcher';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { DataPanel } from '@/components/layout/PageShell';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LanguageSettingsPanel({ className }: { className?: string }) {
  const { t, localeLabel } = useTranslation();

  return (
    <DataPanel className={cn('p-6 space-y-5', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('language.title')}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{t('language.description')}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">{t('language.current')}</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{localeLabel}</p>
          </div>
          <LanguageSwitcher variant="full" showIcon={false} />
        </div>
      </div>
    </DataPanel>
  );
}
