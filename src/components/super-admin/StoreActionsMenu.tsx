'use client';

import { useRouter } from 'next/navigation';
import { Eye, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface StoreActionTarget {
  id: string;
  name: string;
  is_active: boolean;
  subscription_plan?: string | null;
}

interface Props {
  store: StoreActionTarget;
  onExtend: (store: StoreActionTarget) => void;
  onSuspend: (id: string) => void;
  onActivate: (id: string) => void;
  onFreeze: (id: string) => void;
  onImpersonate: (id: string) => void;
  onResetPassword: (id: string) => void;
  onDisable: (id: string) => void;
  compact?: boolean;
}

export function StoreActionsMenu({
  store,
  onExtend,
  onSuspend,
  onActivate,
  onFreeze,
  onImpersonate,
  onResetPassword,
  onDisable,
  compact,
}: Props) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 transition-colors duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-slate-900/95 backdrop-blur-xl border-white/10 min-w-[180px]">
        <DropdownMenuItem onClick={() => router.push(`/super-admin/stores/${store.id}`)}>
          <Eye className="h-4 w-4 mr-2" /> View Store
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExtend(store)}>Extend Subscription</DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10" />
        {store.is_active ? (
          <DropdownMenuItem onClick={() => onSuspend(store.id)}>Suspend Store</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onActivate(store.id)}>Activate Store</DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onFreeze(store.id)}>Freeze Store</DropdownMenuItem>
        {!compact && (
          <>
            <DropdownMenuItem onClick={() => onImpersonate(store.id)}>Impersonate</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onResetPassword(store.id)}>Reset Password</DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem className="text-red-400 focus:text-red-300" onClick={() => onDisable(store.id)}>
          Disable Store
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
