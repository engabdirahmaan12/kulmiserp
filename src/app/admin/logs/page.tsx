'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function AdminLogsPage() {
  const [search, setSearch] = useState('');
  const { t } = useTranslation();

  const { data: logs, isLoading } = useQuery({
    queryKey: ['admin-audit-logs'],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('audit_logs')
        .select('*, stores(name)')
        .order('created_at', { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const filtered = (logs ?? []).filter((l) =>
    l.action?.toLowerCase().includes(search.toLowerCase()) ||
    l.table_name?.toLowerCase().includes(search.toLowerCase()) ||
    (l.stores as unknown as { name: string })?.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.logsTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('admin.logsDesc')}</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={t('admin.searchLogs')}
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
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colTime')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colStore')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colAction')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colTable')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admin.colRecord')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log) => (
                    <tr key={log.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {(log.stores as unknown as { name: string })?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          log.action === 'DELETE' ? 'bg-red-100 text-red-800' :
                          log.action === 'INSERT' ? 'bg-green-100 text-green-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{log.table_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {log.record_id?.slice(0, 8)}…
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={5} className="text-center py-10 text-muted-foreground">{t('admin.noLogsFound')}</td>
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
