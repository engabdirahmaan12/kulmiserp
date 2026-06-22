'use client';

import { useCallback, useMemo } from 'react';
import { useLocaleStore } from './store';
import { translate, getDir, isRtl, getLocaleLabel } from './translate';
import { formatLocaleCurrency, formatLocaleDate, formatLocaleNumber } from './format';
import type { Locale } from '@/locales';

export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(locale, key, params), [locale]);

  const dir = useMemo(() => getDir(locale), [locale]);
  const rtl = useMemo(() => isRtl(locale), [locale]);

  const formatDate = useCallback(
    (date: Date | string, pattern?: string) => formatLocaleDate(date, locale, pattern),
    [locale],
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => formatLocaleNumber(value, locale, options),
    [locale],
  );

  const formatCurrency = useCallback(
    (value: number, currency: string, options?: Intl.NumberFormatOptions) =>
      formatLocaleCurrency(value, currency, locale, options),
    [locale],
  );

  return {
    t,
    locale,
    setLocale,
    dir,
    isRtl: rtl,
    localeLabel: getLocaleLabel(locale),
    formatDate,
    formatNumber,
    formatCurrency,
  };
}

export type { Locale };
