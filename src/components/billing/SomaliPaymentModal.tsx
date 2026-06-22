'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, Phone, Clock, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { Store } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface PaymentGateway {
  id: 'waafi' | 'evc' | 'sahal' | 'zaad';
  name: string;
  logo: string;
  color: string;
  description: string;
}

const GATEWAYS: PaymentGateway[] = [
  { id: 'waafi', name: 'WAAFI', logo: '🟦', color: 'border-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30', description: 'Hormuud Telecom — WAAFI Pay' },
  { id: 'evc', name: 'EVC Plus', logo: '🟧', color: 'border-orange-300 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/30', description: 'Hormuud Telecom — EVC Plus' },
  { id: 'sahal', name: 'SAHAL', logo: '🟩', color: 'border-green-300 bg-green-50 hover:bg-green-100 dark:bg-green-950/30', description: 'Golis Telecom — SAHAL' },
  { id: 'zaad', name: 'ZAAD', logo: '🟥', color: 'border-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-950/30', description: 'Telesom — ZAAD Service' },
];

type Step = 'select' | 'enter_phone' | 'waiting' | 'success' | 'failed';

interface Props {
  open: boolean;
  onClose: () => void;
  plan: string;
  amount: number;
  months?: number;
}

const POLL_MS = 3000;
const MAX_POLLS = 200;

export function SomaliPaymentModal({ open, onClose, plan, amount, months = 1 }: Props) {
  const { currentStore, setCurrentStore } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>('select');
  const [gateway, setGateway] = useState<PaymentGateway | null>(null);
  const [phone, setPhone] = useState('');
  const [txRef, setTxRef] = useState('');
  const [failReason, setFailReason] = useState('');
  const [waiting, setWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processStarted = useRef(false);

  const totalAmount = (amount * months).toFixed(2);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const startPolling = (transactionId: string) => {
    let count = 0;
    pollRef.current = setInterval(async () => {
      count++;
      if (count > MAX_POLLS) {
        stopPolling();
        setWaiting(false);
        setFailReason(t('somaliPayment.sessionExpired'));
        setStep('failed');
        return;
      }

      try {
        const res = await fetch(`/api/billing/verify/${transactionId}`);
        const data = await res.json() as {
          status: string;
          reason?: string;
          message?: string;
          merchant_reference?: string;
        };

        if (data.status === 'success') {
          stopPolling();
          setWaiting(false);
          setTxRef(data.merchant_reference ?? txRef);

          try {
            const supabase = createClient();
            const { data: updatedStore } = await supabase
              .from('stores')
              .select('*')
              .eq('id', currentStore!.id)
              .single();
            if (updatedStore) setCurrentStore(updatedStore as Store);
          } catch { /* non-critical */ }

          queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
          queryClient.invalidateQueries({ queryKey: ['billing-payments', currentStore?.id] });
          setStep('success');
          toast.success(t('somaliPayment.toastSuccess'));
        } else if (['failed', 'cancelled', 'expired'].includes(data.status)) {
          stopPolling();
          setWaiting(false);
          setFailReason(data.reason ?? data.message ?? t('somaliPayment.errNotCompleted'));
          setStep('failed');
        }
        // pending / verifying — keep polling
      } catch {
        // transient network error — keep polling
      }
    }, POLL_MS);
  };

  const handlePay = async () => {
    if (!currentStore || !gateway) return;
    setWaiting(true);
    setStep('waiting');
    processStarted.current = false;

    try {
      // Step 1: Create payment request only (no activation)
      const initRes = await fetch('/api/billing/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: currentStore.id,
          plan_id: plan,
          months,
          provider: gateway.id,
          phone,
        }),
      });

      let initData: {
        success?: boolean;
        error?: string;
        transaction_id?: string;
        merchant_reference?: string;
      } = {};

      try {
        initData = await initRes.json();
      } catch {
        setFailReason(`Server error (HTTP ${initRes.status})`);
        setStep('failed');
        setWaiting(false);
        return;
      }

      if (!initRes.ok || !initData.success || !initData.transaction_id) {
        const reason = initData.error ?? t('somaliPayment.errCreate');
        setFailReason(reason);
        setStep('failed');
        setWaiting(false);
        toast.error(reason);
        return;
      }

      const transactionId = initData.transaction_id;
      setTxRef(initData.merchant_reference ?? '');

      // Step 2: Start polling verify (backend activates ONLY on verified payment)
      startPolling(transactionId);

      // Step 3: Trigger WAAFI popup (long-running — customer must enter PIN)
      if (!processStarted.current) {
        processStarted.current = true;
        fetch(`/api/billing/process/${transactionId}`, { method: 'POST' }).catch(() => {
          // verify polling will surface failure
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Network error';
      setFailReason(reason);
      setStep('failed');
      setWaiting(false);
      toast.error(reason);
    }
  };

  const handleClose = () => {
    if (waiting) return;
    stopPolling();
    setStep('select');
    setGateway(null);
    setPhone('');
    setTxRef('');
    setFailReason('');
    processStarted.current = false;
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'success' ? t('somaliPayment.titleSuccess') :
             step === 'failed' ? t('somaliPayment.titleFailed') :
             step === 'waiting' ? t('somaliPayment.titleWaiting') :
             t('somaliPayment.titleSubscribe', { plan: plan.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) })}
          </DialogTitle>
          <DialogDescription>
            {step === 'select' && t('somaliPayment.descSelect')}
            {step === 'enter_phone' && t('somaliPayment.descPhone', { amount: totalAmount, gateway: gateway?.name ?? '' })}
            {step === 'waiting' && t('somaliPayment.descWaiting')}
            {step === 'success' && (txRef ? t('somaliPayment.descSuccessRef', { ref: txRef }) : t('somaliPayment.descSuccessNoRef'))}
            {step === 'failed' && failReason}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground font-medium">
              {t('somaliPayment.amountLine', { price: String(amount), months: String(months), total: totalAmount })}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {GATEWAYS.map((gw) => (
                <button
                  key={gw.id}
                  type="button"
                  onClick={() => { setGateway(gw); setStep('enter_phone'); }}
                  className={cn('flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all', gw.color)}
                >
                  <span className="text-3xl">{gw.logo}</span>
                  <span className="font-bold text-sm">{gw.name}</span>
                  <span className="text-xs text-muted-foreground text-center">{gw.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'enter_phone' && gateway && (
          <div className="space-y-4 pt-2">
            <div className={cn('flex items-center gap-3 p-3 rounded-lg border', gateway.color)}>
              <span className="text-2xl">{gateway.logo}</span>
              <div>
                <p className="font-medium">{gateway.name}</p>
                <p className="text-xs text-muted-foreground">{gateway.description}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t('somaliPayment.labelPhone')}</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="phone" type="tel" className="pl-9" placeholder={t('somaliPayment.phonePlaceholder')} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">{t('somaliPayment.phoneHint')}</p>
            </div>
            <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('somaliPayment.summaryPlan')}</span><span className="font-medium capitalize">{plan.replace('_', ' ')}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('somaliPayment.summaryTotal')}</span><span className="font-bold">${totalAmount}</span></div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('select')}>{t('somaliPayment.btnBack')}</Button>
              <Button className="flex-1" onClick={handlePay} disabled={!phone || phone.replace(/\D/g, '').length < 9}>{t('somaliPayment.btnPay', { total: totalAmount })}</Button>
            </div>
          </div>
        )}

        {step === 'waiting' && (
          <div className="flex flex-col items-center gap-5 py-6 text-center">
            <div className="relative">
              <Clock className="h-16 w-16 text-blue-500 animate-pulse" />
              <Loader2 className="absolute inset-0 m-auto h-8 w-8 animate-spin text-blue-700" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">{t('somaliPayment.waitingTitle')}</p>
              <p className="text-sm text-slate-500">
                {t('somaliPayment.waitingDesc', { gateway: gateway?.name ?? '' })}<br />
                <strong>{t('somaliPayment.waitingNote', { amount: totalAmount })}</strong>
              </p>
            </div>
            {txRef && (
              <p className="text-xs font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-1">{t('somaliPayment.waitingRef', { ref: txRef })}</p>
            )}
            <p className="text-[10px] text-slate-400 italic">
              {t('somaliPayment.waitingDisclaimer')}
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <div>
              <h3 className="font-bold text-lg">{t('somaliPayment.successTitle')}</h3>
              <p className="text-muted-foreground text-sm mt-1">{t('somaliPayment.successDesc')}</p>
            </div>
            {txRef && <div className="bg-muted rounded-lg px-4 py-2 text-xs font-mono text-muted-foreground">{t('somaliPayment.descSuccessRef', { ref: txRef })}</div>}
            <Button className="w-full" onClick={handleClose}>{t('somaliPayment.successBtn')}</Button>
          </div>
        )}

        {step === 'failed' && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <XCircle className="h-16 w-16 text-red-500" />
            <div>
              <h3 className="font-bold text-lg">{t('somaliPayment.failedTitle')}</h3>
              <p className="text-muted-foreground text-sm mt-1">{failReason}</p>
              <p className="text-xs text-slate-400 mt-2">{t('somaliPayment.failedNoCharge')}</p>
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1" onClick={handleClose}>{t('somaliPayment.btnCancel')}</Button>
              <Button className="flex-1" onClick={() => { setStep('select'); setGateway(null); setPhone(''); setFailReason(''); }}>{t('somaliPayment.btnRetry')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
