'use client';

import { useEffect } from 'react';
import { useLocaleStore } from '@/lib/i18n/store';
import { getDir } from '@/lib/i18n/translate';
import { LOCALE_META } from '@/locales';

const ARABIC_FONT_ID = 'kulmis-arabic-font';

function ensureArabicFont() {
  if (document.getElementById(ARABIC_FONT_ID)) return;
  const link = document.createElement('link');
  link.id = ARABIC_FONT_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    const dir = getDir(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    document.body.classList.toggle('font-arabic', locale === 'ar');
    if (locale === 'ar') ensureArabicFont();
  }, [locale]);

  return <>{children}</>;
}

export function localeDisplayName(locale: keyof typeof LOCALE_META): string {
  return LOCALE_META[locale].nativeLabel;
}
