'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

const ROLE_BADGE: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800',
  manager: 'bg-blue-100 text-blue-800',
  cashier: 'bg-green-100 text-green-800',
  accountant: 'bg-yellow-100 text-yellow-800',
  purchase_officer: 'bg-orange-100 text-orange-800',
};

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const { t } = useTranslation();

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-store-users'],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('store_users')
        .select('id, role, is_active, created_at, stores(name), user_id')
        .order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  const filtered = (users ?? []).filter((u) => {
    const storeName = (u.stores as unknown as { name: string })?.name ?? '';
    return storeName.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.usersTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('admin.usersDesc')}</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={t('admin.searchUsers')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colUserId')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colStore')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colRole')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colStatus')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colJoined')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{u.user_id.slice(0, 12)}…</td>
                      <td className="px-4 py-3 font-medium">
                        {(u.stores as unknown as { name: string })?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-800'}`}>
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {u.is_active ? t('admin.statusActive') : t('admin.statusInactive')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={5} className="text-center py-10 text-muted-foreground">{t('admin.noUsersFound')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
