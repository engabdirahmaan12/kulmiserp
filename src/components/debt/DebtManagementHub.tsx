'use client';

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuthStore } from '@/lib/stores/auth';
import {
  useDebtDashboard, useDebtRecords, useDebtEvents, useDebtNotes, useDebtAnalytics, useDebtMutations,
} from '@/lib/hooks/useDebtManagement';
import type { DebtPartyType, DebtRecord } from '@/lib/debt/types';
import {
  DEBT_STATUS_LABELS, DEBT_STATUS_STYLES, fmtDebtCurrency,
  buildWhatsAppDebtReminder, openWhatsApp, computeCustomerCreditScore, computeSupplierScore,
  CREDIT_TIER_STYLES,
} from '@/lib/debt/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  AlertCircle, Users, Truck, Search, MessageSquare, DollarSign,
  Clock, TrendingUp, FileText, Link2, StickyNote, Ban, Calendar,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

type MainTab = 'overview' | 'receivables' | 'payables' | 'aging' | 'analytics';

function AgingBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DebtDetailDialog({
  record, partyType, open, onClose,
}: { record: DebtRecord | null; partyType: DebtPartyType; open: boolean; onClose: () => void }) {
  const { currentStore, storeUser } = useAuthStore();
  const { t } = useTranslation();
  const currency = currentStore?.currency ?? 'USD';
  const { data: events = [] } = useDebtEvents(record?.id);
  const { data: notes = [] } = useDebtNotes({ debtRecordId: record?.id });
  const { recordCustomerPayment, recordSupplierPayment, setPromiseDate, addNote, writeOff, generatePortalToken } = useDebtMutations();

  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNotes, setPayNotes] = useState('');
  const [promiseDate, setPromiseDateLocal] = useState('');
  const [noteText, setNoteText] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [showWriteOff, setShowWriteOff] = useState(false);

  if (!record) return null;

  const partyName = record.customer?.full_name ?? record.supplier?.name ?? '';
  const partyPhone = record.customer?.phone ?? record.supplier?.phone;
  const partyId = record.customer_id ?? record.supplier_id ?? '';

  const handlePay = async () => {
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return toast.error(t('debts.invalidAmount'));
    try {
      if (partyType === 'customer') {
        await recordCustomerPayment.mutateAsync({
          customerId: partyId, amount, method: payMethod, notes: payNotes, debtRecordId: record.id,
        });
      } else {
        await recordSupplierPayment.mutateAsync({
          supplierId: partyId, amount, method: payMethod, notes: payNotes, debtRecordId: record.id,
        });
      }
      toast.success(t('debts.paymentRecorded'));
      setPayAmount('');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Payment failed');
    }
  };

  const shareWhatsApp = (type: 'reminder' | 'statement' | 'payment_request') => {
    const msg = buildWhatsAppDebtReminder({
      partyName, balance: record.remaining_balance, storeName: currentStore?.name ?? '',
      currency, invoiceNumber: record.invoice_number, type,
    });
    if (!openWhatsApp(partyPhone, msg)) toast.error('No phone number on file');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl w-[calc(100%-1.5rem)] max-h-[min(92vh,680px)] flex flex-col overflow-hidden p-0 gap-0 rounded-2xl">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b border-slate-100">
          <DialogTitle className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              <span className="text-base font-bold block truncate">{record.invoice_number}</span>
              <span className="text-xs text-slate-500 truncate block mt-0.5">{partyName}</span>
            </div>
            <Badge className={cn('border-0 text-[10px] shrink-0', DEBT_STATUS_STYLES[record.status])}>
              {DEBT_STATUS_LABELS[record.status]}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-5 py-4 gap-3">
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
            {[
              { label: t('debts.chipRemaining'), value: fmtDebtCurrency(record.remaining_balance, currency), className: 'text-red-600 font-bold' },
              { label: t('debts.chipDueDate'), value: record.due_date ? format(parseISO(record.due_date), 'MMM d, yyyy') : '—' },
              { label: t('debts.chipPromise'), value: record.promise_date ? format(parseISO(record.promise_date), 'MMM d, yyyy') : '—' },
              { label: t('debts.chipOriginal'), value: fmtDebtCurrency(record.total_amount, currency) },
            ].map((chip) => (
              <div key={chip.label} className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{chip.label}</p>
                <p className={cn('text-xs font-medium mt-0.5 truncate', chip.className)}>{chip.value}</p>
              </div>
            ))}
          </div>

          {record.remaining_balance > 0 && (
            <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('debts.recordPayment')}</p>
                <button
                  type="button"
                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 hover:underline shrink-0"
                  onClick={() => setPayAmount(String(record.remaining_balance))}
                >
                  {t('debts.payFull', { amount: fmtDebtCurrency(record.remaining_balance, currency) })}
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex gap-2 flex-1 min-w-0">
                  <Input
                    type="number"
                    placeholder={t('debts.amountPlaceholder')}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="h-10 flex-1 min-w-0"
                    min={0}
                    step="0.01"
                  />
                  <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v)}>
                    <SelectTrigger className="w-[5.5rem] sm:w-24 h-10 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['cash', 'waafi', 'evc', 'sahal', 'zaad'].map((m) => (
                        <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  className="h-10 w-full sm:w-auto sm:min-w-[7.5rem] shrink-0 bg-gradient-to-r from-blue-600 to-indigo-600 gap-1.5 font-semibold"
                  onClick={handlePay}
                  disabled={recordCustomerPayment.isPending || recordSupplierPayment.isPending || !payAmount}
                >
                  {(recordCustomerPayment.isPending || recordSupplierPayment.isPending) ? (
                    t('debts.savingPayment')
                  ) : (
                    <>
                      <DollarSign className="h-4 w-4 shrink-0" />
                      {partyType === 'customer' ? t('debts.recordPay') : t('debts.payNow')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 shrink-0">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 justify-start" onClick={() => shareWhatsApp('reminder')}>
              <MessageSquare className="h-3 w-3 text-green-600 shrink-0" /> {t('debts.whatsappButton')}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 justify-start" onClick={() => shareWhatsApp('statement')}>
              <FileText className="h-3 w-3 shrink-0" /> {t('debts.statementButton')}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 justify-start" onClick={async () => {
              try {
                const token = await generatePortalToken.mutateAsync({
                  partyType,
                  customerId: record.customer_id ?? undefined,
                  supplierId: record.supplier_id ?? undefined,
                });
                const url = `${window.location.origin}/debt/${partyType}/${token}`;
                await navigator.clipboard.writeText(url);
                toast.success(t('debts.portalLinkCopied'));
              } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
            }}>
              <Link2 className="h-3 w-3 shrink-0" /> {t('debts.portalLink')}
            </Button>
            {storeUser?.role === 'owner' && record.remaining_balance > 0 && partyType === 'customer' && (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1 justify-start text-red-600" onClick={() => setShowWriteOff(true)}>
                <Ban className="h-3 w-3 shrink-0" /> {t('debts.writeOff')}
              </Button>
            )}
          </div>

          <div className="flex gap-2 items-end shrink-0">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {t('debts.promiseDateLabel')}
              </Label>
              <Input type="date" value={promiseDate} onChange={(e) => setPromiseDateLocal(e.target.value)} className="h-9" />
            </div>
            <Button size="sm" variant="outline" className="h-9" onClick={async () => {
              if (!promiseDate) return;
              try {
                await setPromiseDate.mutateAsync({ debtRecordId: record.id, promiseDate });
                toast.success(t('debts.promiseDateSaved'));
              } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
            }}>{t('debts.saveButton')}</Button>
          </div>

          {/* Timeline + Notes tabs — only inner panel scrolls if needed */}
          <Tabs defaultValue="timeline" className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <TabsList className="shrink-0 w-full grid grid-cols-2 h-9 bg-slate-100 p-0.5 rounded-lg">
              <TabsTrigger value="timeline" className="text-xs rounded-md gap-1 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Clock className="h-3 w-3" /> {t('debts.tabTimeline')}
              </TabsTrigger>
              <TabsTrigger value="notes" className="text-xs rounded-md gap-1 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <StickyNote className="h-3 w-3" /> {t('debts.tabNotes')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="flex-1 min-h-0 mt-2 overflow-hidden data-[state=inactive]:hidden">
              <div className="h-full min-h-[100px] max-h-[140px] overflow-y-auto overscroll-contain rounded-lg border border-slate-100 bg-slate-50/50 p-2 space-y-1.5">
                {events.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">{t('debts.noEvents')}</p>
                ) : (
                  events.map((ev) => (
                    <div key={ev.id} className="flex gap-2 text-xs border-l-2 border-blue-200 pl-2 py-0.5">
                      <span className="text-slate-400 shrink-0 w-16">{format(parseISO(ev.created_at), 'MMM d')}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{ev.title}</p>
                        {ev.description && <p className="text-slate-500 truncate">{ev.description}</p>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
            <TabsContent value="notes" className="flex-1 min-h-0 mt-2 overflow-hidden flex flex-col gap-2 data-[state=inactive]:hidden">
              <div className="flex-1 min-h-0 max-h-[100px] overflow-y-auto overscroll-contain space-y-1.5">
                {notes.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">{t('debts.noNotes')}</p>
                ) : (
                  notes.map((n) => (
                    <div key={n.id} className="text-xs bg-amber-50 rounded-lg px-2 py-1.5 line-clamp-2">{n.note}</div>
                  ))
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={t('debts.addNotePlaceholder')}
                  className="h-9 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && noteText.trim()) {
                      e.preventDefault();
                      addNote.mutateAsync({ note: noteText, debtRecordId: record.id }).then(() => {
                        setNoteText('');
                        toast.success(t('debts.noteAdded'));
                      }).catch((err) => toast.error(err instanceof Error ? err.message : 'Failed'));
                    }
                  }}
                />
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={async () => {
                  if (!noteText.trim()) return;
                  try {
                    await addNote.mutateAsync({ note: noteText, debtRecordId: record.id });
                    setNoteText('');
                    toast.success(t('debts.noteAdded'));
                  } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
                }}>{t('debts.addNote')}</Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 !mx-0 !mb-0 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
          <Button variant="ghost" className="w-full h-9" onClick={onClose}>{t('debts.closeButton')}</Button>
        </DialogFooter>

        <Dialog open={showWriteOff} onOpenChange={setShowWriteOff}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t('debts.writeOffDebt')}</DialogTitle></DialogHeader>
            <Input value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} placeholder={t('debts.writeOffReason')} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowWriteOff(false)}>{t('debts.cancelButton')}</Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={async () => {
                try {
                  await writeOff.mutateAsync({ debtRecordId: record.id, reason: writeOffReason });
                  toast.success(t('debts.debtWrittenOff'));
                  setShowWriteOff(false);
                  onClose();
                } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
              }}>{t('debts.confirmWriteOff')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function DebtRecordsTable({ partyType }: { partyType: DebtPartyType }) {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const currency = currentStore?.currency ?? 'USD';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState<DebtRecord | null>(null);
  const { data, isLoading } = useDebtRecords(partyType, { search, status });

  const records = data?.records ?? [];

  return (
    <>
      <PageFilterBar>
        <div className="flex gap-2 flex-wrap w-full">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input placeholder={t('debts.searchInvoiceName')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-10 rounded-xl" />
          </div>
          {([
            ['open', t('debts.filterOpen')],
            ['overdue', t('debts.filterOverdue')],
            ['due_soon', t('debts.filterDueSoon')],
            ['paid', t('debts.filterPaid')],
            ['all', t('debts.filterAll')],
          ] as const).map(([s, label]) => (
            <Button key={s} size="sm" variant={status === s ? 'default' : 'outline'}
              className={cn('h-10 rounded-xl', status === s && 'bg-gradient-to-r from-blue-600 to-indigo-600 border-0')}
              onClick={() => setStatus(s)}>
              {label}
            </Button>
          ))}
        </div>
      </PageFilterBar>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('debts.colInvoice')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{partyType === 'customer' ? t('debts.colCustomer') : t('debts.colSupplier')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden md:table-cell">{t('debts.colDue')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('debts.colBalance')}</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('debts.colStatus')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => {
                  const name = r.customer?.full_name ?? r.supplier?.name ?? '—';
                  const credit = r.customer ? computeCustomerCreditScore([r], r.customer.total_purchases ?? 0) : null;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(r)}>
                      <td className="px-4 py-3 font-medium">{r.invoice_number}</td>
                      <td className="px-4 py-3">
                        <div>{name}</div>
                        {credit && partyType === 'customer' && (
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold', CREDIT_TIER_STYLES[credit.tier])}>
                            {credit.label}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 hidden md:table-cell">
                        {r.due_date ? format(parseISO(r.due_date), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600 tabular-nums">
                        {fmtDebtCurrency(r.remaining_balance, currency)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={cn('border-0 text-[10px]', DEBT_STATUS_STYLES[r.status])}>
                          {DEBT_STATUS_LABELS[r.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-600">{t('debts.viewButton')}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {records.length === 0 && (
              <div className="py-16 text-center text-slate-400 text-sm">{t('debts.noRecords')}</div>
            )}
          </div>
        )}
      </DataPanel>

      <DebtDetailDialog record={selected} partyType={partyType} open={!!selected} onClose={() => setSelected(null)} />
    </>
  );
}

export function DebtManagementHub() {
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();
  const currency = currentStore?.currency ?? 'USD';
  const fmt = (n: number) => fmtDebtCurrency(n, currency);
  const [tab, setTab] = useState<MainTab>('overview');

  const { data: dashboard, isLoading } = useDebtDashboard();
  const { data: customerAnalytics } = useDebtAnalytics('customer');
  const { data: supplierAnalytics } = useDebtAnalytics('supplier');

  const ar = dashboard?.customer;
  const ap = dashboard?.supplier;

  return (
    <PageShell>
      <PageHeader
        title={t('debts.title')}
        description={t('debts.description')}
        icon={AlertCircle}
        variant="banner"
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100 p-1 rounded-xl">
          {[
            { id: 'overview', label: t('debts.tabOverview') },
            { id: 'receivables', label: t('debts.tabReceivables'), icon: Users },
            { id: 'payables', label: t('debts.tabPayables'), icon: Truck },
            { id: 'aging', label: t('debts.tabAging') },
            { id: 'analytics', label: t('debts.tabAnalytics'), icon: TrendingUp },
          ].map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="rounded-lg gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
              {Icon && <Icon className="h-3.5 w-3.5" />}{label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {isLoading ? <Skeleton className="h-32 rounded-2xl" /> : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
                  <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2 mb-3">
                    <Users className="h-4 w-4" /> {t('debts.customerDebtsAr')}
                  </h3>
                  <StatStrip className="grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatChip label={t('debts.statTotal')} value={fmt(ar?.total ?? 0)} accent="blue" />
                    <StatChip label={t('debts.statOverdue')} value={fmt(ar?.overdue ?? 0)} accent="red" />
                    <StatChip label={t('debts.statDueToday')} value={fmt(ar?.due_today ?? 0)} accent="orange" />
                    <StatChip label={t('debts.statThisWeek')} value={fmt(ar?.due_this_week ?? 0)} accent="violet" />
                  </StatStrip>
                </div>
                <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
                  <h3 className="text-sm font-semibold text-indigo-800 flex items-center gap-2 mb-3">
                    <Truck className="h-4 w-4" /> {t('debts.supplierDebtsAp')}
                  </h3>
                  <StatStrip className="grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatChip label={t('debts.statTotal')} value={fmt(ap?.total ?? 0)} accent="blue" />
                    <StatChip label={t('debts.statOverdue')} value={fmt(ap?.overdue ?? 0)} accent="red" />
                    <StatChip label={t('debts.statDueToday')} value={fmt(ap?.due_today ?? 0)} accent="orange" />
                    <StatChip label={t('debts.statThisWeek')} value={fmt(ap?.due_this_week ?? 0)} accent="violet" />
                  </StatStrip>
                </div>
              </div>
              <div className="flex gap-2">
                <Button className="bg-gradient-to-r from-blue-600 to-indigo-600" onClick={() => setTab('receivables')}>{t('debts.manageReceivables')}</Button>
                <Button variant="outline" onClick={() => setTab('payables')}>{t('debts.managePayables')}</Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="receivables"><DebtRecordsTable partyType="customer" /></TabsContent>
        <TabsContent value="payables"><DebtRecordsTable partyType="supplier" /></TabsContent>

        <TabsContent value="aging" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(['customer', 'supplier'] as const).map((party) => {
              const summary = party === 'customer' ? ar : ap;
              const aging = summary?.aging;
              const total = (aging?.['0_30'] ?? 0) + (aging?.['31_60'] ?? 0) + (aging?.['61_90'] ?? 0) + (aging?.['90_plus'] ?? 0);
              return (
                <div key={party} className="rounded-2xl border bg-white p-5 shadow-sm">
                  <h3 className="font-semibold mb-4">{party === 'customer' ? t('debts.agingCustomer') : t('debts.agingSupplier')}</h3>
                  <div className="space-y-3">
                    <AgingBar label={t('debts.aging0_30')} amount={aging?.['0_30'] ?? 0} total={total} color="bg-blue-500" />
                    <AgingBar label={t('debts.aging31_60')} amount={aging?.['31_60'] ?? 0} total={total} color="bg-indigo-500" />
                    <AgingBar label={t('debts.aging61_90')} amount={aging?.['61_90'] ?? 0} total={total} color="bg-amber-500" />
                    <AgingBar label={t('debts.aging90plus')} amount={aging?.['90_plus'] ?? 0} total={total} color="bg-red-500" />
                  </div>
                  <p className="text-sm text-slate-500 mt-4">{t('debts.totalOutstanding')}: <span className="font-bold text-slate-900">{fmt(total)}</span></p>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: t('debts.customerCollectionRate'), data: customerAnalytics, perfLabel: t('debts.receivablesPerf') },
              { label: t('debts.supplierPaymentRate'), data: supplierAnalytics, perfLabel: t('debts.payablesPerf') },
            ].map(({ label, data, perfLabel }) => (
              <div key={label} className="rounded-2xl border bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">{label}</h3>
                <p className="text-xs text-slate-500 mb-4">{perfLabel}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-blue-50 p-3">
                    <p className="text-[10px] text-blue-600 uppercase font-semibold">{t('debts.collectionRate')}</p>
                    <p className="text-2xl font-bold text-blue-700">{data?.collectionRate ?? 0}%</p>
                  </div>
                  <div className="rounded-xl bg-indigo-50 p-3">
                    <p className="text-[10px] text-indigo-600 uppercase font-semibold">{t('debts.recoveryRate')}</p>
                    <p className="text-2xl font-bold text-indigo-700">{data?.recoveryRate ?? 0}%</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-3">
                    <p className="text-[10px] text-amber-600 uppercase font-semibold">{t('debts.overdueCount')}</p>
                    <p className="text-2xl font-bold text-amber-700">{data?.overdueTrend ?? 0}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
