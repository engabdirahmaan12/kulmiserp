import { locales, LOCALE_META, type Locale } from '@/locales';

type Params = Record<string, string | number>;

function getNested(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function translate(locale: Locale, key: string, params?: Params): string {
  let text = getNested(locales[locale], key) ?? getNested(locales.en, key) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export function getDir(locale: Locale): 'ltr' | 'rtl' {
  return LOCALE_META[locale]?.dir ?? 'ltr';
}

export function isRtl(locale: Locale): boolean {
  return getDir(locale) === 'rtl';
}

export function getLocaleLabel(locale: Locale): string {
  return LOCALE_META[locale]?.nativeLabel ?? locale;
}
