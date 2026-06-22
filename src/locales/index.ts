import { en } from './en';
import { so } from './so';
import { ar } from './ar';
import type { Locale, Messages } from './en';

export const locales: Record<Locale, Messages> = { en, so, ar };

export const LOCALE_META: Record<
  Locale,
  { label: string; nativeLabel: string; dir: 'ltr' | 'rtl'; dateLocale: string }
> = {
  en: { label: 'English', nativeLabel: 'English', dir: 'ltr', dateLocale: 'en-US' },
  so: { label: 'Somali', nativeLabel: 'Soomaali', dir: 'ltr', dateLocale: 'so-SO' },
  ar: { label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl', dateLocale: 'ar-SA' },
};

export const DEFAULT_LOCALE: Locale = 'en';

export type { Locale, Messages };
