'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, User, Plus } from 'lucide-react';
import type { Customer } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface CustomerSearchProps {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: Customer) => void;
}

export function CustomerSearch({ open, onClose, onSelect }: CustomerSearchProps) {
  const [search, setSearch] = useState('');
  const { currentStore } = useAuthStore();
  const { t } = useTranslation();

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-search', currentStore?.id, search],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from('customers')
        .select('*')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .order('full_name')
        .limit(20);

      if (search) {
        query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
      }

      const { data } = await query;
      return data as Customer[];
    },
    enabled: !!currentStore && open,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-blue-600" />
            {t('pos.selectCustomer')}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder={t('pos.searchByNameOrPhone')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-1">
            {customers.map((customer) => (
              <button
                key={customer.id}
                onClick={() => onSelect(customer)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{customer.full_name}</p>
                  <p className="text-xs text-slate-500">{customer.phone || t('pos.noPhone')}</p>
                </div>
                {customer.balance > 0 && (
                  <span className="text-xs font-medium text-red-600 shrink-0">
                    {t('pos.owes', { amount: customer.balance.toFixed(2) })}
                  </span>
                )}
              </button>
            ))}

            {customers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <User className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">{t('pos.noCustomersFound')}</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex gap-2 border-t border-slate-200 pt-3">
          <Button variant="outline" onClick={onClose} className="flex-1">
            {t('pos.cancel')}
          </Button>
          <Button
            className="flex-1 gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40"
            onClick={() => {
              onClose();
            }}
          >
            <Plus className="h-4 w-4" />
            {t('pos.newCustomer')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
