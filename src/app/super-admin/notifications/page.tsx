'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Notification {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
  store?: { name: string };
}

export default function SuperAdminNotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-notifications'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/notifications');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ data: Notification[]; unread_count: number }>;
    },
  });

  const markRead = useMutation({
    mutationFn: async (payload: { id?: string; mark_all_read?: boolean }) => {
      const res = await fetch('/api/super-admin/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['super-admin-alerts'] });
      toast.success('Updated');
    },
  });

  const SEVERITY_STYLE: Record<string, string> = {
    critical: 'border-red-500/40 bg-red-500/10',
    warning: 'border-amber-500/40 bg-amber-500/10',
    info: 'border-slate-700 bg-slate-800/50',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Platform Alerts</h1>
          <p className="text-slate-400 text-sm mt-1">
            Expired stores, failed payments, AI overuse, and suspicious activity
          </p>
        </div>
        {(data?.unread_count ?? 0) > 0 && (
          <Button variant="outline" className="border-slate-700" onClick={() => markRead.mutate({ mark_all_read: true })}>
            Mark all read ({data?.unread_count})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {data?.data.map((n) => (
            <Card key={n.id} className={`border ${SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.info} ${n.is_read ? 'opacity-60' : ''}`}>
              <CardContent className="py-4 flex items-start gap-3">
                <Bell className={`h-5 w-5 shrink-0 ${n.severity === 'critical' ? 'text-red-400' : n.severity === 'warning' ? 'text-amber-400' : 'text-slate-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-200">{n.title}</p>
                    {!n.is_read && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                  </div>
                  {n.message && <p className="text-sm text-slate-400 mt-1">{n.message}</p>}
                  <p className="text-xs text-slate-500 mt-2">
                    {n.store?.name && `${n.store.name} · `}
                    {new Date(n.created_at).toLocaleString()} · {n.type}
                  </p>
                </div>
                {!n.is_read && (
                  <Button size="sm" variant="ghost" className="text-xs shrink-0" onClick={() => markRead.mutate({ id: n.id })}>
                    Mark read
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {!data?.data.length && (
            <p className="text-center py-16 text-slate-500">No notifications</p>
          )}
        </div>
      )}
    </div>
  );
}
