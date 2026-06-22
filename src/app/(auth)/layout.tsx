'use client';

import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Left — branding panel (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col justify-between bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 p-10 text-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
            <svg width="22" height="22" viewBox="0 0 44 44" fill="none">
              <path d="M8 14C8 11.8 9.8 10 12 10h6c2.2 0 4 1.8 4 4v16c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4V14z" fill="white" fillOpacity="0.9"/>
              <path d="M24 14c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white" fillOpacity="0.7"/>
              <path d="M24 26c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white"/>
            </svg>
          </div>
          <div>
            <p className="font-bold text-lg leading-none">KULMIS ERP</p>
            <p className="text-xs text-blue-200 tracking-widest mt-0.5">BUSINESS PLATFORM</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-3xl font-bold leading-tight">
              Manage your entire<br />business in one place
            </h2>
            <p className="text-blue-200 mt-3 text-sm leading-relaxed">
              POS, Inventory, Accounting, Customers, and more — built for modern Somali businesses.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'POS & Sales', icon: '🛒' },
              { label: 'Inventory', icon: '📦' },
              { label: 'Accounting', icon: '📊' },
              { label: 'Customers', icon: '👥' },
              { label: 'Reports', icon: '📈' },
              { label: 'Multi-tenant', icon: '🏪' },
            ].map(({ label, icon }) => (
              <div key={label} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
                <span>{icon}</span>
                <span className="font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-white/10 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-lg shrink-0">🇸🇴</div>
          <div>
            <p className="text-sm font-semibold">Built for Somali Businesses</p>
            <p className="text-xs text-blue-200 mt-0.5">WAAFI · EVC · SAHAL · ZAAD payments supported</p>
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50/30 p-6 sm:p-10 relative">
        <div className="absolute top-4 end-4 z-10">
          <LanguageSwitcher />
        </div>
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 shadow">
            <svg width="22" height="22" viewBox="0 0 44 44" fill="none">
              <path d="M8 14C8 11.8 9.8 10 12 10h6c2.2 0 4 1.8 4 4v16c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4V14z" fill="white" fillOpacity="0.9"/>
              <path d="M24 14c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white" fillOpacity="0.7"/>
              <path d="M24 26c0-2.2 1.8-4 4-4h6c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4h-6c-2.2 0-4-1.8-4-4v-4z" fill="white"/>
            </svg>
          </div>
          <div>
            <p className="font-bold text-slate-900 leading-none">KULMIS ERP</p>
            <p className="text-[10px] text-slate-400 tracking-widest">BUSINESS PLATFORM</p>
          </div>
        </div>

        <div className="w-full max-w-md">
          {children}
        </div>
      </div>
    </div>
  );
}
