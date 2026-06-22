import { cn } from '@/lib/utils';

/** Primary CTA — matches dashboard hero gradient */
export const btnPrimary =
  'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md shadow-blue-200/40 border-0';

/** Success / confirm actions */
export const btnSuccess =
  'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-md shadow-emerald-200/40 border-0';

export const btnOutline =
  'border-slate-200 bg-white hover:bg-slate-50 text-slate-700';

export const inputSoft =
  'bg-slate-50/80 border-slate-200 focus-visible:bg-white rounded-xl h-10';

export const tableHead =
  'text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wide';

export const tableRow =
  'hover:bg-slate-50/80 transition-colors duration-150';

/** Standard content panel */
export const panelCard =
  'rounded-2xl border border-slate-100 bg-white shadow-sm transition-all duration-300';

/** Nav / tab active pill */
export const navActive =
  'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200/30';

export function statGradient(accent: 'blue' | 'emerald' | 'violet' | 'orange' | 'red' | 'slate') {
  const map = {
    blue: 'from-blue-500 to-blue-600',
    emerald: 'from-emerald-500 to-teal-600',
    violet: 'from-violet-500 to-purple-600',
    orange: 'from-orange-400 to-amber-500',
    red: 'from-red-500 to-rose-600',
    slate: 'from-slate-400 to-slate-600',
  };
  return cn('bg-gradient-to-br text-white', map[accent]);
}
