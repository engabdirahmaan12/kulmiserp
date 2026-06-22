'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  Receipt, ShoppingBag, ShoppingCart, ExternalLink, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRICE_TIER_LABELS, type PriceTier } from '@/lib/units/conversion';
import { saleItemCogs } from '@/lib/sales/cogs';
import type { PurchaseOrderItem, SaleItem } from '@/types';

export interface TransactionRow {
  id: string;
  tx_type: string;
  reference: string;
  party_name: string;
  amount: number;
  payment_method: string | null;
  status: string;
  tx_date: string;
}

const TYPE_CONFIG: Record<string, { label: string; className: string; icon: typeof Receipt }> = {
  sale: { label: 'Sale', className: 'bg-emerald-100 text-emerald-700', icon: ShoppingCart },
  purchase: { label: 'Purchase', className: 'bg-blue-100 text-blue-700', icon: ShoppingBag },
  purchase_return: { label: 'Purchase Return', className: 'bg-orange-100 text-orange-700', icon: ShoppingBag },
  expense: { label: 'Expense', className: 'bg-orange-100 text-orange-700', icon: Receipt },
  payment_received: { label: 'Payment Received', className: 'bg-teal-100 text-teal-700', icon: Receipt },
  supplier_payment: { label: 'Supplier Payment', className: 'bg-indigo-100 text-indigo-700', icon: Receipt },
  deposit: { label: 'Deposit', className: 'bg-cyan-100 text-cyan-700', icon: Receipt },
  withdrawal: { label: 'Withdrawal', className: 'bg-rose-100 text-rose-700', icon: Receipt },
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  received: 'bg-green-100 text-green-700',
  approved: 'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-amber-100 text-amber-700',
  void: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-red-100 text-red-700',
  pending: 'bg-blue-100 text-blue-700',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', waafi: 'WAAFI', evc: 'EVC', sahal: 'Sahal', zaad: 'Zaad',
  credit: 'Credit', split: 'Split', bank: 'Bank',
};

const FULL_PAGE: Record<string, (id: string) => string> = {
  sale: (id) => `/dashboard/sales-history?sale=${id}`,
  purchase: (id) => `/dashboard/purchase-history?po=${id}`,
  expense: (id) => `/dashboard/accounting?tab=expenses&expense=${id}`,
};

interface TransactionDetailSheetProps {
  row: TransactionRow | null;
  open: boolean;
  onClose: () => void;
}

async function fetchTransactionDetail(row: TransactionRow) {
  const supabase = createClient();
  if (row.tx_type === 'sale') {
    const { data, error } = await supabase
      .from('sales')
      .select('*, customer:customers(full_name, phone), items:sale_items(*)')
      .eq('id', row.id)
      .single();
    if (error) throw error;
    return { type: 'sale' as const, data };
  }
  if (row.tx_type === 'purchase') {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*, supplier:suppliers(name, phone), items:purchase_order_items(*)')
      .eq('id', row.id)
      .single();
    if (error) throw error;
    return { type: 'purchase' as const, data };
  }
  if (row.tx_type === 'deposit' || row.tx_type === 'withdrawal') {
    const { data, error } = await supabase.from('cash_movements').select('*').eq('id', row.id).single();
    if (error) throw error;
    return { type: 'cash_movement' as const, data };
  }
  if (row.tx_type === 'payment_received') {
    const { data, error } = await supabase
      .from('debt_payments')
      .select('*, customer:customers(full_name, phone), sale:sales(invoice_number)')
      .eq('id', row.id)
      .single();
    if (error) throw error;
    return { type: 'payment_received' as const, data };
  }
  if (row.tx_type === 'supplier_payment') {
    const { data, error } = await supabase
      .from('supplier_payments')
      .select('*, supplier:suppliers(name, phone), purchase_order:purchase_orders(po_number)')
      .eq('id', row.id)
      .single();
    if (error) throw error;
    return { type: 'supplier_payment' as const, data };
  }
  if (row.tx_type === 'purchase_return') {
    const { data, error } = await supabase
      .from('purchase_returns')
      .select('*, items:purchase_return_items(*), supplier:suppliers(name)')
      .eq('id', row.id)
      .single();
    if (error) throw error;
    return { type: 'purchase_return' as const, data };
  }
  const { data, error } = await supabase.from('expenses').select('*').eq('id', row.id).single();
  if (error) throw error;
  return { type: 'expense' as const, data };
}

export function TransactionDetailSheet({ row, open, onClose }: TransactionDetailSheetProps) {
  const { currentStore } = useAuthStore();
  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['transaction-detail', row?.tx_type, row?.id],
    queryFn: () => fetchTransactionDetail(row!),
    enabled: !!row && open,
  });

  if (!row) return null;

  const typeCfg = TYPE_CONFIG[row.tx_type] ?? {
    label: row.tx_type,
    className: 'bg-slate-100 text-slate-600',
    icon: Receipt,
  };
  const TypeIcon = typeCfg.icon;

  const saleItems = detail?.type === 'sale' ? (detail.data.items as SaleItem[]) : [];
  const purchaseItems = detail?.type === 'purchase' ? (detail.data.items as PurchaseOrderItem[]) : [];
  const saleCogs = saleItems.reduce((s, i) => s + saleItemCogs(i), 0);
  const saleRevenue = saleItems.reduce((s, i) => s + (i.subtotal ?? 0), 0);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <div className="flex items-start gap-3 pr-8">
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base font-bold truncate">{row.reference}</SheetTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {format(new Date(row.tx_date), 'MMM d, yyyy · h:mm a')}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold tabular-nums">{fmt(row.amount)}</p>
              <Badge className={cn('mt-1 border-0 text-[10px] capitalize', STATUS_COLORS[row.status] ?? 'bg-slate-100')}>
                {row.status}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 pl-12">
            <span className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold', typeCfg.className)}>
              <TypeIcon className="h-3 w-3" />
              {typeCfg.label}
            </span>
            <span className="text-xs text-slate-600">{row.party_name}</span>
            {row.payment_method && (
              <span className="text-xs text-slate-400">
                · {PAYMENT_LABELS[row.payment_method] ?? row.payment_method}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : detail?.type === 'sale' ? (
            <div className="space-y-4">
              {(saleRevenue > 0 || saleCogs > 0) && (
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Revenue" value={fmt(saleRevenue)} />
                  <MiniStat label="COGS" value={fmt(saleCogs)} />
                  <MiniStat label="Gross profit" value={fmt(saleRevenue - saleCogs)} accent />
                </div>
              )}
              <LineTable
                headers={['Product', 'Qty', 'Unit', 'Base', 'Tier', 'Total']}
                empty="No line items"
                rows={saleItems.map((item) => {
                  const saleQty = item.sale_unit_qty ?? item.quantity;
                  const base = item.base_qty ?? item.quantity;
                  return [
                    item.product_name,
                    String(saleQty),
                    item.sale_unit_code ?? '—',
                    String(base),
                    PRICE_TIER_LABELS[(item.price_tier as PriceTier) ?? 'retail'],
                    fmt(item.subtotal),
                  ];
                })}
              />
            </div>
          ) : detail?.type === 'purchase' ? (
            <LineTable
              headers={['Product', 'Qty', 'Unit', 'Base', 'Cost', 'Total']}
              empty="No line items"
              rows={purchaseItems.map((item) => {
                const purchaseQty = item.purchase_unit_qty ?? item.quantity;
                const base = item.base_qty ?? purchaseQty;
                return [
                  item.product_name,
                  String(purchaseQty),
                  item.purchase_unit_code ?? 'PCS',
                  String(base),
                  fmt(item.unit_cost),
                  fmt(item.subtotal),
                ];
              })}
            />
          ) : detail?.type === 'expense' ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3 text-sm">
              <Row label="Description" value={detail.data.description ?? '—'} />
              <Row label="Category" value={detail.data.category ?? '—'} />
              <Row label="Reference" value={detail.data.reference ?? row.reference} />
              <Row label="Amount" value={fmt(Number(detail.data.amount ?? row.amount))} bold />
              {detail.data.notes && <Row label="Notes" value={detail.data.notes} />}
            </div>
          ) : detail?.type === 'cash_movement' ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3 text-sm">
              <Row label="Type" value={detail.data.movement_type === 'deposit' ? 'Deposit' : 'Withdrawal'} />
              <Row label="Account" value={PAYMENT_LABELS[detail.data.payment_method] ?? detail.data.payment_method} />
              <Row label="Amount" value={fmt(Number(detail.data.amount ?? row.amount))} bold />
              {detail.data.reference && <Row label="Reference" value={detail.data.reference} />}
              {detail.data.notes && <Row label="Notes" value={detail.data.notes} />}
            </div>
          ) : detail?.type === 'payment_received' ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3 text-sm">
              <Row label="Customer" value={(detail.data.customer as { full_name?: string })?.full_name ?? row.party_name} />
              <Row label="Method" value={PAYMENT_LABELS[detail.data.payment_method] ?? detail.data.payment_method} />
              <Row label="Amount" value={fmt(Number(detail.data.amount ?? row.amount))} bold />
              {(detail.data.sale as { invoice_number?: string })?.invoice_number && (
                <Row label="Invoice" value={(detail.data.sale as { invoice_number: string }).invoice_number} />
              )}
              {detail.data.notes && <Row label="Notes" value={detail.data.notes} />}
            </div>
          ) : detail?.type === 'supplier_payment' ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3 text-sm">
              <Row label="Supplier" value={(detail.data.supplier as { name?: string })?.name ?? row.party_name} />
              <Row label="Method" value={PAYMENT_LABELS[detail.data.payment_method] ?? detail.data.payment_method} />
              <Row label="Amount" value={fmt(Math.abs(Number(detail.data.amount ?? row.amount)))} bold />
              {(detail.data.purchase_order as { po_number?: string })?.po_number && (
                <Row label="PO" value={(detail.data.purchase_order as { po_number: string }).po_number} />
              )}
              {detail.data.notes && <Row label="Notes" value={detail.data.notes} />}
            </div>
          ) : detail?.type === 'purchase_return' ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-2 text-sm">
                <Row label="Return #" value={detail.data.return_number ?? row.reference} />
                <Row label="Supplier" value={(detail.data.supplier as { name?: string })?.name ?? row.party_name} />
                <Row label="Total" value={fmt(Number(detail.data.total_amount ?? Math.abs(row.amount)))} bold />
                {detail.data.notes && <Row label="Notes" value={detail.data.notes} />}
              </div>
              <LineTable
                headers={['Product', 'Qty', 'Cost', 'Total']}
                empty="No items"
                rows={((detail.data.items as { product_name: string; purchase_unit_qty: number; unit_cost: number; subtotal: number }[]) ?? []).map((item) => [
                  item.product_name,
                  String(item.purchase_unit_qty),
                  fmt(item.unit_cost),
                  fmt(item.subtotal),
                ])}
              />
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t px-5 py-3 flex gap-2">
          {FULL_PAGE[row.tx_type] && (
            <Link
              href={FULL_PAGE[row.tx_type](row.id)}
              className={cn(buttonVariants({ variant: 'outline' }), 'flex-1 h-9 gap-1.5')}
            >
              <ExternalLink className="h-4 w-4" /> Open full page
            </Link>
          )}
          <Button variant="ghost" className="flex-1 h-9" onClick={onClose}>Close</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase text-slate-400">{label}</p>
      <p className={cn('text-sm font-bold mt-0.5 tabular-nums', accent && 'text-emerald-600')}>{value}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={cn('text-right text-slate-900', bold && 'font-bold')}>{value}</span>
    </div>
  );
}

function LineTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  const colClass = (i: number) =>
    i === 0 ? 'text-left' : i >= headers.length - 1 ? 'text-right font-semibold' : 'text-center';

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div
        className="grid gap-1 px-3 py-2 bg-slate-100/80 border-b text-[10px] font-semibold uppercase text-slate-500"
        style={{ gridTemplateColumns: `1fr repeat(${headers.length - 2}, minmax(44px, auto)) minmax(64px, auto)` }}
      >
        {headers.map((h, i) => (
          <span key={h} className={colClass(i)}>{h}</span>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">{empty}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((row, ri) => (
            <div
              key={ri}
              className="grid gap-1 px-3 py-2.5 items-center text-xs bg-white"
              style={{ gridTemplateColumns: `1fr repeat(${headers.length - 2}, minmax(44px, auto)) minmax(64px, auto)` }}
            >
              {row.map((cell, ci) => (
                <span key={ci} className={cn(colClass(ci), ci === 0 && 'font-medium truncate')} title={cell}>
                  {cell}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
