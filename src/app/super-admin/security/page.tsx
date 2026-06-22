'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Shield, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function SuperAdminSecurityPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-security'],
    queryFn: async () => {
      const res = await fetch('/api/super-admin/security');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{
        data: {
          settings: { require_2fa?: boolean; session_timeout_hours?: number };
          current_user: { email: string; role: string };
        };
      }>;
    },
  });

  const update = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/super-admin/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-security'] });
      toast.success('Security settings saved');
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  const settings = data?.data.settings ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Security</h1>
        <p className="text-slate-400 text-sm mt-1">Role-based access, session management, and 2FA-ready architecture</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-slate-800 bg-slate-900/60">
          <CardHeader>
            <CardTitle className="text-base text-slate-200 flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-400" /> Your Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Email" value={data?.data.current_user.email ?? '—'} />
            <Row label="Role" value={data?.data.current_user.role ?? '—'} />
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60">
          <CardHeader>
            <CardTitle className="text-base text-slate-200 flex items-center gap-2">
              <Lock className="h-4 w-4 text-indigo-400" /> Platform Security
            </CardTitle>
            <CardDescription className="text-slate-500">2FA integration ready — enable when TOTP provider is configured</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">Require 2FA for Platform Admins</Label>
              <Switch
                checked={settings.require_2fa === true}
                onCheckedChange={(v) => update.mutate({ require_2fa: v })}
              />
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Session Timeout (hours)</Label>
              <Input
                type="number"
                defaultValue={settings.session_timeout_hours ?? 24}
                className="mt-1 bg-slate-800 border-slate-700"
                onBlur={(e) => update.mutate({ session_timeout_hours: Number(e.target.value) })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-800 bg-slate-900/60">
        <CardHeader><CardTitle className="text-base text-slate-200">Role-Based Access Control</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="text-left py-2">Permission</th>
                <th className="text-center py-2">Super Admin</th>
                <th className="text-center py-2">Platform Admin</th>
                <th className="text-center py-2">Support Staff</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              {[
                ['Manage Stores', true, true, false],
                ['Delete/Disable Stores', true, false, false],
                ['Impersonate', true, true, false],
                ['Manage Plans', true, true, false],
                ['Manage Payments', true, true, false],
                ['Extend Subscriptions', true, true, true],
                ['AI Settings', true, true, false],
                ['Security Settings', true, false, false],
              ].map(([perm, sa, pa, ss]) => (
                <tr key={perm as string} className="border-b border-slate-800/50">
                  <td className="py-2 text-slate-300">{perm as string}</td>
                  <td className="text-center">{sa ? '✓' : '—'}</td>
                  <td className="text-center">{pa ? '✓' : '—'}</td>
                  <td className="text-center">{ss ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-slate-800/50 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}
