'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Users, Store, Loader2, Plus, Trash2, Palette, FileText, Layers, Globe, ImageIcon, ShoppingCart, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { usePermission } from '@/lib/hooks/usePermission';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, DataPanel } from '@/components/layout/PageShell';
import { btnPrimary, inputSoft } from '@/lib/ui-classes';
import { InventorySettingsPanel } from '@/components/inventory/InventorySettingsPanel';
import { LanguageSettingsPanel } from '@/components/i18n/LanguageSettingsPanel';
import { StoreBrandingPanel } from '@/components/settings/StoreBrandingPanel';
import { PosSettingsPanel } from '@/components/settings/PosSettingsPanel';
import { PricingConfigurationPanel } from '@/components/settings/PricingConfigurationPanel';
import { useTranslation } from '@/lib/i18n/useTranslation';

const storeSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  currency: z.string().default('USD'),
  tax_rate: z.number().min(0).max(100).default(0),
  invoice_prefix: z.string().default('INV'),
});

type StoreForm = z.infer<typeof storeSchema>;

const CURRENCIES = ['USD', 'SOS', 'EUR', 'GBP', 'KES', 'ETB'];
const ROLES = ['manager', 'cashier', 'accountant', 'purchase_officer'];

const INVOICE_THEMES = [
  { value: 'blue',   label: 'Blue (Default)',  color: 'bg-blue-600' },
  { value: 'green',  label: 'Green',            color: 'bg-emerald-600' },
  { value: 'purple', label: 'Purple',           color: 'bg-violet-600' },
  { value: 'dark',   label: 'Dark',             color: 'bg-slate-800' },
];

interface InvoiceSettingsForm {
  invoice_theme: string;
  invoice_footer: string;
  invoice_terms: string;
  tax_number: string;
  show_tax: boolean;
  show_discount: boolean;
  show_sku: boolean;
  show_logo: boolean;
  show_product_images: boolean;
}

type SettingsTab = 'store' | 'business' | 'invoice' | 'inventory' | 'branding' | 'language' | 'users' | 'pos';

function resolveSettingsTab(param: string | null): SettingsTab {
  if (param === 'tax' || param === 'currency') return 'store';
  const allowed: SettingsTab[] = ['store', 'business', 'invoice', 'inventory', 'branding', 'language', 'users', 'pos'];
  if (param && allowed.includes(param as SettingsTab)) return param as SettingsTab;
  return 'store';
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageShell><div className="p-8 text-slate-500">Loading settings…</div></PageShell>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const { currentStore, user } = useAuthStore();
  const { role } = usePermission();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => resolveSettingsTab(tabParam));
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('cashier');

  useEffect(() => {
    setActiveTab(resolveSettingsTab(tabParam));
  }, [tabParam]);

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    const url = tab === 'store' ? '/dashboard/settings' : `/dashboard/settings?tab=${tab}`;
    router.replace(url, { scroll: false });
  };

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<StoreForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(storeSchema) as any,
    values: {
      name: currentStore?.name || '',
      email: currentStore?.email || '',
      phone: currentStore?.phone || '',
      address: currentStore?.address || '',
      currency: currentStore?.currency || 'USD',
      tax_rate: currentStore?.tax_rate || 0,
      invoice_prefix: currentStore?.invoice_prefix || 'INV',
    },
  });

  const { mutate: updateStore, isPending } = useMutation({
    mutationFn: async (data: unknown) => {
      const supabase = createClient();
      const { error } = await supabase
        .from('stores')
        .update(data as StoreForm)
        .eq('id', currentStore!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
      toast.success(t('settings.saved'));
    },
    onError: (e) => toast.error(t('errors.saveFailed') + ': ' + e.message),
  });

  const { data: storeUsers = [] } = useQuery({
    queryKey: ['store-users', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('store_users')
        .select('*, profile:user_profiles(full_name, avatar_url)')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true);
      return data || [];
    },
    enabled: !!currentStore,
  });

  const { mutate: removeUser } = useMutation({
    mutationFn: async (userId: string) => {
      const supabase = createClient();
      await supabase
        .from('store_users')
        .update({ is_active: false })
        .eq('store_id', currentStore!.id)
        .eq('user_id', userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-users', currentStore?.id] });
      toast.success('User removed');
    },
  });

  const isOwner = role === 'owner';

  // Invoice settings form state
  const storeSettings = (currentStore?.settings ?? {}) as Record<string, unknown>;
  const [invoiceForm, setInvoiceForm] = useState<InvoiceSettingsForm>({
    invoice_theme: (storeSettings.invoice_theme as string) ?? 'blue',
    invoice_footer: (storeSettings.invoice_footer as string) ?? '',
    invoice_terms: (storeSettings.invoice_terms as string) ?? '',
    tax_number: (storeSettings.tax_number as string) ?? '',
    show_tax: storeSettings.show_tax !== false,
    show_discount: storeSettings.show_discount !== false,
    show_sku: storeSettings.show_sku !== false,
    show_logo: storeSettings.show_logo !== false,
    show_product_images: storeSettings.show_product_images !== false,
  });

  const { mutate: saveInvoiceSettings, isPending: savingInvoice } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc('update_store_invoice_settings', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_settings: invoiceForm,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store', currentStore?.id] });
      toast.success('Invoice settings saved');
    },
    onError: (e: Error) => toast.error('Failed: ' + e.message),
  });

  const roleColors: Record<string, string> = {
    owner: 'bg-purple-100 text-purple-700',
    manager: 'bg-blue-100 text-blue-700',
    cashier: 'bg-green-100 text-green-700',
    accountant: 'bg-orange-100 text-orange-700',
    purchase_officer: 'bg-teal-100 text-teal-700',
  };

  return (
    <PageShell>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
        icon={Settings}
        variant="banner"
      />

      <div className="max-w-3xl">
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as SettingsTab)}>
          <TabsList className="bg-slate-100/80 p-1 rounded-xl h-auto flex-wrap">
            <TabsTrigger value="store" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Store className="h-4 w-4" />
              {t('settings.tabs.store')}
            </TabsTrigger>
            <TabsTrigger value="invoice" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <FileText className="h-4 w-4" />
              {t('settings.tabs.invoice')}
            </TabsTrigger>
            <TabsTrigger value="business" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Building2 className="h-4 w-4" />
              Pricing
            </TabsTrigger>
            <TabsTrigger value="pos" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <ShoppingCart className="h-4 w-4" />
              POS
            </TabsTrigger>
            <TabsTrigger value="inventory" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Layers className="h-4 w-4" />
              {t('settings.tabs.inventory')}
            </TabsTrigger>
            <TabsTrigger value="branding" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <ImageIcon className="h-4 w-4" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="language" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Globe className="h-4 w-4" />
              {t('settings.tabs.language')}
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Users className="h-4 w-4" />
              {t('settings.tabs.team')} ({storeUsers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="store" className="mt-4">
            <DataPanel className="p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Store Information</h3>
              <form onSubmit={handleSubmit((d) => updateStore(d))} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label>Store Name *</Label>
                    <Input {...register('name')} className={inputSoft} />
                    {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" {...register('email')} className={inputSoft} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input type="tel" {...register('phone')} className={inputSoft} />
                  </div>
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label>Address</Label>
                    <Input {...register('address')} className={inputSoft} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Currency</Label>
                    <Select value={watch('currency')} onValueChange={(v: string | null) => setValue('currency', v ?? 'USD')}>
                      <SelectTrigger className={inputSoft}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Default Tax Rate (%)</Label>
                    <Input type="number" step="0.01" min="0" max="100" {...register('tax_rate', { valueAsNumber: true })} className={inputSoft} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice Prefix</Label>
                    <Input {...register('invoice_prefix')} placeholder="INV" className={inputSoft} />
                  </div>
                </div>

                <Button type="submit" className={cn(btnPrimary, 'rounded-xl font-semibold')} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Changes
                </Button>
              </form>
            </DataPanel>
          </TabsContent>

          {/* ── Invoice & Branding tab ── */}
          <TabsContent value="invoice" className="mt-4">
            <DataPanel className="p-6 space-y-6">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <Palette className="h-5 w-5 text-blue-600" /> Invoice Branding & Settings
              </h3>

              {/* Theme */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Color Theme</Label>
                <div className="flex gap-3 flex-wrap">
                  {INVOICE_THEMES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setInvoiceForm((f) => ({ ...f, invoice_theme: t.value }))}
                      className={cn(
                        'flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all',
                        invoiceForm.invoice_theme === t.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 hover:border-slate-300',
                      )}
                    >
                      <span className={cn('h-4 w-4 rounded-full', t.color)} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Business details for invoice */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Tax / Business Number</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                  placeholder="e.g. TIN-123456789"
                  value={invoiceForm.tax_number}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, tax_number: e.target.value }))}
                />
              </div>

              {/* Footer message */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Invoice Footer Message</Label>
                <textarea
                  rows={2}
                  className="flex w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 resize-none"
                  placeholder="e.g. Thank you for shopping with us!"
                  value={invoiceForm.invoice_footer}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_footer: e.target.value }))}
                />
              </div>

              {/* Terms */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Terms & Conditions</Label>
                <textarea
                  rows={3}
                  className="flex w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 resize-none"
                  placeholder="e.g. All sales are final. No returns after 7 days."
                  value={invoiceForm.invoice_terms}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, invoice_terms: e.target.value }))}
                />
              </div>

              {/* Display toggles */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Display Options</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'show_tax', label: 'Show Tax' },
                    { key: 'show_discount', label: 'Show Discount' },
                    { key: 'show_sku', label: 'Show SKU' },
                    { key: 'show_logo', label: 'Show Logo' },
                    { key: 'show_product_images', label: 'Show Product Images' },
                  ] as const).map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5 cursor-pointer hover:bg-slate-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={invoiceForm[key]}
                        onChange={(e) => setInvoiceForm((f) => ({ ...f, [key]: e.target.checked }))}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span className="text-sm text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => saveInvoiceSettings()}
                disabled={savingInvoice}
                className={cn(btnPrimary, 'rounded-xl font-semibold inline-flex items-center gap-2')}
              >
                {savingInvoice && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Invoice Settings
              </button>
            </DataPanel>
          </TabsContent>

          <TabsContent value="business" className="mt-4">
            <PricingConfigurationPanel />
          </TabsContent>

          <TabsContent value="pos" className="mt-4">
            <PosSettingsPanel />
          </TabsContent>

          <TabsContent value="inventory" className="mt-4">
            <InventorySettingsPanel />
          </TabsContent>

          <TabsContent value="branding" className="mt-4">
            <StoreBrandingPanel />
          </TabsContent>

          <TabsContent value="language" className="mt-4">
            <LanguageSettingsPanel />
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <DataPanel className="p-6 space-y-4">
              <h3 className="font-semibold text-slate-900">Team Members</h3>

              <div className="space-y-2">
                {storeUsers.map((su) => (
                  <div key={su.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white">
                      {(su.profile as { full_name?: string })?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {(su.profile as { full_name?: string })?.full_name || 'User'}
                        {su.user_id === user?.id && (
                          <span className="ml-1 text-xs text-slate-400">(you)</span>
                        )}
                      </p>
                    </div>
                    <Badge className={cn('shrink-0 text-xs border-0', roleColors[su.role] || 'bg-slate-100 text-slate-700')}>
                      {su.role.replace('_', ' ')}
                    </Badge>
                    {isOwner && su.user_id !== user?.id && (
                      <button
                        onClick={() => removeUser(su.user_id)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {isOwner && (
                <div className="border-t border-slate-100 pt-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">Invite Team Member</h4>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="email"
                      placeholder="Email address"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className={cn(inputSoft, 'flex-1')}
                    />
                    <Select value={inviteRole} onValueChange={(v: string | null) => setInviteRole(v ?? 'cashier')}>
                      <SelectTrigger className={cn(inputSoft, 'w-full sm:w-40')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">
                            {r.replace('_', ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      className={cn(btnPrimary, 'gap-2 rounded-xl font-semibold')}
                      disabled={!inviteEmail}
                      onClick={() => toast.info('Invite feature coming soon!')}
                    >
                      <Plus className="h-4 w-4" />
                      Invite
                    </Button>
                  </div>
                </div>
              )}
            </DataPanel>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
