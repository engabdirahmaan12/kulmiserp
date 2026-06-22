'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchPortalData } from '@/lib/debt/api';
import { DEBT_STATUS_LABELS, DEBT_STATUS_STYLES, fmtDebtCurrency } from '@/lib/debt/utils';
import type { PortalData } from '@/lib/debt/types';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, FileText, CreditCard } from 'lucide-react';

export default function CustomerDebtPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetchPortalData(token)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Invalid link'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-900">Link unavailable</h1>
          <p className="text-sm text-slate-500 mt-1">{error ?? 'This statement link is invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  const currency = data.store.currency ?? 'USD';
  const fmt = (n: number) => fmtDebtCurrency(n, currency);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="text-center">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Account Statement</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{data.store.name}</h1>
          <p className="text-slate-500 mt-1">{data.party.name}</p>
        </div>

        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 shadow-lg">
          <p className="text-blue-100 text-sm">Outstanding Balance</p>
          <p className="text-4xl font-bold mt-1 tabular-nums">{fmt(data.party.balance)}</p>
        </div>

        <div className="rounded-2xl bg-white border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center gap-2 font-semibold text-sm">
            <FileText className="h-4 w-4 text-blue-600" /> Invoices
          </div>
          <div className="divide-y">
            {data.debts.map((d, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{d.invoice_number}</p>
                  <p className="text-xs text-slate-400">
                    Due {d.due_date ? format(parseISO(d.due_date), 'MMM d, yyyy') : '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm tabular-nums">{fmt(d.remaining_balance)}</p>
                  <Badge className={cn('border-0 text-[9px]', DEBT_STATUS_STYLES[d.status])}>
                    {DEBT_STATUS_LABELS[d.status]}
                  </Badge>
                </div>
              </div>
            ))}
            {data.debts.length === 0 && <p className="px-4 py-8 text-center text-slate-400 text-sm">No open invoices</p>}
          </div>
        </div>

        <div className="rounded-2xl bg-white border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center gap-2 font-semibold text-sm">
            <CreditCard className="h-4 w-4 text-indigo-600" /> Payment History
          </div>
          <div className="divide-y">
            {data.payments.map((p, i) => (
              <div key={i} className="px-4 py-3 flex justify-between text-sm">
                <span className="text-slate-500">{format(parseISO(p.payment_date), 'MMM d, yyyy')}</span>
                <span className="font-semibold text-blue-600 tabular-nums">{fmt(p.amount)}</span>
              </div>
            ))}
            {data.payments.length === 0 && <p className="px-4 py-8 text-center text-slate-400 text-sm">No payments yet</p>}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">Powered by KULMIS ERP · Read-only statement</p>
      </div>
    </div>
  );
}
