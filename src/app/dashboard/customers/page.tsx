'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CustomerFormModal } from '@/components/customers/CustomerFormModal';
import { CustomerDetailSheet } from '@/components/customers/CustomerDetailSheet';
import {
  Users, Plus, Search, MessageSquare, Phone, MoreHorizontal, TrendingDown
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Customer } from '@/types';
import { PRICE_TIER_LABELS } from '@/lib/units/conversion';
import type { PriceTier } from '@/lib/units/conversion';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { btnPrimary, inputSoft, tableHead } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

async function fetchCustomers(storeId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('store_id', storeId)
    .order('full_name');
  if (error) throw error;
  return data as Customer[];
}

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [filterDebt, setFilterDebt] = useState(false);
  const { currentStore } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', currentStore?.id],
    queryFn: () => fetchCustomers(currentStore!.id),
    enabled: !!currentStore,
  });

  const filtered = customers.filter((c) => {
    const matchSearch =
      !search ||
      c.full_name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.email?.toLowerCase().includes(search.toLowerCase());
    const matchDebt = !filterDebt || c.balance > 0;
    return matchSearch && matchDebt;
  });

  const totalReceivables = customers.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);
  const debtorCount = customers.filter((c) => c.balance > 0).length;

  const shareDebtWhatsApp = (customer: Customer) => {
    const message = encodeURIComponent(
      t('customers.whatsappMessage', {
        name: customer.full_name,
        store: currentStore?.name ?? '',
        amount: `${currentStore?.currency || ''} ${customer.balance.toFixed(2)}`,
      })
    );
    const phone = customer.phone?.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
  };

  return (
    <PageShell>
      <PageHeader
        title={t('customers.title')}
        description={t('customers.description')}
        icon={Users}
        variant="banner"
        actions={
          <Button
            onClick={() => { setEditCustomer(null); setShowForm(true); }}
            className={cn(btnPrimary, 'gap-2 h-10 rounded-xl font-semibold bg-white/20 hover:bg-white/30 border border-white/30 text-white shadow-none')}
          >
            <Plus className="h-4 w-4" /> {t('customers.addCustomer')}
          </Button>
        }
      />

      <StatStrip>
        <StatChip label={t('customers.totalCustomers')} value={String(customers.length)} accent="blue" />
        <StatChip label={t('customers.withDebt')} value={String(debtorCount)} accent={debtorCount > 0 ? 'orange' : 'slate'} />
        <StatChip
          label={t('customers.receivables')}
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: currentStore?.currency || 'USD', maximumFractionDigits: 0 }).format(totalReceivables)}
          accent="violet"
        />
        <StatChip label={t('customers.active')} value={String(customers.filter((c) => c.is_active).length)} accent="emerald" />
      </StatStrip>

      <PageFilterBar className="space-y-3">
        {debtorCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5">
            <TrendingDown className="h-4 w-4 text-red-600 shrink-0" />
            <p className="text-sm text-red-700 font-medium">
              {t('customers.customersOweDebt', {
                count: debtorCount,
                amount: new Intl.NumberFormat('en-US', { style: 'currency', currency: currentStore?.currency || 'USD', minimumFractionDigits: 0 }).format(totalReceivables),
              })}
            </p>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t('customers.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(inputSoft, 'pl-9')}
            />
          </div>
          <Button
            variant={filterDebt ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterDebt(!filterDebt)}
            className={cn('rounded-xl h-10', filterDebt && 'bg-gradient-to-r from-red-500 to-rose-600 border-0')}
          >
            {t('customers.withDebtFilter')}
          </Button>
        </div>
      </PageFilterBar>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-sm border-b border-slate-100">
                <tr>
                  <th className={tableHead}>{t('customers.customer')}</th>
                  <th className={cn(tableHead, 'hidden sm:table-cell')}>{t('customers.phone')}</th>
                  <th className={cn(tableHead, 'hidden lg:table-cell')}>Price tier</th>
                  <th className={cn(tableHead, 'text-right')}>{t('customers.balance')}</th>
                  <th className={cn(tableHead, 'text-right hidden md:table-cell')}>{t('customers.totalPurchases')}</th>
                  <th className={cn(tableHead, 'text-center')}>{t('customers.status')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((customer) => (
                  <tr
                    key={customer.id}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => setViewCustomer(customer)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm">
                          {customer.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{customer.full_name}</p>
                          {customer.email && (
                            <p className="text-xs text-slate-400 truncate">{customer.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {customer.phone || '—'}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-0 text-[10px] font-semibold uppercase">
                        {PRICE_TIER_LABELS[(customer.price_tier as PriceTier) ?? 'retail']}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {customer.balance > 0 ? (
                        <span className="text-sm font-semibold text-red-600">
                          {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(customer.balance)}
                        </span>
                      ) : customer.balance < 0 ? (
                        <span className="text-sm font-semibold text-green-600">
                          +{new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Math.abs(customer.balance))}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">0.00</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell text-slate-600">
                      {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(customer.total_purchases)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant={customer.is_active ? 'default' : 'secondary'}
                        className={customer.is_active ? 'bg-green-100 text-green-700 border-0' : 'bg-slate-100 text-slate-500'}
                      >
                        {customer.is_active ? t('customers.activeStatus') : t('customers.inactiveStatus')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setEditCustomer(customer); setShowForm(true); }}>
                            {t('customers.edit')}
                          </DropdownMenuItem>
                          {customer.phone && (
                            <DropdownMenuItem onClick={() => shareDebtWhatsApp(customer)}>
                              <MessageSquare className="mr-2 h-4 w-4 text-green-600" />
                              {t('customers.whatsappReminder')}
                            </DropdownMenuItem>
                          )}
                          {customer.phone && (
                            <DropdownMenuItem onClick={() => window.location.href = `tel:${customer.phone}`}>
                              <Phone className="mr-2 h-4 w-4" />
                              {t('customers.call')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Users className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">{t('customers.noCustomers')}</p>
                <Button variant="link" className="mt-2 text-blue-600" onClick={() => setShowForm(true)}>
                  {t('customers.addFirstCustomer')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DataPanel>

      {showForm && (
        <CustomerFormModal
          open={showForm}
          customer={editCustomer}
          onClose={() => { setShowForm(false); setEditCustomer(null); }}
        />
      )}

      {viewCustomer && (
        <CustomerDetailSheet
          open={!!viewCustomer}
          customer={viewCustomer}
          onClose={() => setViewCustomer(null)}
          onEdit={() => { setEditCustomer(viewCustomer); setShowForm(true); setViewCustomer(null); }}
        />
      )}
    </PageShell>
  );
}
