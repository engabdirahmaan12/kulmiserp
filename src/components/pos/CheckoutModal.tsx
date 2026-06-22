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
import { toast } from 'sonner';
import {
  Loader2,
  CheckCircle2,
  Check,
  CircleSlash,
  CreditCard,
  Search,
  UserPlus,
  Landmark,
  Wallet,
  Smartphone,
  Calendar,
  Receipt,
  Printer,
} from 'lucide-react';
import type { Customer, PaymentDetail, PaymentMethod, Product } from '@/types';
import { cn } from '@/lib/utils';
import { findBelowCostItems, getPosAllowBelowCost } from '@/lib/pos/pricing';
import { toSaleRpcItem } from '@/lib/pos/units';
import { validateCartStock } from '@/lib/pos/stock';
import { InvoiceDocument } from '@/components/invoice/InvoiceDocument';
import type { InvoiceData } from '@/lib/invoice-utils';
import { printThermalHtml } from '@/lib/invoice-utils';
import { CustomerSearch } from './CustomerSearch';
import { CustomerFormModal } from '@/components/customers/CustomerFormModal';
import { useTranslation } from '@/lib/i18n/useTranslation';

type PaymentMode = 'full' | 'partial' | 'credit';
type PaymentAccountId = 'bank' | 'cash' | 'evc' | 'sahal' | 'zaad';

interface PaymentAccountOption {
  id: PaymentAccountId;
  method: PaymentMethod;
  label: string;
  category: string;
  icon: typeof Wallet;
}

const PAYMENT_ACCOUNTS: PaymentAccountOption[] = [
  { id: 'bank', method: 'cash', label: 'Bank', category: 'bank', icon: Landmark },
  { id: 'cash', method: 'cash', label: 'Cash', category: 'cash', icon: Wallet },
  { id: 'evc', method: 'evc', label: 'EVC Plus', category: 'mobile', icon: Smartphone },
  { id: 'sahal', method: 'sahal', label: 'Sahal', category: 'mobile', icon: Smartphone },
  { id: 'zaad', method: 'zaad', label: 'Zaad', category: 'mobile', icon: Smartphone },
];

const MODE_TABS: { id: PaymentMode; label: string; icon: typeof Check }[] = [
  { id: 'full', label: 'Full', icon: Check },
  { id: 'partial', label: 'Partial', icon: CircleSlash },
  { id: 'credit', label: 'Credit', icon: CreditCard },
];

interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
}

export function CheckoutModal({ open, onClose, products }: CheckoutModalProps) {
  const { t } = useTranslation();
  const accountLabel = (id: PaymentAccountId) =>
    ({ bank: t('pos.bank'), cash: t('pos.cash'), evc: t('pos.evcPlus'), sahal: t('pos.sahal'), zaad: t('pos.zaad') }[id]);
  const categoryLabel = (cat: string) =>
    ({ bank: t('pos.catBank'), cash: t('pos.catCash'), mobile: t('pos.catMobile') }[cat] ?? cat);
  const { currentStore, user } = useAuthStore();
  const { items, customer, setCustomer, discount_amount, discount_type, notes, setNotes, clearCart } =
    usePosStore();

  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full');
  const [paymentAccount, setPaymentAccount] = useState<PaymentAccountId>('cash');
  const [checkoutNotes, setCheckoutNotes] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [step, setStep] = useState<'payment' | 'success'>('payment');
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const queryClient = useQueryClient();

  const currency = currentStore?.currency || 'USD';

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity - i.discount_amount, 0);
  const taxAmount = items.reduce((s, i) => {
    const base = i.unit_price * i.quantity - i.discount_amount;
    return s + base * (i.tax_rate / 100);
  }, 0);
  const discountAmt =
    discount_type === 'percentage' ? subtotal * (discount_amount / 100) : discount_amount;
  const total = subtotal - discountAmt + taxAmount;
  const paid = parseFloat(amountPaid) || 0;
  const remaining = Math.max(0, total - paid);
  const change = paid - total;

  const selectedAccount = PAYMENT_ACCOUNTS.find((a) => a.id === paymentAccount)!;
  const paymentMethod: PaymentMethod =
    paymentMode === 'credit' ? 'credit' : selectedAccount.method;

  const creditAmount =
    paymentMode === 'credit' ? total : paymentMode === 'partial' ? remaining : 0;
  const paidAmount =
    paymentMode === 'credit' ? 0 : paymentMode === 'full' ? total : Math.min(paid, total);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const fmtC = (n: number) => `${currency} ${fmt(n)}`;

  useEffect(() => {
    if (!open) return;
    setPaymentMode('full');
    setPaymentAccount('cash');
    setCheckoutNotes(notes || '');
    setDueDate('');
    setAmountPaid(total.toFixed(2));
    setStep('payment');
    setInvoiceData(null);
  }, [open, notes, total]);

  useEffect(() => {
    if (paymentMode === 'full') setAmountPaid(total.toFixed(2));
    if (paymentMode === 'credit') setAmountPaid('');
  }, [paymentMode, total]);

  const { mutate: processSale, isPending } = useMutation({
    mutationFn: async () => {
      if (!currentStore || !user) throw new Error(t('pos.notAuthenticated'));

      const allowBelowCost = getPosAllowBelowCost(
        (currentStore.settings ?? {}) as Record<string, unknown>,
      );
      if (!allowBelowCost) {
        const bad = findBelowCostItems(items);
        if (bad.length > 0) {
          throw new Error(t('pos.belowCostSaleError'));
        }
      }

      const stockErr = validateCartStock(items, products);
      if (stockErr) throw new Error(stockErr);

      const saleNotes = [
        checkoutNotes.trim(),
        dueDate ? `Due: ${dueDate}` : '',
      ]
        .filter(Boolean)
        .join(' | ') || null;

      const phone = customer?.phone || customer?.payment_phone;

      if (!navigator.onLine) {
        const offlineSale = {
          id: crypto.randomUUID(),
          store_id: currentStore.id,
          items,
          customer_id: customer?.id,
          cashier_id: user.id,
          payment_method: paymentMethod,
          payment_details: [
            {
              method: paymentMethod,
              amount: paidAmount,
              phone,
              account: paymentAccount,
              due_date: dueDate || undefined,
            },
          ],
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
      const paymentDetails: PaymentDetail[] = [
        {
          method: paymentMethod,
          amount: paidAmount,
          phone: phone || undefined,
          reference: paymentAccount === 'bank' ? 'bank' : undefined,
          due_date: dueDate || undefined,
        } as PaymentDetail & { due_date?: string },
      ];

      const saleItems = items.map((item) => toSaleRpcItem(item));

      const { data, error } = await supabase.rpc('complete_pos_sale', {
        p_store_id: currentStore.id,
        p_cashier_id: user.id,
        p_customer_id: customer?.id || null,
        p_items: saleItems,
        p_subtotal: subtotal,
        p_discount_amount: discountAmt,
        p_discount_type: discount_type,
        p_tax_amount: taxAmount,
        p_total_amount: total,
        p_paid_amount: paidAmount,
        p_change_amount: Math.max(0, change),
        p_credit_amount: creditAmount,
        p_payment_method: paymentMethod,
        p_payment_details: paymentDetails,
        p_notes: saleNotes,
        p_due_date: dueDate || null,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; invoice_number?: string; total?: number };
      if (!result.success) throw new Error(result.error || t('pos.saleFailed'));

      return {
        invoice_number: result.invoice_number!,
        total: result.total ?? total,
        offline: false,
      };
    },
    onSuccess: (data) => {
      setNotes(checkoutNotes);
      const inv: InvoiceData = {
        type: 'pos',
        template: 'corporate',
        invoice_number: data.invoice_number,
        store_name: currentStore?.name || '',
        store_address: currentStore?.address,
        store_phone: currentStore?.phone,
        store_email: currentStore?.email,
        logo_url: currentStore?.logo_url,
        currency,
        date: new Date().toISOString(),
        cashier_name: user?.email?.split('@')[0] ?? undefined,
        customer_name: customer?.full_name,
        customer_id: customer?.id,
        customer_phone: customer?.phone,
        customer_email: customer?.email ?? undefined,
        items: items.map((i) => ({
          name: i.product_name,
          sku: i.product_sku,
          quantity: i.quantity,
          unit_code: i.sale_unit_code,
          base_qty: i.base_qty ?? (i.conversion_factor ? i.quantity * (i.conversion_factor ?? 1) : undefined),
          unit_price: i.unit_price,
          discount_amount: i.discount_amount,
          tax_amount: i.tax_amount * i.quantity,
          subtotal: i.unit_price * i.quantity - i.discount_amount,
        })),
        subtotal,
        discount_amount: discountAmt,
        tax_amount: taxAmount,
        total_amount: total,
        paid_amount: paidAmount,
        credit_amount: creditAmount,
        change_amount: Math.max(0, change),
        balance_due: creditAmount,
        payment_method: paymentMethod,
        payment_label:
          paymentMode === 'credit'
            ? t('pos.creditLabel')
            : `${accountLabel(selectedAccount.id)}${paymentMode === 'partial' ? t('pos.partialSuffix') : ''}`,
        payment_status: creditAmount > 0 ? (paidAmount > 0 ? 'partial' : 'unpaid') : 'paid',
        status: 'completed',
        notes: data.offline ? t('pos.savedOffline') : checkoutNotes || undefined,
      };
      setInvoiceData(inv);
      setStep('success');
      queryClient.invalidateQueries({ queryKey: ['dashboard', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['sales', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['store-transactions', currentStore?.id] });
      if (data.offline) toast.message(t('pos.saleSavedOffline'));
    },
    onError: (error: Error) => toast.error(error.message || t('pos.failedProcessSale')),
  });

  const handleClose = () => {
    if (step === 'success') {
      clearCart();
      setStep('payment');
      setInvoiceData(null);
    }
    onClose();
  };

  const needsCustomer = paymentMode === 'partial' || paymentMode === 'credit';
  const canSubmit =
    paymentMode === 'full'
      ? true
      : paymentMode === 'credit'
        ? !!customer
        : !!customer && paid > 0 && paid < total;

  const submitLabel =
    paymentMode === 'full'
      ? t('pos.completeSale')
      : paymentMode === 'partial'
        ? t('pos.completePartialSale')
        : t('pos.completeOnCredit');

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent
          className="sm:max-w-md max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 rounded-2xl"
          showCloseButton={step === 'success'}
        >
          {step === 'payment' ? (
            <>
              <div className="px-5 pt-3 pb-4 shrink-0">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
                <h2 className="text-xl font-bold text-slate-900">{t('pos.checkout')}</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {t('pos.invoiceTotal')} <span className="font-semibold text-slate-700">{fmtC(total)}</span>
                </p>

                {/* Full | Partial | Credit */}
                <div className="mt-4 flex rounded-xl border border-slate-200 bg-slate-50/80 p-1 gap-1">
                  {MODE_TABS.map((tab) => {
                    const active = paymentMode === tab.id;
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPaymentMode(tab.id)}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium transition-all',
                          active
                            ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-200/80'
                            : 'text-slate-500 hover:text-slate-700'
                        )}
                      >
                        {active ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Icon className="h-4 w-4 opacity-60" />
                        )}
                        {t(`pos.${tab.id}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 space-y-4 pb-4">
                {/* Customer (partial / credit) */}
                {needsCustomer && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-900">
                      {t('pos.customer')} <span className="text-red-500">*</span>
                    </Label>
                    <p className="text-xs text-slate-500">{t('pos.trackBalanceHint')}</p>
                    {customer ? (
                      <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{customer.full_name}</p>
                          {customer.phone && (
                            <p className="text-xs text-slate-500">{customer.phone}</p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setShowCustomerSearch(true)}
                        >
                          {t('pos.change')}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 gap-2 h-11 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => setShowCustomerSearch(true)}
                        >
                          <Search className="h-4 w-4" />
                          {t('pos.select')}
                        </Button>
                        <Button
                          type="button"
                          className="flex-1 gap-2 h-11 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => setShowQuickAdd(true)}
                        >
                          <UserPlus className="h-4 w-4" />
                          {t('pos.quickAdd')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Notes */}
                <Textarea
                  placeholder={t('pos.notesOptional')}
                  value={checkoutNotes}
                  onChange={(e) => setCheckoutNotes(e.target.value)}
                  className="min-h-[72px] bg-slate-50/80 border-slate-200 resize-none rounded-xl"
                />

                {/* Partial: amount received */}
                {paymentMode === 'partial' && (
                  <div className="space-y-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={t('pos.amountReceivedNow')}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      className="h-12 text-base bg-slate-50/80 rounded-xl"
                    />
                    {paid > 0 && paid < total && (
                      <p className="text-sm text-slate-600">
                        {t('pos.remaining')} <span className="font-semibold">{fmtC(remaining)}</span>
                        <span className="text-orange-600"> {t('pos.toCustomerDebt')}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* Due date (partial / credit) */}
                {(paymentMode === 'partial' || paymentMode === 'credit') && (
                  <button
                    type="button"
                    className="w-full flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-left hover:bg-slate-50 transition-colors"
                    onClick={() => {
                      const el = document.getElementById('checkout-due-date');
                      if (el) el.focus();
                    }}
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

                {/* Credit alert */}
                {paymentMode === 'credit' && (
                  <div className="flex items-center gap-3 rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-800">
                    <CreditCard className="h-5 w-5 shrink-0 text-rose-500" />
                    <span>
                      {t('pos.creditAlert', { amount: fmtC(total) })}
                    </span>
                  </div>
                )}

                {/* Payment account (full / partial) */}
                {paymentMode !== 'credit' && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-900">
                      {paymentMode === 'partial' ? t('pos.receivePaymentInto') : t('pos.paymentAccount')}
                    </Label>
                    <div className="space-y-1.5">
                      {PAYMENT_ACCOUNTS.map((account) => {
                        const Icon = account.icon;
                        const selected = paymentAccount === account.id;
                        return (
                          <button
                            key={account.id}
                            type="button"
                            onClick={() => setPaymentAccount(account.id)}
                            className={cn(
                              'w-full flex items-center gap-3 rounded-xl border px-3 py-3 transition-all text-left',
                              selected
                                ? 'border-emerald-300 bg-emerald-50/40'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            )}
                          >
                            <div
                              className={cn(
                                'h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0',
                                selected ? 'border-emerald-600' : 'border-slate-300'
                              )}
                            >
                              {selected && (
                                <div className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-900">{accountLabel(account.id)}</p>
                              <p className="text-xs text-slate-400">{categoryLabel(account.category)}</p>
                            </div>
                            <Icon className="h-5 w-5 text-slate-400 shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                    {selectedAccount.category === 'mobile' && customer?.phone && (
                      <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                        {t('pos.paymentPhone')} <strong>{customer.phone}</strong>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
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
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {isPending ? t('pos.processing') : submitLabel}
                </Button>
              </div>
            </>
          ) : (
            <div className="p-5 space-y-4 overflow-y-auto max-h-[92vh]">
              {/* Success banner */}
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => printThermalHtml(invoiceData)}
                    >
                      <Receipt className="h-3.5 w-3.5" /> {t('pos.receipt')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      onClick={async () => {
                        const { printInvoiceHtml } = await import('@/lib/invoice-utils');
                        if (invoiceData) await printInvoiceHtml(invoiceData);
                      }}
                    >
                      <Printer className="h-3.5 w-3.5" /> {t('pos.invoice')}
                    </Button>
                  </div>
                )}
              </div>

              {invoiceData && (
                <InvoiceDocument data={invoiceData} id="pos-invoice" showControls />
              )}
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
        onSelect={(c) => {
          setCustomer(c);
          setShowCustomerSearch(false);
        }}
      />

      <CustomerFormModal
        open={showQuickAdd}
        customer={null}
        onClose={() => setShowQuickAdd(false)}
        onCreated={(c) => {
          setCustomer(c);
          setShowQuickAdd(false);
        }}
      />
    </>
  );
}
