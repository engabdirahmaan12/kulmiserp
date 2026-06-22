import { format as dfFormat } from 'date-fns';
import { arSA, enUS } from 'date-fns/locale';
import type { Locale } from '@/locales';
import { LOCALE_META } from '@/locales';

const DATE_FNS_LOCALE: Partial<Record<Locale, typeof enUS>> = {
  en: enUS,
  ar: arSA,
};

/** Somali month names for custom formatting */
const SO_MONTHS = [
  'Jannaayo', 'Febraayo', 'Maarso', 'Abriil', 'Maajo', 'Juun',
  'Luulyo', 'Agoosto', 'Sebtembar', 'Oktoobar', 'Nofembar', 'Diseembar',
];

export function formatLocaleDate(date: Date | string, locale: Locale, pattern?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';

  if (locale === 'so') {
    const day = d.getDate();
    const month = SO_MONTHS[d.getMonth()];
    const year = d.getFullYear();
    if (pattern === 'short') return `${day} ${month.slice(0, 3)} ${year}`;
    return `${day} ${month} ${year}`;
  }

  const fmt = pattern ?? 'PPP';
  const dfLoc = DATE_FNS_LOCALE[locale] ?? enUS;

  if (locale === 'ar') {
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      numberingSystem: 'arab',
    }).format(d);
  }

  return dfFormat(d, fmt, { locale: dfLoc });
}

export function formatLocaleNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  const tag = LOCALE_META[locale]?.dateLocale ?? 'en-US';
  if (locale === 'ar') {
    return new Intl.NumberFormat('ar-SA', { numberingSystem: 'arab', ...options }).format(value);
  }
  return new Intl.NumberFormat(tag, options).format(value);
}

export function formatLocaleCurrency(
  value: number,
  currency: string,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  const tag = LOCALE_META[locale]?.dateLocale ?? 'en-US';
  // Ensure minimumFractionDigits never exceeds maximumFractionDigits after merge
  const mergedMin = options?.minimumFractionDigits ?? 2;
  const mergedMax = options?.maximumFractionDigits;
  const safeMin = mergedMax !== undefined ? Math.min(mergedMin, mergedMax) : mergedMin;

  if (locale === 'ar') {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency,
      numberingSystem: 'arab',
      minimumFractionDigits: safeMin,
      ...options,
    }).format(value);
  }
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency,
    minimumFractionDigits: safeMin,
    ...options,
  }).format(value);
}
