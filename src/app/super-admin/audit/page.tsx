'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AuditLog {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  store_id: string | null;
  created_at: string;
}

export default function SuperAdminAuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-audit'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/audit?limit=200');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ data: AuditLog[]; login_activity: Array<Record<string, string>> }>;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Audit Logs</h1>
        <p className="text-slate-400 text-sm mt-1">Subscription changes, store actions, payments, and login activity</p>
      </div>

      <Card className="border-slate-800 bg-slate-900/60">
        <CardHeader><CardTitle className="text-base text-slate-200">Platform Actions</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Actor</th>
                    <th className="text-left px-4 py-2">Action</th>
                    <th className="text-left px-4 py-2">Resource</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((log) => (
                    <tr key={log.id} className="border-b border-slate-800/50">
                      <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <p className="text-slate-300">{log.actor_email ?? '—'}</p>
                        <p className="text-xs text-slate-500">{log.actor_role}</p>
                      </td>
                      <td className="px-4 py-2 text-indigo-300 font-mono text-xs">{log.action}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{log.resource_type}{log.resource_id ? ` · ${log.resource_id.slice(0, 8)}` : ''}</td>
                    </tr>
                  ))}
                  {!data?.data.length && (
                    <tr><td colSpan={4} className="text-center py-12 text-slate-500">No audit logs yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900/60">
        <CardHeader><CardTitle className="text-base text-slate-200">Login Activity</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="text-left px-4 py-2">Time</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {data?.login_activity.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/50">
                  <td className="px-4 py-2 text-slate-500 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-slate-300">{l.email}</td>
                  <td className="px-4 py-2 text-slate-400">{l.platform_role}</td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{l.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
