'use client';

import Link from 'next/link';
import { Calendar, Globe, Mail, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sa, SaPlanBadge, SaStatusBadge, StoreAvatar } from '@/components/super-admin/ui';
import { StoreActionsMenu, type StoreActionTarget } from '@/components/super-admin/StoreActionsMenu';

export interface StoreGridItem extends StoreActionTarget {
  email: string | null;
  phone: string | null;
  country: string | null;
  owner_name: string;
  owner_email: string;
  subscription_status: string;
  subscription_ends_at: string | null;
  created_at: string;
}

interface Props {
  store: StoreGridItem;
  index: number;
  onExtend: (s: StoreActionTarget) => void;
  onSuspend: (id: string) => void;
  onActivate: (id: string) => void;
  onFreeze: (id: string) => void;
  onImpersonate: (id: string) => void;
  onResetPassword: (id: string) => void;
  onDisable: (id: string) => void;
}

export function StoreGridCard({
  store,
  index,
  ...actions
}: Props) {
  return (
    <article
      className={cn(
        sa.panel,
        sa.panelHover,
        'p-5 flex flex-col gap-4 sa-enter',
      )}
      style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={`/super-admin/stores/${store.id}`} className="flex items-center gap-3 min-w-0 group">
          <StoreAvatar name={store.name} />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
              {store.name}
            </h3>
            <p className="text-xs text-slate-500 truncate mt-0.5">{store.email ?? store.phone ?? 'No contact'}</p>
          </div>
        </Link>
        <StoreActionsMenu store={store} {...actions} compact />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SaStatusBadge status={store.subscription_status} />
        <SaPlanBadge plan={store.subscription_plan ?? null} />
        {!store.is_active && (
          <span className="text-[10px] uppercase tracking-wider text-red-400/80 font-medium">Inactive</span>
        )}
      </div>

      <div className="space-y-2 text-xs text-slate-400 border-t border-white/[0.05] pt-3">
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="truncate">{store.owner_name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="truncate">{store.owner_email}</span>
        </div>
        {store.country && (
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <span>{store.country}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span>
            {store.subscription_ends_at
              ? `Expires ${new Date(store.subscription_ends_at).toLocaleDateString()}`
              : `Joined ${new Date(store.created_at).toLocaleDateString()}`}
          </span>
        </div>
      </div>

      <Link
        href={`/super-admin/stores/${store.id}`}
        className="mt-auto w-full text-center text-xs font-medium py-2.5 rounded-xl bg-white/[0.04] hover:bg-indigo-600/20 text-slate-300 hover:text-indigo-200 border border-white/[0.06] hover:border-indigo-500/30 transition-all duration-200"
      >
        View details
      </Link>
    </article>
  );
}
