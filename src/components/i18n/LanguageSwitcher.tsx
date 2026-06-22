'use client';

import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { LOCALE_META, type Locale } from '@/locales';
import { toSelectItems } from '@/lib/ui/select-utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const LOCALES: Locale[] = ['en', 'so', 'ar'];

interface LanguageSwitcherProps {
  variant?: 'compact' | 'full';
  className?: string;
  showIcon?: boolean;
}

export function LanguageSwitcher({ variant = 'compact', className, showIcon = true }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useTranslation();

  const items = toSelectItems(
    LOCALES.map((l) => ({ id: l, ...LOCALE_META[l] })),
    (x) => x.id,
    (x) => x.nativeLabel,
  );

  const handleChange = (value: string | null) => {
    if (!value || value === locale) return;
    setLocale(value as Locale);
    toast.success(t('language.changed'));
  };

  return (
    <Select value={locale} items={items} onValueChange={handleChange}>
      <SelectTrigger
        className={cn(
          'h-8 gap-1.5 border-slate-200 bg-white dark:bg-slate-900',
          variant === 'compact' ? 'w-[7.5rem] text-xs' : 'w-full max-w-xs',
          className,
        )}
        aria-label={t('language.title')}
      >
        {showIcon && <Globe className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
        <SelectValue placeholder={t('language.title')} />
      </SelectTrigger>
      <SelectContent align="end" className="z-[100]">
        {LOCALES.map((l) => (
          <SelectItem key={l} value={l} className="text-sm">
            {LOCALE_META[l].nativeLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
