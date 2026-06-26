'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { usePosStore } from '@/lib/stores/pos';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Loader2, CheckCircle2, Check, CircleSlash, CreditCard, Search,
  UserPlus, Landmark, Wallet, Smartphone, Calendar, Receipt, Printer,
  Layers, Plus, X, Coins, ChevronDown,
} from 'lucide-react';
import type { PaymentDetail, PaymentMethod, Product } from '@/types';
import { cn } from '@/lib/utils';
import { useStorePaymentMethods, methodsToPaymentOptions, FALLBACK_PAYMENT_OPTIONS, type DynamicPaymentOption } from '@/lib/hooks/useStorePaymentMethods';
import { findBelowCostItems, getPosAllowBelowCost } from '@/lib/pos/pricing';
import { toSaleRpcItem } from '@/lib/pos/units';
import { validateCartStock } from '@/lib/pos/stock';
import { InvoiceDocument } from '@/components/invoice/InvoiceDocument';
import type { InvoiceData } from '@/lib/invoice-utils';
import { printThermalHtml } from '@/lib/invoice-utils';
import { CustomerSearch } from './CustomerSearch';
import { CustomerFormModal } from '@/components/customers/CustomerFormModal';
import { useTranslation } from '@/lib/i18n/useTranslation';

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMode = 'full' | 'partial' | 'credit' | 'split';

interface SplitLine {
  id: string;
  method: PaymentMethod;
  amount: string;
}

const DEPOSIT_OPTION: DynamicPaymentOption = {
  method: 'customer_deposit',
  label: 'Customer Deposit',
  icon: Coins,
  group: 'deposit',
};

const MODE_TABS: { id: PaymentMode; labelKey: string; icon: typeof Check }[] = [
  { id: 'full',    labelKey: 'pos.full',    icon: Check       },
  { id: 'partial', labelKey: 'pos.partial', icon: CircleSlash },
  { id: 'credit',  labelKey: 'pos.credit',  icon: CreditCard  },
  { id: 'split',   labelKey: 'pos.split',   icon: Layers      },
];

function newSplitLine(): SplitLine {
  return { id: crypto.randomUUID(), method: 'cash', amount: '' };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
}

export function CheckoutModal({ open, onClose, products }: CheckoutModalProps) {
  const { t } = useTranslation();
  const { currentStore, user } = useAuthStore();
  const { items, customer, setCustomer, discount_amount, discount_type, notes, setNotes, clearCart } =
    usePosStore();
  const queryClient = useQueryClient();

  // ── Dynamic payment methods from store settings ────────────────────────────
  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const paymentOptions = storePaymentMethods.length > 0
    ? methodsToPaymentOptions(storePaymentMethods)
    : FALLBACK_PAYMENT_OPTIONS;

  // ── State ──────────────────────────────────────────────────────────────────
  const [paymentMode,         setPaymentMode]         = useState<PaymentMode>('full');
  const [selectedMethod,      setSelectedMethod]      = useState<PaymentMethod>('cash');
  const [amountPaid,          setAmountPaid]          = useState('');
  const [dueDate,             setDueDate]             = useState('');
  const [checkoutNotes,       setCheckoutNotes]       = useState('');
  const [splitLines,          setSplitLines]          = useState<SplitLine[]>(() => [newSplitLine(), newSplitLine()]);
  const [useDeposit,          setUseDeposit]          = useState(false);
  const [depositInput,        setDepositInput]        = useState('');
  const [step,                setStep]                = useState<'payment' | 'success'>('payment');
  const [invoiceData,         setInvoiceData]         = useState<InvoiceData | null>(null);
  const [showCustomerSearch,  setShowCustomerSearch]  = useState(false);
  const [showQuickAdd,        setShowQuickAdd]        = useState(false);
  const [methodMenuId,        setMethodMenuId]        = useState<string | null>(null);

  const currency     = currentStore?.currency || 'USD';
  const depositBal   = customer?.deposit_balance ?? 0;
  const hasDeposit   = depositBal > 0;

  // ── Totals ─────────────────────────────────────────────────────────────────
  const subtotal     = items.reduce((s, i) => s + i.unit_price * i.quantity - i.discount_amount, 0);
  const taxAmount    = items.reduce((s, i) => s + (i.unit_price * i.quantity - i.discount_amount) * (i.tax_rate / 100), 0);
  const discountAmt  = discount_type === 'percentage' ? subtotal * (discount_amount / 100) : discount_amount;
  const total        = subtotal - discountAmt + taxAmount;

  const depositAmt   = useDeposit ? Math.min(Math.max(parseFloat(depositInput) || 0, 0), depositBal) : 0;
  const afterDeposit = Math.max(0, total - depositAmt);

  const paid         = parseFloat(amountPaid) || 0;
  const splitTotal   = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const remaining    = Math.max(0, afterDeposit - paid);
  const change       = paid - afterDeposit;

  const splitAllocated  = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const splitRemaining  = afterDeposit - splitAllocated;

  // ── Derived payment params ─────────────────────────────────────────────────
  const isSplit      = paymentMode === 'split';
  const isCredit     = paymentMode === 'credit';
  const isPartial    = paymentMode === 'partial';
  const isFull       = paymentMode === 'full';

  let paidAmount   = 0;
  let creditAmount = 0;
  let finalMethod: PaymentMethod = selectedMethod;
  let finalDetails: PaymentDetail[] = [];

  if (isSplit) {
    paidAmount   = splitTotal;
    creditAmount = Math.max(0, total - depositAmt - splitTotal);
    finalMethod  = 'split';
    finalDetails = [
      ...splitLines
        .filter((l) => (parseFloat(l.amount) || 0) > 0)
        .map((l) => ({ method: l.method, amount: parseFloat(l.amount) || 0 })),
      ...(depositAmt > 0 ? [{ method: 'customer_deposit' as PaymentMethod, amount: depositAmt }] : []),
    ];
  } else if (isCredit) {
    paidAmount   = 0;
    creditAmount = total;
    finalMethod  = 'credit';
    finalDetails = [];
  } else if (isPartial) {
    paidAmount   = Math.min(paid, afterDeposit);
    creditAmount = Math.max(0, afterDeposit - paid);
    finalMethod  = selectedMethod;
    finalDetails = [{ method: selectedMethod, amount: paidAmount }];
  } else {
    // full
    paidAmount   = afterDeposit;
    creditAmount = 0;
    finalMethod  = depositAmt >= total ? 'customer_deposit' : selectedMethod;
    finalDetails = afterDeposit > 0 ? [{ method: selectedMethod, amount: afterDeposit }] : [];
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  const needsCustomer = isPartial || isCredit || useDeposit;

  const canSubmit = (() => {
    if (!items.length)                  return false;
    if (needsCustomer && !customer)     return false;
    if (useDeposit && depositAmt <= 0)  return false;
    if (isCredit)                       return true;
    if (isFull)                         return afterDeposit >= 0;
    if (isPartial)                      return paid > 0 && paid < afterDeposit;
    // split: all lines have valid amounts and total ≈ afterDeposit (allow small rounding)
    if (isSplit)                        return splitLines.every((l) => parseFloat(l.amount) || 0 > 0) && Math.abs(splitRemaining) < 0.01;
    return true;
  })();

  const fmt  = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const fmtC = (n: number) => `${currency} ${fmt(n)}`;

  // ── Reset on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setPaymentMode('full');
    setSelectedMethod('cash');
    setAmountPaid(total.toFixed(2));
    setDueDate('');
    setCheckoutNotes(notes || '');
    setSplitLines([newSplitLine(), newSplitLine()]);
    setUseDeposit(false);
    setDepositInput('');
    setStep('payment');
    setInvoiceData(null);
    setMethodMenuId(null);
  }, [open]);

  useEffect(() => {
    if (isFull)    setAmountPaid(afterDeposit.toFixed(2));
    if (isCredit)  setAmountPaid('');
  }, [paymentMode, afterDeposit]);

  // Auto-fill deposit when toggled on
  useEffect(() => {
    if (useDeposit && customer) {
      const autoAmt = Math.min(depositBal, total);
      setDepositInput(autoAmt.toFixed(2));
    } else {
      setDepositInput('');
    }
  }, [useDeposit, customer]);

  // Auto-fill split remaining into last line
  const autoFillLastSplit = () => {
    if (splitLines.length === 0) return;
    const prev = splitLines.slice(0, -1).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const rem  = afterDeposit - prev;
    if (rem > 0) {
      setSplitLines((ls) =>
        ls.map((l, i) => i === ls.length - 1 ? { ...l, amount: rem.toFixed(2) } : l)
      );
    }
  };

  // ── Mutation ────────────────────────────────────────────────────────────────
  const { mutate: processSale, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error(t('pos.notAuthenticated'));

      const allowBelowCost = getPosAllowBelowCost((currentStore.settings ?? {}) as Record<string, unknown>);
      if (!allowBelowCost) {
        const bad = findBelowCostItems(items);
        if (bad.length > 0) throw new Error(t('pos.belowCostSaleError'));
      }

      const stockErr = validateCartStock(items, products);
      if (stockErr) throw new Error(stockErr);

      if (isSplit && Math.abs(splitRemaining) >= 0.01) {
        throw new Error(t('pos.splitMustEqualTotal'));
      }

      const saleNotes = [checkoutNotes.trim(), dueDate ? `Due: ${dueDate}` : '']
        .filter(Boolean).join(' | ') || null;

      const phone = customer?.phone || customer?.payment_phone;

      if (!navigator.onLine) {
        const offlineSale = {
          id: crypto.randomUUID(),
          store_id: currentStore.id,
          items,
          customer_id: customer?.id,
          cashier_id: user.id,
          payment_method: finalMethod,
          payment_details: finalDetails,
          discount_amount,
          discount_type,
          subtotal,
          tax_amount: taxAmount,
          total_amount: total,
          notes: saleNotes ?? undefined,
          created_at: new Date().toISOString(),
        };
        usePosStore.getState().addToOfflineQueue(offlineSale);
        return { invoice_number: `OFFLINE-${Date.now()}`, total, offline: true };
      }

      const supabase = createClient();
      const saleItems = items.map((item) => toSaleRpcItem(item));

      const detailsWithPhone: PaymentDetail[] = finalDetails.map((d) => ({
        ...d,
        phone: phone || undefined,
      }));

      const { data, error } = await supabase.rpc('complete_pos_sale', {
        p_store_id:        currentStore.id,
        p_cashier_id:      user.id,
        p_customer_id:     customer?.id || null,
        p_items:           saleItems,
        p_subtotal:        subtotal,
        p_discount_amount: discountAmt,
        p_discount_type:   discount_type,
        p_tax_amount:      taxAmount,
        p_total_amount:    total,
        p_paid_amount:     paidAmount,
        p_change_amount:   Math.max(0, change),
        p_credit_amount:   creditAmount,
        p_payment_method:  finalMethod,
        p_payment_details: detailsWithPhone,
        p_notes:           saleNotes,
        p_due_date:        dueDate || null,
        p_deposit_amount:  depositAmt,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; invoice_number?: string; total?: number };
      if (!result.success) throw new Error(result.error || t('pos.saleFailed'));

      return { invoice_number: result.invoice_number!, total: result.total ?? total, offline: false };
    },

    onSuccess: (data) => {
      setNotes(checkoutNotes);
      const inv: InvoiceData = {
        type: 'pos',
        template: 'corporate',
        invoice_number: data.invoice_number,
        store_name:     currentStore?.name || '',
        store_address:  currentStore?.address,
        store_phone:    currentStore?.phone,
        store_email:    currentStore?.email,
        logo_url:       currentStore?.logo_url,
        currency,
        date:           new Date().toISOString(),
        cashier_name:   user?.email?.split('@')[0],
        customer_name:  customer?.full_name,
        customer_id:    customer?.id,
        customer_phone: customer?.phone,
        customer_email: customer?.email ?? undefined,
        items: items.map((i) => ({
          name:           i.product_name,
          sku:            i.product_sku,
          quantity:       i.quantity,
          unit_code:      i.sale_unit_code,
          base_qty:       i.base_qty ?? (i.conversion_factor ? i.quantity * (i.conversion_factor ?? 1) : undefined),
          unit_price:     i.unit_price,
          discount_amount: i.discount_amount,
          tax_amount:     i.tax_amount * i.quantity,
          subtotal:       i.unit_price * i.quantity - i.discount_amount,
        })),
        subtotal,
        discount_amount:  discountAmt,
        tax_amount:       taxAmount,
        total_amount:     total,
        paid_amount:      paidAmount + depositAmt,
        credit_amount:    creditAmount,
        change_amount:    Math.max(0, change),
        balance_due:      creditAmount,
        payment_method:   finalMethod,
        payment_label:    isSplit
          ? t('pos.split')
          : isCredit
            ? t('pos.creditLabel')
            : paymentOptions.find((p) => p.method === selectedMethod)?.label ?? selectedMethod,
        payment_status:   creditAmount > 0 ? (paidAmount > 0 ? 'partial' : 'unpaid') : 'paid',
        status:           'completed',
        notes:            data.offline ? t('pos.savedOffline') : checkoutNotes || undefined,
      };
      setInvoiceData(inv);
      setStep('success');
      queryClient.invalidateQueries({ queryKey: ['dashboard',           currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['sales',               currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['products',            currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['store-transactions',  currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-deposits',   customer?.id] });
      if (data.offline) toast.message(t('pos.saleSavedOffline'));
    },

    onError: (err: Error) => toast.error(err.message || t('pos.failedProcessSale')),
  });

  const handleClose = () => {
    if (step === 'success') { clearCart(); setStep('payment'); setInvoiceData(null); }
    onClose();
  };

  // ── Payment method button ──────────────────────────────────────────────────
  const MethodPicker = ({
    value,
    onChange,
    showDeposit = false,
    menuId,
  }: {
    value: PaymentMethod;
    onChange: (m: PaymentMethod) => void;
    showDeposit?: boolean;
    menuId: string;
  }) => {
    const opts    = [...paymentOptions, ...(showDeposit ? [DEPOSIT_OPTION] : [])];
    const current = opts.find((o) => o.method === value) ?? paymentOptions[0] ?? DEPOSIT_OPTION;
    const Icon    = current.icon;
    const isOpen  = methodMenuId === menuId;

    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setMethodMenuId(isOpen ? null : menuId)}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-300 transition-colors"
        >
          <Icon className="h-4 w-4 text-slate-400 shrink-0" />
          {current.label}
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-auto" />
        </button>
        {isOpen && (
          <div className="absolute z-50 mt-1 w-52 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            {opts.map((opt) => {
              const OIcon = opt.icon;
              return (
                <button
                  key={opt.method}
                  type="button"
                  onClick={() => { onChange(opt.method); setMethodMenuId(null); }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors',
                    opt.method === value
                      ? 'bg-emerald-50 text-emerald-700 font-medium'
                      : 'hover:bg-slate-50 text-slate-700',
                  )}
                >
                  <OIcon className="h-4 w-4 shrink-0" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Close method picker on outside click */}
      {methodMenuId && (
        <div className="fixed inset-0 z-40" onClick={() => setMethodMenuId(null)} />
      )}

      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-md max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 rounded-2xl" showCloseButton={step === 'success'}>

          {step === 'payment' ? (
            <>
              {/* ── Header ── */}
              <div className="px-5 pt-3 pb-4 shrink-0">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
                <h2 className="text-xl font-bold text-slate-900">{t('pos.checkout')}</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {t('pos.invoiceTotal')} <span className="font-semibold text-slate-700">{fmtC(total)}</span>
                </p>

                {/* Mode tabs */}
                <div className="mt-4 flex rounded-xl border border-slate-200 bg-slate-50/80 p-1 gap-1">
                  {MODE_TABS.map((tab) => {
                    const active = paymentMode === tab.id;
                    const Icon   = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPaymentMode(tab.id)}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all',
                          active
                            ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-200/80'
                            : 'text-slate-500 hover:text-slate-700',
                        )}
                      >
                        {active ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Icon className="h-3.5 w-3.5 opacity-60" />}
                        {t(tab.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Scrollable body ── */}
              <div className="flex-1 overflow-y-auto px-5 space-y-4 pb-4">

                {/* Customer (required for partial / credit / deposit) */}
                {needsCustomer && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-slate-900">
                      {t('pos.customer')} <span className="text-red-500">*</span>
                    </Label>
                    {customer ? (
                      <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{customer.full_name}</p>
                          {customer.phone && <p className="text-xs text-slate-500">{customer.phone}</p>}
                          {(customer.deposit_balance ?? 0) > 0 && (
                            <p className="text-xs text-violet-600 font-medium mt-0.5">
                              {t('pos.depositBalance')}: {fmtC(customer.deposit_balance ?? 0)}
                            </p>
                          )}
                        </div>
                        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowCustomerSearch(true)}>
                          {t('pos.change')}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" className="flex-1 gap-2 h-11 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setShowCustomerSearch(true)}>
                          <Search className="h-4 w-4" />{t('pos.select')}
                        </Button>
                        <Button type="button" className="flex-1 gap-2 h-11 bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowQuickAdd(true)}>
                          <UserPlus className="h-4 w-4" />{t('pos.quickAdd')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Customer Deposit toggle (when customer has balance) */}
                {customer && hasDeposit && !isCredit && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-violet-800">{t('pos.useDeposit')}</p>
                        <p className="text-xs text-violet-600">{t('pos.available')}: {fmtC(depositBal)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUseDeposit((v) => !v)}
                        className={cn(
                          'relative h-6 w-11 rounded-full transition-colors shrink-0',
                          useDeposit ? 'bg-violet-600' : 'bg-slate-300',
                        )}
                      >
                        <span className={cn(
                          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                          useDeposit ? 'translate-x-5' : 'translate-x-0.5',
                        )} />
                      </button>
                    </div>
                    {useDeposit && (
                      <div className="mt-3 flex items-center gap-2">
                        <Coins className="h-4 w-4 text-violet-500 shrink-0" />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max={depositBal}
                          value={depositInput}
                          onChange={(e) => setDepositInput(e.target.value)}
                          className="h-9 bg-white rounded-lg text-sm"
                          placeholder={t('pos.depositAmount')}
                        />
                        <span className="text-xs text-violet-600 shrink-0 tabular-nums">/ {fmtC(depositBal)}</span>
                      </div>
                    )}
                    {useDeposit && depositAmt > 0 && (
                      <p className="mt-2 text-xs text-violet-700 font-medium">
                        {t('pos.afterDeposit')}: <strong>{fmtC(afterDeposit)}</strong>
                      </p>
                    )}
                  </div>
                )}

                {/* Notes */}
                <Textarea
                  placeholder={t('pos.notesOptional')}
                  value={checkoutNotes}
                  onChange={(e) => setCheckoutNotes(e.target.value)}
                  className="min-h-[60px] bg-slate-50/80 border-slate-200 resize-none rounded-xl"
                />

                {/* ── FULL mode: payment method selector ── */}
                {isFull && afterDeposit > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-900">{t('pos.paymentAccount')}</Label>
                    <PaymentMethodGrid
                      selected={selectedMethod}
                      onSelect={setSelectedMethod}
                      options={paymentOptions}
                    />
                  </div>
                )}

                {/* ── PARTIAL mode ── */}
                {isPartial && (
                  <div className="space-y-3">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      placeholder={t('pos.amountReceivedNow')}
                      className="h-12 text-base bg-slate-50/80 rounded-xl"
                    />
                    {paid > 0 && paid < afterDeposit && (
                      <p className="text-sm text-slate-600">
                        {t('pos.remaining')} <strong>{fmtC(remaining)}</strong>
                        <span className="text-orange-600"> {t('pos.toCustomerDebt')}</span>
                      </p>
                    )}
                    <Label className="text-sm font-semibold text-slate-900">{t('pos.receivePaymentInto')}</Label>
                    <PaymentMethodGrid selected={selectedMethod} onSelect={setSelectedMethod} options={paymentOptions} />
                  </div>
                )}

                {/* ── CREDIT mode ── */}
                {isCredit && (
                  <>
                    {!customer && (
                      <div className="space-y-1.5">
                        <Label className="text-sm font-semibold text-slate-900">
                          {t('pos.customer')} <span className="text-red-500">*</span>
                        </Label>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" className="flex-1 gap-2 h-11 border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setShowCustomerSearch(true)}>
                            <Search className="h-4 w-4" />{t('pos.select')}
                          </Button>
                          <Button type="button" className="flex-1 gap-2 h-11 bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowQuickAdd(true)}>
                            <UserPlus className="h-4 w-4" />{t('pos.quickAdd')}
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-3 rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-800">
                      <CreditCard className="h-5 w-5 shrink-0 text-rose-500" />
                      <span>{t('pos.creditAlert', { amount: fmtC(total) })}</span>
                    </div>
                  </>
                )}

                {/* ── SPLIT mode ── */}
                {isSplit && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-slate-900">{t('pos.splitPayment')}</Label>
                      <div className="text-xs tabular-nums">
                        <span className={cn(
                          'font-semibold',
                          Math.abs(splitRemaining) < 0.01 ? 'text-emerald-600' : splitRemaining < 0 ? 'text-red-600' : 'text-slate-500',
                        )}>
                          {Math.abs(splitRemaining) < 0.01
                            ? '✓ ' + t('pos.splitBalanced')
                            : splitRemaining > 0
                              ? t('pos.splitShort', { amount: fmtC(splitRemaining) })
                              : t('pos.splitOver',  { amount: fmtC(-splitRemaining) })
                          }
                        </span>
                        {' / '}<strong>{fmtC(afterDeposit)}</strong>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {splitLines.map((line, idx) => (
                        <div key={line.id} className="flex items-center gap-2">
                          <MethodPicker
                            value={line.method}
                            onChange={(m) => setSplitLines((ls) => ls.map((l) => l.id === line.id ? { ...l, method: m } : l))}
                            menuId={line.id}
                          />
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.amount}
                            onChange={(e) => setSplitLines((ls) => ls.map((l) => l.id === line.id ? { ...l, amount: e.target.value } : l))}
                            onFocus={() => {
                              if (!line.amount && idx === splitLines.length - 1) autoFillLastSplit();
                            }}
                            placeholder="0.00"
                            className="h-9 flex-1 text-right tabular-nums rounded-lg text-sm"
                          />
                          {splitLines.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setSplitLines((ls) => ls.filter((l) => l.id !== line.id))}
                              className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 border-dashed text-slate-500 hover:text-slate-700"
                      onClick={() => setSplitLines((ls) => [...ls, newSplitLine()])}
                    >
                      <Plus className="h-3.5 w-3.5" />{t('pos.addPaymentLine')}
                    </Button>

                    {/* Split summary */}
                    {splitLines.some((l) => parseFloat(l.amount) > 0) && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-1">
                        {splitLines.filter((l) => parseFloat(l.amount) > 0).map((l) => {
                          const opt = paymentOptions.find((o) => o.method === l.method);
                          return (
                            <div key={l.id} className="flex justify-between text-xs text-slate-600">
                              <span>{opt?.label ?? l.method}</span>
                              <span className="tabular-nums font-medium">{fmtC(parseFloat(l.amount) || 0)}</span>
                            </div>
                          );
                        })}
                        {depositAmt > 0 && (
                          <div className="flex justify-between text-xs text-violet-600">
                            <span>{t('pos.depositApplied')}</span>
                            <span className="tabular-nums font-medium">{fmtC(depositAmt)}</span>
                          </div>
                        )}
                        <div className="border-t border-slate-200 pt-1 flex justify-between text-sm font-semibold text-slate-800">
                          <span>{t('common.total')}</span>
                          <span className="tabular-nums">{fmtC(splitAllocated + depositAmt)}</span>
                        </div>
                      </div>
                    )}

                    {/* Credit for split if short */}
                    {splitRemaining > 0.01 && customer && (
                      <p className="text-xs text-orange-600">
                        {t('pos.splitCreditRemainder', { amount: fmtC(splitRemaining) })}
                      </p>
                    )}
                  </div>
                )}

                {/* Due date (partial / credit) */}
                {(isPartial || isCredit) && (
                  <button
                    type="button"
                    className="w-full flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-left hover:bg-slate-50 transition-colors"
                    onClick={() => { const el = document.getElementById('checkout-due-date'); if (el) el.focus(); }}
                  >
                    <Calendar className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{t('pos.dueDateOptional')}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t('pos.dueDateHint')}</p>
                      <Input
                        id="checkout-due-date"
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="mt-2 h-9 bg-white"
                      />
                    </div>
                  </button>
                )}

                {/* Summary row */}
                {useDeposit && depositAmt > 0 && (
                  <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 flex justify-between text-xs text-violet-700">
                    <span>{t('pos.depositApplied')}</span>
                    <span className="font-semibold tabular-nums">- {fmtC(depositAmt)}</span>
                  </div>
                )}
              </div>

              {/* ── Footer ── */}
              <div className="shrink-0 flex gap-3 px-5 py-4 border-t border-slate-100 bg-white">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 rounded-xl border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={handleClose}
                >
                  {t('pos.cancel')}
                </Button>
                <Button
                  type="button"
                  className="flex-[1.4] h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 gap-2 font-semibold"
                  disabled={isPending || !canSubmit}
                  onClick={() => processSale()}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {isPending
                    ? t('pos.processing')
                    : isSplit
                      ? t('pos.completeSplitSale')
                      : isCredit
                        ? t('pos.completeOnCredit')
                        : isPartial
                          ? t('pos.completePartialSale')
                          : t('pos.completeSale')}
                </Button>
              </div>
            </>
          ) : (
            /* ── Success screen ── */
            <div className="p-5 space-y-4 overflow-y-auto max-h-[92vh]">
              <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 px-5 py-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <p className="font-bold text-emerald-900 text-base">{t('pos.saleComplete')}</p>
                  {invoiceData && (
                    <p className="text-sm text-emerald-700">{t('pos.invoiceNum', { num: invoiceData.invoice_number })}</p>
                  )}
                </div>
                {invoiceData && (
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => printThermalHtml(invoiceData)}>
                      <Receipt className="h-3.5 w-3.5" /> {t('pos.receipt')}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={async () => { const { printInvoiceHtml } = await import('@/lib/invoice-utils'); if (invoiceData) await printInvoiceHtml(invoiceData); }}>
                      <Printer className="h-3.5 w-3.5" /> {t('pos.invoice')}
                    </Button>
                  </div>
                )}
              </div>

              {invoiceData && <InvoiceDocument data={invoiceData} id="pos-invoice" showControls />}
              <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 gap-2 font-bold" onClick={handleClose}>
                <CheckCircle2 className="h-4 w-4" /> {t('pos.newSale')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CustomerSearch
        open={showCustomerSearch}
        onClose={() => setShowCustomerSearch(false)}
        onSelect={(c) => { setCustomer(c); setShowCustomerSearch(false); }}
      />
      <CustomerFormModal
        open={showQuickAdd}
        customer={null}
        onClose={() => setShowQuickAdd(false)}
        onCreated={(c) => { setCustomer(c); setShowQuickAdd(false); }}
      />
    </>
  );
}

// ─── Payment method grid (full/partial modes) ─────────────────────────────────
function PaymentMethodGrid({
  selected,
  onSelect,
  options,
}: {
  selected: PaymentMethod;
  onSelect: (m: PaymentMethod) => void;
  options: DynamicPaymentOption[];
}) {
  const groups = [
    { key: 'cash',   label: 'Cash & Bank',  methods: options.filter((o) => o.group === 'cash') },
    { key: 'mobile', label: 'Mobile Money', methods: options.filter((o) => o.group === 'mobile') },
    { key: 'other',  label: 'Other',        methods: options.filter((o) => o.group !== 'cash' && o.group !== 'mobile') },
  ].filter((g) => g.methods.length > 0);

  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{g.label}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {g.methods.map((opt) => {
              const Icon    = opt.icon;
              const isSelected = selected === opt.method;
              return (
                <button
                  key={opt.method}
                  type="button"
                  onClick={() => onSelect(opt.method)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-all text-sm',
                    isSelected
                      ? 'border-emerald-300 bg-emerald-50/60 text-emerald-800 font-medium'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                  )}
                >
                  <div className={cn('h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0', isSelected ? 'border-emerald-600' : 'border-slate-300')}>
                    {isSelected && <div className="h-2 w-2 rounded-full bg-emerald-600" />}
                  </div>
                  <Icon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
