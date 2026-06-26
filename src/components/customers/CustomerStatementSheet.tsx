'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft, FileText, TrendingDown, TrendingUp, Coins, Banknote,
  CreditCard, ArrowDownLeft, ArrowUpRight, ShoppingCart,
} from 'lucide-react';
import { format } from 'date-fns';
import type { Customer, CustomerStatementEntry } from '@/types';
import { cn } from '@/lib/utils';

interface CustomerStatementSheetProps {
  open: boolean;
  customer: Customer;
  onClose: () => void;
}

const ENTRY_CONFIG: Record<CustomerStatementEntry['type'], {
  label: string;
  icon: typeof FileText;
  color: string;
  badgeClass: string;
  sign: 1 | -1;
}> = {
  sale_credit:        { label: 'Credit Sale',       icon: CreditCard,    color: 'text-red-600',    badgeClass: 'bg-red-50 text-red-700',       sign:  1 },
  sale_paid:          { label: 'Sale (Paid)',        icon: ShoppingCart,  color: 'text-slate-600',  badgeClass: 'bg-slate-100 text-slate-600',   sign:  1 },
  payment:            { label: 'Payment',            icon: TrendingDown,  color: 'text-emerald-600',badgeClass: 'bg-emerald-50 text-emerald-700',sign: -1 },
  deposit_add:        { label: 'Deposit Added',      icon: Coins,         color: 'text-violet-600', badgeClass: 'bg-violet-50 text-violet-700',  sign:  1 },
  deposit_used:       { label: 'Deposit Used',       icon: ArrowUpRight,  color: 'text-blue-600',   badgeClass: 'bg-blue-50 text-blue-700',      sign: -1 },
  deposit_refund:     { label: 'Deposit Refunded',   icon: ArrowDownLeft, color: 'text-rose-600',   badgeClass: 'bg-rose-50 text-rose-700',      sign: -1 },
  advance:            { label: 'Cash Advance',       icon: Banknote,      color: 'text-amber-600',  badgeClass: 'bg-amber-50 text-amber-700',    sign:  1 },
  advance_repayment:  { label: 'Advance Repayment',  icon: TrendingUp,    color: 'text-teal-600',   badgeClass: 'bg-teal-50 text-teal-700',      sign: -1 },
};

interface StatementSummary {
  credit_outstanding: number;
  deposit_balance: number;
  advance_outstanding: number;
  total_purchases: number;
}

export function CustomerStatementSheet({ open, customer, onClose }: CustomerStatementSheetProps) {
  const { currentStore } = useAuthStore();

  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');

  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data, isLoading } = useQuery({
    queryKey: ['customer-statement', customer.id, fromDate, toDate],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('get_customer_statement', {
        p_store_id:    currentStore!.id,
        p_customer_id: customer.id,
        p_from_date:   fromDate ? new Date(fromDate).toISOString() : null,
        p_to_date:     toDate   ? new Date(toDate + 'T23:59:59').toISOString() : null,
      });
      if (error) throw error;
      const result = data as {
        success: boolean;
        entries: CustomerStatementEntry[];
        summary: StatementSummary;
        error?: string;
      };
      if (!result.success) throw new Error(result.error ?? 'Failed to load statement');
      return result;
    },
    enabled: !!currentStore && open,
  });

  const entries  = data?.entries  ?? [];
  const summary  = data?.summary;

  // Compute running balance for credit items only
  const entriesWithBalance = (() => {
    let creditBal    = 0;
    let depositBal   = summary?.deposit_balance ?? 0;
    let advanceBal   = summary?.advance_outstanding ?? 0;

    // Recompute from entries (forward pass would need pre-state; just show signed amounts)
    return entries.map((e) => {
      const cfg = ENTRY_CONFIG[e.type];
      return { ...e, cfg };
    });
  })();

  const totalCredit  = entries.filter((e) => e.type === 'sale_credit').reduce((s, e) => s + e.amount, 0);
  const totalPaid    = entries.filter((e) => e.type === 'payment').reduce((s, e) => s + e.amount, 0);
  const totalAdvance = entries.filter((e) => e.type === 'advance').reduce((s, e) => s + e.amount, 0);
  const totalRepaid  = entries.filter((e) => e.type === 'advance_repayment').reduce((s, e) => s + e.amount, 0);
  const totalDeposit = entries.filter((e) => e.type === 'deposit_add').reduce((s, e) => s + e.amount, 0);
  const totalDepUsed = entries.filter((e) => e.type === 'deposit_used').reduce((s, e) => s + e.amount, 0);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0 gap-0 border-l border-slate-200/80 bg-white"
      >
        <SheetHeader className="px-4 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 pr-8">
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <SheetTitle className="text-base font-semibold text-slate-900">Customer Statement</SheetTitle>
              <p className="text-xs text-slate-500">{customer.full_name}</p>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4 space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-red-100 bg-red-50/60 p-3">
                <p className="text-[11px] font-medium text-red-600/80">Credit Outstanding</p>
                <p className="text-xl font-bold text-red-700 mt-1 tabular-nums">{fmt(summary?.credit_outstanding ?? 0)}</p>
              </div>
              <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3">
                <p className="text-[11px] font-medium text-violet-600/80">Deposit Balance</p>
                <p className="text-xl font-bold text-violet-700 mt-1 tabular-nums">{fmt(summary?.deposit_balance ?? 0)}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                <p className="text-[11px] font-medium text-amber-600/80">Advances Owed</p>
                <p className="text-xl font-bold text-amber-700 mt-1 tabular-nums">{fmt(summary?.advance_outstanding ?? 0)}</p>
              </div>
            </div>

            {/* Date filter */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[11px] text-slate-500 font-medium">From</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 mt-0.5" />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-slate-500 font-medium">To</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 mt-0.5" />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="self-end h-9"
                onClick={() => { setFromDate(''); setToDate(''); }}
              >
                Clear
              </Button>
            </div>

            {/* Entries table */}
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-14 text-slate-400">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No transactions found for this period</p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Date</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Type</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Description</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entriesWithBalance.map((e) => {
                      const Icon = e.cfg.icon;
                      return (
                        <tr key={`${e.type}-${e.id}`} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-3 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                            {format(new Date(e.date), 'MMM d, yyyy')}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge className={cn('text-[10px] font-medium border-0 gap-1 py-0.5', e.cfg.badgeClass)}>
                              <Icon className="h-3 w-3" />
                              {e.cfg.label}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            <span className="font-medium">{e.description}</span>
                            {e.reference && (
                              <span className="ml-1.5 text-xs text-slate-400">#{e.reference}</span>
                            )}
                          </td>
                          <td className={cn('px-3 py-2.5 text-right tabular-nums font-semibold', e.cfg.color)}>
                            {e.cfg.sign === -1 ? '-' : '+'}{fmt(e.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Period summary */}
            {entries.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Period Summary</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {totalCredit > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Credit Sales</span>
                      <span className="font-semibold text-red-600 tabular-nums">{fmt(totalCredit)}</span>
                    </div>
                  )}
                  {totalPaid > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Payments Received</span>
                      <span className="font-semibold text-emerald-600 tabular-nums">{fmt(totalPaid)}</span>
                    </div>
                  )}
                  {totalDeposit > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Deposits Added</span>
                      <span className="font-semibold text-violet-600 tabular-nums">{fmt(totalDeposit)}</span>
                    </div>
                  )}
                  {totalDepUsed > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Deposit Used</span>
                      <span className="font-semibold text-blue-600 tabular-nums">{fmt(totalDepUsed)}</span>
                    </div>
                  )}
                  {totalAdvance > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Advances Given</span>
                      <span className="font-semibold text-amber-600 tabular-nums">{fmt(totalAdvance)}</span>
                    </div>
                  )}
                  {totalRepaid > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Advances Repaid</span>
                      <span className="font-semibold text-teal-600 tabular-nums">{fmt(totalRepaid)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
