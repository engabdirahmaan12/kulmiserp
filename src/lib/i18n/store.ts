import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale } from '@/locales';
import { DEFAULT_LOCALE } from '@/locales';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'kulmis-locale-v1' },
  ),
);
