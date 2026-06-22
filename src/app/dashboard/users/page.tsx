'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, DataPanel, StatStrip, StatChip, EmptyState } from '@/components/layout/PageShell';
import { btnPrimary, tableHead } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { UserCog, Plus, MoreHorizontal, ShieldCheck } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import type { StoreUser, UserRole } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

type StoreUserWithProfile = StoreUser & {
  user_profiles: { full_name?: string; avatar_url?: string; email?: string } | null;
};

const ROLE_CLASS: Record<UserRole, string> = {
  owner: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  cashier: 'bg-green-100 text-green-700',
  accountant: 'bg-orange-100 text-orange-700',
  purchase_officer: 'bg-teal-100 text-teal-700',
};

const ROLES: UserRole[] = ['owner', 'manager', 'cashier', 'accountant', 'purchase_officer'];

async function fetchStoreUsers(storeId: string): Promise<StoreUserWithProfile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('store_users')
    .select('*, user_profiles(full_name, avatar_url, email)')
    .eq('store_id', storeId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as StoreUserWithProfile[];
}

export default function UsersPage() {
  const { currentStore, user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const ROLE_CONFIG: Record<UserRole, { label: string; className: string }> = {
    owner: { label: t('roles.owner'), className: ROLE_CLASS.owner },
    manager: { label: t('roles.manager'), className: ROLE_CLASS.manager },
    cashier: { label: t('roles.cashier'), className: ROLE_CLASS.cashier },
    accountant: { label: t('roles.accountant'), className: ROLE_CLASS.accountant },
    purchase_officer: { label: t('roles.purchase_officer'), className: ROLE_CLASS.purchase_officer },
  };
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<StoreUserWithProfile | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('cashier');
  const [editRole, setEditRole] = useState<UserRole>('cashier');
  const [editActive, setEditActive] = useState(true);

  const { data: storeUsers = [], isLoading } = useQuery({
    queryKey: ['store_users', currentStore?.id],
    queryFn: () => fetchStoreUsers(currentStore!.id),
    enabled: !!currentStore,
  });

  const { mutate: inviteUser, isPending: inviting } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          full_name: inviteName.trim(),
          role: inviteRole,
          store_id: currentStore!.id,
        }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to invite user');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store_users', currentStore?.id] });
      toast.success('Staff member added successfully');
      setShowInvite(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('cashier');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: updateUser, isPending: updating } = useMutation({
    mutationFn: async () => {
      if (!editUser) return;
      const supabase = createClient();
      const { error } = await supabase
        .from('store_users')
        .update({ role: editRole, is_active: editActive })
        .eq('id', editUser.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store_users', currentStore?.id] });
      toast.success('User updated');
      setEditUser(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: deactivateUser } = useMutation({
    mutationFn: async (userId: string) => {
      const supabase = createClient();
      const { error } = await supabase.from('store_users').update({ is_active: false }).eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store_users', currentStore?.id] });
      toast.success('User deactivated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openEdit = (su: StoreUserWithProfile) => {
    setEditUser(su);
    setEditRole(su.role);
    setEditActive(su.is_active);
  };

  const activeCount = storeUsers.filter((u) => u.is_active).length;
  const inactiveCount = storeUsers.length - activeCount;

  return (
    <PageShell>
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        icon={UserCog}
        variant="banner"
        actions={
          <Button onClick={() => setShowInvite(true)} className={cn(btnPrimary, 'gap-2 h-10 rounded-xl font-semibold bg-white/20 hover:bg-white/30 border border-white/30 text-white shadow-none')}>
            <Plus className="h-4 w-4" /> {t('users.addStaff')}
          </Button>
        }
      />

      <StatStrip>
        <StatChip label={t('users.statTotal')} value={String(storeUsers.length)} accent="blue" />
        <StatChip label={t('users.statActive')} value={String(activeCount)} accent="emerald" />
        <StatChip label={t('users.statInactive')} value={String(inactiveCount)} accent={inactiveCount > 0 ? 'orange' : 'slate'} />
        <StatChip label={t('users.statRoles')} value={String(new Set(storeUsers.map((u) => u.role)).size)} sub={t('users.statRolesSub')} accent="violet" />
      </StatStrip>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 border-b border-slate-100">
                <tr>
                  <th className={tableHead}>{t('users.colUser')}</th>
                  <th className={cn(tableHead, 'hidden sm:table-cell')}>{t('users.colEmail')}</th>
                  <th className={cn(tableHead, 'text-center')}>{t('users.colRole')}</th>
                  <th className={cn(tableHead, 'text-center')}>{t('users.colStatus')}</th>
                  <th className={cn(tableHead, 'hidden lg:table-cell')}>{t('users.colJoined')}</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {storeUsers.map((su) => {
                  const rc = ROLE_CONFIG[su.role];
                  const name = su.user_profiles?.full_name ?? 'Unknown';
                  const email = su.user_profiles?.email ?? '';
                  const isSelf = su.user_id === currentUser?.id;
                  return (
                    <tr key={su.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={su.user_profiles?.avatar_url ?? ''} />
                            <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-semibold">
                              {name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="font-medium text-slate-900 truncate">{name}</p>
                              {isSelf && <span className="text-xs text-slate-400">{t('users.youBadge')}</span>}
                            </div>
                            <p className="text-xs text-slate-400 truncate sm:hidden">{email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{email || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`${rc.className} border-0 text-xs gap-1`}>
                          <ShieldCheck className="h-3 w-3" />
                          {rc.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          className={su.is_active ? 'bg-green-100 text-green-700 border-0 text-xs' : 'bg-slate-100 text-slate-500 border-0 text-xs'}
                        >
                          {su.is_active ? t('users.statusActive') : t('users.statusInactive')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs hidden lg:table-cell">
                        {su.created_at ? format(new Date(su.created_at), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {!isSelf && (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent">
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(su)}>
                                {t('users.menuEditRole')}
                              </DropdownMenuItem>
                              {su.is_active && (
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-600"
                                  onClick={() => deactivateUser(su.id)}
                                >
                                  {t('users.menuDeactivate')}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {storeUsers.length === 0 && (
              <EmptyState
                icon={UserCog}
                title={t('users.noStaff')}
                action={
                  <Button variant="link" className="text-blue-600" onClick={() => setShowInvite(true)}>
                    {t('users.addFirstStaff')}
                  </Button>
                }
              />
            )}
          </div>
        )}
      </DataPanel>

      {/* Add Staff Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('users.dialogAddTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('users.labelEmail')}</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('users.emailPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('users.labelFullName')}</Label>
              <Input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder={t('users.namePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('users.labelRole')}</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== 'owner').map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>{t('users.btnCancel')}</Button>
            <Button
              onClick={() => inviteUser()}
              disabled={!inviteEmail.trim() || !inviteName.trim() || inviting}
              className={btnPrimary}
            >
              {inviting ? t('users.btnAdding') : t('users.btnAddStaff')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('users.dialogEditTitle')}</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 rounded-lg p-3 flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-blue-100 text-blue-700">
                    {(editUser.user_profiles?.full_name ?? 'U').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">{editUser.user_profiles?.full_name ?? 'Unknown'}</p>
                  <p className="text-xs text-slate-400">{editUser.user_profiles?.email ?? ''}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('users.labelRole')}</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Label>{t('users.labelActive')}</Label>
                <button
                  onClick={() => setEditActive(!editActive)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${editActive ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${editActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm text-slate-500">{editActive ? t('users.statusActive') : t('users.statusInactive')}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>{t('users.btnCancel')}</Button>
            <Button onClick={() => updateUser()} disabled={updating} className={btnPrimary}>
              {updating ? t('users.btnSaving') : t('users.btnSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
