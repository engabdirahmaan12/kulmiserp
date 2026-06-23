'use client';

import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { ShoppingCart, Package, BarChart3, Users, TrendingUp, Store } from 'lucide-react';

const LOGO = (
  <svg width="22" height="22" viewBox="0 0 44 44" fill="none">
    <path d="M8 14C8 11.8 9.8 10 12 10h6c2.2 0 4 1.8 4 4v16c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4V14z" fill="white" fillOpacity="0.9" />
    <path d="M24 14c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white" fillOpacity="0.7" />
    <path d="M24 26c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white" />
  </svg>
);

const FEATURES = [
  { label: 'POS & Sales', icon: ShoppingCart },
  { label: 'Inventory', icon: Package },
  { label: 'Accounting', icon: BarChart3 },
  { label: 'Customers', icon: Users },
  { label: 'Reports', icon: TrendingUp },
  { label: 'Multi-tenant', icon: Store },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-white">
      {/* Left — branding panel (hidden on mobile) */}
      <div className="relative hidden lg:flex lg:w-[440px] xl:w-[520px] flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 p-12 text-white shrink-0">
        {/* Decorative glow blobs */}
        <div className="pointer-events-none absolute -top-24 -end-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 -start-20 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px]" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
            {LOGO}
          </div>
          <div>
            <p className="font-bold text-lg leading-none">KULMIS ERP</p>
            <p className="text-[11px] text-blue-200 tracking-[0.2em] mt-1">BUSINESS PLATFORM</p>
          </div>
        </div>

        <div className="relative space-y-8">
          <div>
            <h2 className="text-[2rem] font-bold leading-[1.15] tracking-tight">
              Manage your entire<br />business in one place
            </h2>
            <p className="text-blue-100/80 mt-4 text-[15px] leading-relaxed max-w-sm">
              POS, Inventory, Accounting, Customers, and more — built for modern Somali businesses.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-md">
            {FEATURES.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3.5 py-3 text-sm ring-1 ring-white/10 backdrop-blur-sm transition-colors hover:bg-white/[0.16]"
              >
                <Icon className="h-4 w-4 text-blue-100 shrink-0" />
                <span className="font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/10 backdrop-blur-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-xl shrink-0">🇸🇴</div>
          <div>
            <p className="text-sm font-semibold">Built for Somali Businesses</p>
            <p className="text-xs text-blue-200 mt-0.5">WAAFI · EVC · SAHAL · ZAAD payments supported</p>
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="relative flex-1 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-6 sm:p-10">
        {/* Subtle decorative blobs (also visible on mobile) */}
        <div className="pointer-events-none absolute -top-20 end-0 h-64 w-64 rounded-full bg-blue-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 start-10 h-64 w-64 rounded-full bg-indigo-200/30 blur-3xl" />

        <div className="absolute top-4 end-4 z-10">
          <LanguageSwitcher />
        </div>

        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-lg shadow-blue-500/25">
            {LOGO}
          </div>
          <div>
            <p className="font-bold text-slate-900 leading-none">KULMIS ERP</p>
            <p className="text-[10px] text-slate-400 tracking-[0.2em] mt-1">BUSINESS PLATFORM</p>
          </div>
        </div>

        <div className="relative w-full max-w-md">
          {children}
        </div>
      </div>
    </div>
  );
}
