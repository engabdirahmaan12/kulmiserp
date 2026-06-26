'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Phone, Edit, ArrowLeft, Receipt, AlertCircle, Banknote, Coins, ArrowDownLeft, History, FileText } from 'lucide-react';
import { format } from 'date-fns';
import type { Customer, CustomerDeposit, CustomerAdvance, Sale } from '@/types';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { fetchCustomerDebtsForProfile } from '@/lib/debt/api';
import { computeCustomerCreditScore, CREDIT_TIER_STYLES, buildWhatsAppDebtReminder, openWhatsApp } from '@/lib/debt/utils';
import { PRICE_TIER_LABELS, type PriceTier } from '@/lib/units/conversion';
import { ReceivePaymentModal } from '@/components/sales/ReceivePaymentModal';
import { CustomerDepositModal } from './CustomerDepositModal';
import { CustomerAdvanceModal } from './CustomerAdvanceModal';
import { CustomerStatementSheet } from './CustomerStatementSheet';

interface CustomerDetailSheetProps {
  open: boolean;
  customer: Customer;
  onClose: () => void;
  onEdit: () => void;
}

function saleCredit(sale: Sale): number {
  if (sale.credit_amount > 0) return sale.credit_amount;
  const balance = sale.total_amount - sale.paid_amount;
  return balance > 0 ? balance : 0;
}

export function CustomerDetailSheet({ open, customer, onClose, onEdit }: CustomerDetailSheetProps) {
  const { currentStore } = useAuthStore();
  const [showPayment,         setShowPayment]         = useState(false);
  const [paymentSale,         setPaymentSale]         = useState<Sale | null>(null);
  const [depositModal,        setDepositModal]        = useState<'add' | 'refund' | null>(null);
  const [showDepositHistory,  setShowDepositHistory]  = useState(false);
  const [localDepositBal,     setLocalDepositBal]     = useState<number | null>(null);
  const [advanceModal,        setAdvanceModal]        = useState<'advance' | 'repay' | null>(null);
  const [selectedAdvance,     setSelectedAdvance]     = useState<CustomerAdvance | null>(null);
  const [showAdvanceHistory,  setShowAdvanceHistory]  = useState(false);
  const [showStatement,       setShowStatement]       = useState(false);

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['customer-sales', customer.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('sales')
        .select('*')
        .eq('store_id', currentStore!.id)
        .eq('customer_id', customer.id)
        .in('status', ['completed', 'partially_refunded'])
        .order('sale_date', { ascending: false })
        .limit(25);
      return data as Sale[];
    },
    enabled: !!currentStore && open,
  });

  const { data: debts = [] } = useQuery({
    queryKey: ['customer-debts', customer.id],
    queryFn: () => fetchCustomerDebtsForProfile(customer.id, currentStore!.id),
    enabled: !!currentStore && open,
  });

  const { data: depositHistory = [] } = useQuery({
    queryKey: ['customer-deposits', customer.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_customer_deposit_history', {
        p_store_id: currentStore!.id, p_customer_id: customer.id, p_limit: 30,
      });
      const result = data as { success: boolean; rows?: CustomerDeposit[] };
      return result?.rows ?? [];
    },
    enabled: !!currentStore && open && showDepositHistory,
  });

  const { data: advanceData } = useQuery({
    queryKey: ['customer-advances', customer.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_customer_advances', {
        p_store_id: currentStore!.id, p_customer_id: customer.id, p_limit: 20,
      });
      const result = data as { success: boolean; advances?: CustomerAdvance[]; total_outstanding?: number };
      return result;
    },
    enabled: !!currentStore && open,
  });

  const advances         = advanceData?.advances ?? [];
  const advanceBalance   = advanceData?.total_outstanding ?? (customer as any).advance_balance ?? 0;
  const depositBalance   = localDepositBal ?? (customer.deposit_balance ?? 0);

  const creditScore = computeCustomerCreditScore(debts, customer.total_purchases ?? 0);

  const currency = currentStore?.currency || 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const shareDebtWhatsApp = () => {
    if (!customer.phone) return;
    const msg = buildWhatsAppDebtReminder({
      partyName: customer.full_name,
      balance: customer.balance,
      storeName: currentStore?.name ?? '',
      currency,
      type: 'reminder',
    });
    openWhatsApp(customer.phone, msg);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col p-0 gap-0 border-l border-slate-200/80 bg-white"
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
            <SheetTitle className="text-base font-semibold text-slate-900">Customer Details</SheetTitle>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-6 space-y-6">
            {/* Profile */}
            <div className="text-center">
              <div
                className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-3xl font-bold text-blue-600 shadow-inner"
              >
                {customer.full_name.charAt(0).toUpperCase()}
              </div>
              <h3 className="mt-4 text-xl font-bold text-slate-900 tracking-tight">{customer.full_name}</h3>
              <p className="text-sm text-slate-500 mt-1">
                {customer.phone || customer.email || 'No contact info'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                <Badge
                  className={cn(
                    'border-0 text-xs font-medium px-3 py-1',
                    customer.is_active
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-slate-100 text-slate-500'
                  )}
                >
                  {customer.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <Badge className="border-0 text-xs font-medium px-3 py-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
                  {PRICE_TIER_LABELS[(customer.price_tier as PriceTier) ?? 'retail']}
                </Badge>
              </div>
            </div>

            {/* Financial summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500">Outstanding Balance</p>
                <p className={cn('text-2xl font-bold mt-1 tracking-tight', customer.balance > 0 ? 'text-red-600' : customer.balance < 0 ? 'text-emerald-600' : 'text-slate-900')}>
                  {fmt(customer.balance)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium text-slate-500">Total Purchases</p>
                <p className="text-2xl font-bold mt-1 tracking-tight text-slate-900">{fmt(customer.total_purchases)}</p>
              </div>
              {customer.credit_limit > 0 && (
                <div className="col-span-2 rounded-2xl border border-slate-100 bg-slate-50/80 p-3 flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-500">Credit Limit</p>
                  <p className="text-sm font-bold text-slate-900">{fmt(customer.credit_limit)}</p>
                </div>
              )}
              <div className="col-span-2 rounded-2xl border border-blue-100 bg-blue-50/50 p-3 flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500">Credit Score</p>
                <span className={cn('text-sm font-bold px-2 py-0.5 rounded-full', CREDIT_TIER_STYLES[creditScore.tier])}>
                  {creditScore.label} ({creditScore.score})
                </span>
              </div>
            </div>

            {/* ── Deposit Wallet ── */}
            <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50/40 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Coins className="h-4 w-4 text-violet-500" />
                    <p className="text-sm font-semibold text-violet-900">Customer Wallet</p>
                  </div>
                  <p className="text-[11px] text-violet-600">Prepaid deposit balance</p>
                </div>
                <p className={cn('text-2xl font-bold tabular-nums', depositBalance > 0 ? 'text-violet-700' : 'text-slate-400')}>
                  {fmt(depositBalance)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-9 gap-1.5 bg-violet-600 hover:bg-violet-700 text-xs"
                  onClick={() => setDepositModal('add')}
                >
                  <Coins className="h-3.5 w-3.5" /> Add Deposit
                </Button>
                {depositBalance > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-9 gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 text-xs"
                    onClick={() => setDepositModal('refund')}
                  >
                    <ArrowDownLeft className="h-3.5 w-3.5" /> Refund
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 text-violet-500 hover:text-violet-700 hover:bg-violet-50"
                  title="View deposit history"
                  onClick={() => setShowDepositHistory((v) => !v)}
                >
                  <History className="h-4 w-4" />
                </Button>
              </div>

              {/* Deposit history (toggle) */}
              {showDepositHistory && (
                <div className="mt-3 border-t border-violet-200/70 pt-3 space-y-1.5">
                  {depositHistory.length === 0 ? (
                    <p className="text-xs text-violet-500 text-center py-2">No deposit history</p>
                  ) : depositHistory.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-xs">
                      <div>
                        <span className={cn(
                          'inline-block rounded px-1.5 py-0.5 font-semibold mr-1.5 text-[10px]',
                          d.type === 'deposit' ? 'bg-violet-100 text-violet-700'
                            : d.type === 'used' ? 'bg-blue-100 text-blue-700'
                              : 'bg-rose-100 text-rose-700',
                        )}>
                          {d.type === 'deposit' ? 'Deposit' : d.type === 'used' ? 'Used' : 'Refund'}
                        </span>
                        <span className="text-slate-500">{format(new Date(d.created_at), 'MMM d, yyyy')}</span>
                      </div>
                      <span className={cn('tabular-nums font-semibold', d.amount > 0 ? 'text-violet-700' : 'text-slate-600')}>
                        {d.amount > 0 ? '+' : ''}{fmt(d.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Cash Advances ── */}
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/40 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Banknote className="h-4 w-4 text-amber-500" />
                    <p className="text-sm font-semibold text-amber-900">Cash Advances</p>
                  </div>
                  <p className="text-[11px] text-amber-600">Money lent to customer</p>
                </div>
                <p className={cn('text-2xl font-bold tabular-nums', advanceBalance > 0 ? 'text-amber-700' : 'text-slate-400')}>
                  {fmt(advanceBalance)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-9 gap-1.5 bg-amber-600 hover:bg-amber-700 text-xs"
                  onClick={() => { setSelectedAdvance(null); setAdvanceModal('advance'); }}
                >
                  <Banknote className="h-3.5 w-3.5" /> Give Advance
                </Button>
                {advanceBalance > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-9 gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50 text-xs"
                    onClick={() => {
                      const oldest = advances.find((a) => a.status !== 'settled');
                      setSelectedAdvance(oldest ?? null);
                      setAdvanceModal('repay');
                    }}
                  >
                    <ArrowDownLeft className="h-3.5 w-3.5" /> Repay
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0 text-amber-500 hover:text-amber-700 hover:bg-amber-50"
                  title="View advance history"
                  onClick={() => setShowAdvanceHistory((v) => !v)}
                >
                  <History className="h-4 w-4" />
                </Button>
              </div>

              {/* Advance history (toggle) */}
              {showAdvanceHistory && (
                <div className="mt-3 border-t border-amber-200/70 pt-3 space-y-1.5">
                  {advances.length === 0 ? (
                    <p className="text-xs text-amber-500 text-center py-2">No advance history</p>
                  ) : advances.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-xs">
                      <div>
                        <span className={cn(
                          'inline-block rounded px-1.5 py-0.5 font-semibold mr-1.5 text-[10px]',
                          a.status === 'outstanding' ? 'bg-amber-100 text-amber-700'
                            : a.status === 'partial' ? 'bg-orange-100 text-orange-700'
                              : 'bg-emerald-100 text-emerald-700',
                        )}>
                          {a.status === 'outstanding' ? 'Outstanding' : a.status === 'partial' ? 'Partial' : 'Settled'}
                        </span>
                        <span className="text-slate-500">{format(new Date(a.created_at), 'MMM d, yyyy')}</span>
                      </div>
                      <div className="text-right">
                        <span className="tabular-nums font-semibold text-amber-700">{fmt(a.original_amount)}</span>
                        {a.outstanding_balance < a.original_amount && (
                          <span className="ml-1 text-slate-400 text-[10px]">({fmt(a.outstanding_balance)} left)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {customer.balance > 0 && (
              <Link href="/dashboard/debts" className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors">
                <AlertCircle className="h-4 w-4" />
                View debt records & payments →
              </Link>
            )}

            {/* Statement link */}
            <button
              type="button"
              onClick={() => setShowStatement(true)}
              className="w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            >
              <FileText className="h-4 w-4 text-slate-400" />
              View Full Customer Statement →
            </button>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {customer.balance > 0 && (
                <Button
                  className="w-full h-11 rounded-xl gap-2 font-medium bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => { setPaymentSale(null); setShowPayment(true); }}
                >
                  <Banknote className="h-4 w-4" />
                  Receive Payment ({fmt(customer.balance)})
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-1 h-11 rounded-xl border-slate-200 gap-2 font-medium"
                onClick={onEdit}
              >
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              {customer.phone && (
                <>
                  <Button
                    variant="outline"
                    className="flex-1 h-11 rounded-xl gap-2 font-medium text-emerald-700 border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 hover:text-emerald-800"
                    onClick={shareDebtWhatsApp}
                  >
                    <MessageSquare className="h-4 w-4" />
                    WhatsApp
                  </Button>
                  <button
                    type="button"
                    onClick={() => { window.location.href = `tel:${customer.phone}`; }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                    aria-label="Call customer"
                  >
                    <Phone className="h-4 w-4 text-slate-600" />
                  </button>
                </>
              )}
            </div>

            {/* Purchase history */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-3">Purchase History</h4>
              {salesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                  ))}
                </div>
              ) : sales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                  <Receipt className="h-8 w-8 text-slate-300 mb-2" />
                  <p className="text-sm text-slate-500">No purchases yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sales.map((sale) => {
                    const credit = saleCredit(sale);
                    return (
                      <div
                        key={sale.id}
                        className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3.5 shadow-sm hover:border-slate-200 transition-colors"
                      >
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() => {
                            window.location.href = `/dashboard/sales-history?sale=${sale.id}`;
                          }}
                        >
                          <p className="text-sm font-semibold text-slate-900">{sale.invoice_number}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {format(new Date(sale.sale_date), 'MMM d, yyyy')}
                          </p>
                        </button>
                        <div className="text-right shrink-0 pl-3 flex flex-col items-end gap-1">
                          <p className="text-sm font-bold text-slate-900">{fmt(sale.total_amount)}</p>
                          {credit > 0 && (
                            <>
                              <p className="text-xs font-medium text-red-500">
                                Due: {fmt(credit)}
                              </p>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] px-2 border-emerald-200 text-emerald-700"
                                onClick={() => {
                                  setPaymentSale(sale);
                                  setShowPayment(true);
                                }}
                              >
                                Pay
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {customer.notes && (
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-slate-600 leading-relaxed">{customer.notes}</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <ReceivePaymentModal
          open={showPayment}
          sale={paymentSale}
          customer={paymentSale ? undefined : customer}
          onClose={() => { setShowPayment(false); setPaymentSale(null); }}
        />

        {depositModal && (
          <CustomerDepositModal
            open={true}
            customer={{ ...customer, deposit_balance: depositBalance }}
            mode={depositModal}
            onClose={() => setDepositModal(null)}
            onSuccess={(newBal) => {
              setLocalDepositBal(newBal);
              setShowDepositHistory(true);
            }}
          />
        )}

        {advanceModal && (
          <CustomerAdvanceModal
            open={true}
            customer={customer}
            mode={advanceModal}
            advance={selectedAdvance}
            onClose={() => { setAdvanceModal(null); setSelectedAdvance(null); }}
            onSuccess={() => setShowAdvanceHistory(true)}
          />
        )}

        <CustomerStatementSheet
          open={showStatement}
          customer={customer}
          onClose={() => setShowStatement(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
