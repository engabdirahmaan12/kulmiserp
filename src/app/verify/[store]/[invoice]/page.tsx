'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, ShieldCheck, Phone, Mail, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PublicInvoice {
  store: {
    name: string;
    logo_url?: string | null;
    phone?: string | null;
    address?: string | null;
    email?: string | null;
    currency: string;
  };
  invoice: {
    invoice_number: string;
    sale_date: string;
    status: string;
    customer_name?: string | null;
    subtotal: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
    paid_amount: number;
    credit_amount: number;
    balance_due: number;
    payment_status: 'paid' | 'partial' | 'unpaid';
    is_refunded: boolean;
  };
  items: { product_name: string; quantity: number; unit_price: number; discount_amount: number; subtotal: number }[];
}

const STATUS_BADGE: Record<string, string> = {
  paid:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-100 text-amber-700 border-amber-200',
  unpaid:  'bg-red-100 text-red-700 border-red-200',
};

export default function VerifyInvoicePage() {
  const { store, invoice } = useParams<{ store: string; invoice: string }>();
  const [data, setData] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!store || !invoice) return;
    const run = async () => {
      try {
        const supabase = createClient();
        const { data: res, error: rpcErr } = await supabase.rpc('get_public_invoice', {
          p_store_id: store,
          p_invoice_number: decodeURIComponent(invoice),
        });
        if (rpcErr) throw rpcErr;
        const payload = res as { success: boolean; error?: string } & PublicInvoice;
        if (!payload?.success) throw new Error(payload?.error || 'Invoice not found');
        setData(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invoice not found');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [store, invoice]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 max-w-xl mx-auto space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center max-w-sm">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-900">Invoice not found</h1>
          <p className="text-sm text-slate-500 mt-1">
            {error ?? 'This invoice could not be verified. It may have been voided or the link is incorrect.'}
          </p>
          <p className="text-xs text-slate-400 mt-4">Powered by KULMIS ERP</p>
        </div>
      </div>
    );
  }

  const { store: st, invoice: inv, items } = data;
  const currency = st.currency || 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(n) || 0);
  const statusLabel = inv.payment_status === 'paid' ? 'PAID' : inv.payment_status === 'partial' ? 'PARTIAL' : 'UNPAID';

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-slate-50 py-6 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        {/* Verified banner */}
        <div className="flex items-center justify-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4" /> Verified invoice
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-800 to-blue-600 text-white px-6 py-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {st.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={st.logo_url} alt="" className="h-16 w-16 rounded-2xl object-cover border-2 border-white/35 shadow-lg shrink-0" />
                ) : (
                  <div className="h-16 w-16 rounded-2xl bg-white/20 border-2 border-white/35 flex items-center justify-center text-3xl font-black shrink-0">
                    {st.name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="text-2xl font-black tracking-tight truncate leading-tight">{st.name}</h1>
                  {st.phone && <p className="text-white/80 text-xs mt-0.5 flex items-center gap-1"><Phone className="h-3 w-3" /> {st.phone}</p>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-black">{inv.invoice_number}</p>
                <p className="text-white/70 text-xs">{format(new Date(inv.sale_date), 'MMM d, yyyy · h:mm a')}</p>
                <Badge className={cn('border text-[10px] font-bold mt-1.5', STATUS_BADGE[inv.payment_status])}>
                  {inv.is_refunded ? 'REFUNDED' : statusLabel}
                </Badge>
              </div>
            </div>
            {(st.address || st.email) && (
              <div className="mt-3 pt-3 border-t border-white/15 flex flex-wrap gap-x-4 gap-y-1 text-white/75 text-xs">
                {st.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {st.address}</span>}
                {st.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {st.email}</span>}
              </div>
            )}
          </div>

          {/* Customer */}
          {inv.customer_name && (
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bill To</span>
              <p className="font-semibold text-slate-900">{inv.customer_name}</p>
            </div>
          )}

          {/* Items */}
          <div className="px-2 py-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-3 py-2 font-bold">Item</th>
                  <th className="px-2 py-2 font-bold text-center w-12">Qty</th>
                  <th className="px-2 py-2 font-bold text-right w-24">Price</th>
                  <th className="px-3 py-2 font-bold text-right w-24">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{it.product_name}</td>
                    <td className="px-2 py-2.5 text-center text-slate-600 tabular-nums">{Number(it.quantity)}</td>
                    <td className="px-2 py-2.5 text-right text-slate-600 tabular-nums">{fmt(it.unit_price)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmt(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-6 py-4 border-t border-slate-100 space-y-1.5 text-sm">
            <Row label="Subtotal" value={fmt(inv.subtotal)} />
            {inv.discount_amount > 0 && <Row label="Discount" value={`-${fmt(inv.discount_amount)}`} valueClass="text-red-600" />}
            {inv.tax_amount > 0 && <Row label="Tax" value={fmt(inv.tax_amount)} />}
            <div className="flex justify-between items-center border-t-2 border-blue-600 pt-2 mt-1">
              <span className="text-base font-black text-slate-900">Total</span>
              <span className="text-xl font-black text-blue-700 tabular-nums">{fmt(inv.total_amount)}</span>
            </div>
            <Row label="Amount Paid" value={fmt(inv.paid_amount)} valueClass="text-emerald-700 font-semibold" />
            {inv.balance_due > 0 && (
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="font-bold text-red-700">Balance Due</span>
                <span className="font-black text-red-700 tabular-nums">{fmt(inv.balance_due)}</span>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">
          This invoice was verified against the issuing store's records · Powered by KULMIS ERP
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cn('tabular-nums', valueClass ?? 'text-slate-900 font-medium')}>{value}</span>
    </div>
  );
}
