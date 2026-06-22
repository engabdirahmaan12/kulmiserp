'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import {
  fetchDebtDashboard,
  fetchDebtRecords,
  fetchDebtEvents,
  fetchDebtNotes,
  computeDebtAnalytics,
} from '@/lib/debt/api';
import type { DebtPartyType } from '@/lib/debt/types';

export function useDebtDashboard() {
  const { currentStore } = useAuthStore();
  return useQuery({
    queryKey: ['debt-dashboard', currentStore?.id],
    queryFn: () => fetchDebtDashboard(currentStore!.id),
    enabled: !!currentStore,
    staleTime: 30_000,
  });
}

export function useDebtRecords(partyType: DebtPartyType, filters: { status?: string; search?: string; page?: number }) {
  const { currentStore } = useAuthStore();
  return useQuery({
    queryKey: ['debt-records', currentStore?.id, partyType, filters],
    queryFn: () => fetchDebtRecords(currentStore!.id, partyType, { ...filters, pageSize: 25 }),
    enabled: !!currentStore,
    staleTime: 30_000,
  });
}

export function useDebtEvents(debtRecordId?: string) {
  return useQuery({
    queryKey: ['debt-events', debtRecordId],
    queryFn: () => fetchDebtEvents(debtRecordId!),
    enabled: !!debtRecordId,
  });
}

export function useDebtNotes(opts: { debtRecordId?: string; customerId?: string; supplierId?: string }) {
  return useQuery({
    queryKey: ['debt-notes', opts],
    queryFn: () => fetchDebtNotes(opts),
    enabled: !!(opts.debtRecordId || opts.customerId || opts.supplierId),
  });
}

export function useDebtAnalytics(partyType: DebtPartyType) {
  const { currentStore } = useAuthStore();
  return useQuery({
    queryKey: ['debt-analytics', currentStore?.id, partyType],
    queryFn: () => computeDebtAnalytics(currentStore!.id, partyType),
    enabled: !!currentStore,
  });
}

export function useDebtMutations() {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const supabase = createClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['debt-dashboard', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['debt-records', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['debtors', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['receivables', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['customers', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['suppliers', currentStore?.id] });
    queryClient.invalidateQueries({ queryKey: ['reminders', currentStore?.id] });
  };

  const recordCustomerPayment = useMutation({
    mutationFn: async (p: { customerId: string; amount: number; method: string; notes?: string; debtRecordId?: string }) => {
      const { data, error } = await supabase.rpc('record_debt_payment', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_customer_id: p.customerId,
        p_amount: p.amount,
        p_payment_method: p.method,
        p_notes: p.notes ?? null,
        p_sale_id: null,
        p_debt_record_id: p.debtRecordId ?? null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Payment failed');
    },
    onSuccess: invalidateAll,
  });

  const recordSupplierPayment = useMutation({
    mutationFn: async (p: { supplierId: string; amount: number; method: string; notes?: string; debtRecordId?: string }) => {
      const { data, error } = await supabase.rpc('record_supplier_payment', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_supplier_id: p.supplierId,
        p_amount: p.amount,
        p_payment_method: p.method,
        p_notes: p.notes ?? null,
        p_purchase_order_id: null,
        p_debt_record_id: p.debtRecordId ?? null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Payment failed');
    },
    onSuccess: invalidateAll,
  });

  const setPromiseDate = useMutation({
    mutationFn: async (p: { debtRecordId: string; promiseDate: string }) => {
      const { data, error } = await supabase.rpc('set_debt_promise_date', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_debt_record_id: p.debtRecordId,
        p_promise_date: p.promiseDate,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed');
    },
    onSuccess: invalidateAll,
  });

  const addNote = useMutation({
    mutationFn: async (p: { note: string; debtRecordId?: string; customerId?: string; supplierId?: string }) => {
      const { data, error } = await supabase.rpc('add_debt_note', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_note: p.note,
        p_debt_record_id: p.debtRecordId ?? null,
        p_customer_id: p.customerId ?? null,
        p_supplier_id: p.supplierId ?? null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['debt-notes'] });
      queryClient.invalidateQueries({ queryKey: ['debt-events'] });
    },
  });

  const writeOff = useMutation({
    mutationFn: async (p: { debtRecordId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc('write_off_debt', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_debt_record_id: p.debtRecordId,
        p_reason: p.reason ?? null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Write-off failed');
    },
    onSuccess: invalidateAll,
  });

  const generatePortalToken = useMutation({
    mutationFn: async (p: { partyType: DebtPartyType; customerId?: string; supplierId?: string }) => {
      const { data, error } = await supabase.rpc('generate_debt_portal_token', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_party_type: p.partyType,
        p_customer_id: p.customerId ?? null,
        p_supplier_id: p.supplierId ?? null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; token?: string; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed');
      return result.token!;
    },
  });

  return {
    recordCustomerPayment,
    recordSupplierPayment,
    setPromiseDate,
    addNote,
    writeOff,
    generatePortalToken,
  };
}
