'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Payment {
  id: string;
  store_id: string;
  plan_id: string;
  months: number;
  amount_usd: number;
  provider: string;
  phone_number: string;
  status: string;
  created_at: string;
  store?: { name: string; email: string };
}

export default function SuperAdminPaymentsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-payments', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/super-admin/payments?${params}`);
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ data: Payment[]; summary: Record<string, number> }>;
    },
  });

  const action = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const res = await fetch('/api/super-admin/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: id, action }),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-payments'] });
      toast.success('Payment updated');
    },
    onError: () => toast.error('Action failed'),
  });

  const STATUS_ICON: Record<string, React.ElementType> = {
    success: CheckCircle,
    failed: XCircle,
    initiated: Clock,
    pending: Clock,
    verifying: Clock,
  };

  const STATUS_COLOR: Record<string, string> = {
    success: 'text-emerald-400',
    failed: 'text-red-400',
    initiated: 'text-amber-400',
    pending: 'text-amber-400',
    verifying: 'text-amber-400',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Payment Management</h1>
        <p className="text-slate-400 text-sm mt-1">Monitor and manage subscription payments</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: data?.summary.total ?? 0 },
          { label: 'Successful', value: data?.summary.success ?? 0 },
          { label: 'Failed', value: data?.summary.failed ?? 0 },
          { label: 'Revenue', value: `$${Number(data?.summary.revenue ?? 0).toLocaleString()}` },
        ].map((s) => (
          <Card key={s.label} className="border-slate-800 bg-slate-900/60">
            <CardContent className="pt-5">
              <p className="text-2xl font-bold text-slate-100">{s.value}</p>
              <p className="text-sm text-slate-400">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
        <SelectTrigger className="w-48 bg-slate-900 border-slate-700 text-slate-100">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Payments</SelectItem>
          <SelectItem value="success">Successful</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>

      <Card className="border-slate-800 bg-slate-900/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="text-left px-4 py-3">Store</th>
                    <th className="text-left px-4 py-3">Plan</th>
                    <th className="text-left px-4 py-3">Amount</th>
                    <th className="text-left px-4 py-3">Provider</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((p) => {
                    const Icon = STATUS_ICON[p.status] ?? Clock;
                    return (
                      <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-4 py-3">
                          <p className="text-slate-200">{p.store?.name ?? '—'}</p>
                          <p className="text-xs text-slate-500">{p.phone_number}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-400 capitalize">{p.plan_id} · {p.months}mo</td>
                        <td className="px-4 py-3 text-slate-200">${p.amount_usd}</td>
                        <td className="px-4 py-3 text-slate-400 uppercase text-xs">{p.provider}</td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 ${STATUS_COLOR[p.status] ?? 'text-slate-400'}`}>
                            <Icon className="h-3.5 w-3.5" /> {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{new Date(p.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right space-x-1">
                          {p.status !== 'success' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs border-slate-700" onClick={() => action.mutate({ id: p.id, action: 'verify' })}>
                              Verify
                            </Button>
                          )}
                          {p.status === 'success' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs border-slate-700" onClick={() => action.mutate({ id: p.id, action: 'refund' })}>
                              Refund
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
