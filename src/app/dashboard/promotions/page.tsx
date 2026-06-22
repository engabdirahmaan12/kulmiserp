'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Tag, Percent, DollarSign, Clock,
  CheckCircle2, Calendar, Search, X, Package, Layers,
} from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import type { Promotion, PromotionStatus } from '@/types';
import { getPromotionStatus } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

// ── Status styles ──────────────────────────────────────────
const STATUS_STYLES: Record<PromotionStatus, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-amber-100 text-amber-700',
  expired:   'bg-slate-100 text-slate-500',
  inactive:  'bg-slate-100 text-slate-400',
};

const emptyForm = () => ({
  name: '', description: '',
  discount_type: 'percentage' as 'percentage' | 'fixed',
  discount_value: '',
  applies_to: 'all' as 'all' | 'category' | 'product',
  category_ids: [] as string[],
  product_ids: [] as string[],
  start_date: '', start_time: '',
  end_date: '', end_time: '',
  is_active: true, priority: '0', min_order_amount: '',
});

type FormState = ReturnType<typeof emptyForm>;

// ── Data fetchers ──────────────────────────────────────────
async function fetchPromotions(storeId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.from('promotions').select('*').eq('store_id', storeId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Promotion[];
}

async function fetchProductsSimple(storeId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from('products')
    .select('id, name, sku, selling_price, category_id, brand, category:product_categories(name)')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('name');
  return (data ?? []).map((p) => ({
    ...p,
    category: Array.isArray(p.category) ? (p.category[0] ?? null) : (p.category ?? null),
  })) as {
    id: string;
    name: string;
    sku?: string;
    selling_price: number;
    category_id?: string;
    brand?: string;
    category?: { name: string } | null;
  }[];
}

async function fetchCategoriesSimple(storeId: string) {
  const supabase = createClient();
  const { data } = await supabase.from('product_categories').select('id, name').eq('store_id', storeId).order('name');
  return (data ?? []) as { id: string; name: string }[];
}

function buildIso(dateStr: string, timeStr: string) {
  if (!dateStr) return null;
  return new Date(`${dateStr}T${timeStr || '00:00'}:00`).toISOString();
}

// ── Multi-select product picker ────────────────────────────
function ProductPicker({
  selected, onChange,
  products,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  products: {
    id: string;
    name: string;
    sku?: string;
    selling_price: number;
    brand?: string;
    category?: { name: string } | null;
  }[];
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q.trim()) return products.slice(0, 12);
    const lq = q.toLowerCase();
    return products.filter((p) =>
      p.name.toLowerCase().includes(lq) ||
      (p.sku?.toLowerCase().includes(lq) ?? false) ||
      (p.brand?.toLowerCase().includes(lq) ?? false) ||
      (p.category?.name?.toLowerCase().includes(lq) ?? false),
    ).slice(0, 12);
  }, [products, q]);

  const toggle = useCallback((id: string) => {
    onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);
  }, [selected, onChange]);

  const selectedProducts = products.filter((p) => selected.includes(p.id));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <Input placeholder={t('promotions.searchProducts')} value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 h-8 text-sm" />
      </div>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {filtered.map((p) => {
          const checked = selected.includes(p.id);
          return (
            <label key={p.id} className={cn('flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors', checked && 'bg-blue-50')}>
              <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} className="h-3.5 w-3.5 accent-blue-600" />
              <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-800 block truncate">{p.name}</span>
                {(p.category?.name || p.brand) && (
                  <span className="text-[10px] text-slate-400 block truncate">
                    {[p.category?.name, p.brand].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400 shrink-0">{p.selling_price.toFixed(2)}</span>
            </label>
          );
        })}
        {filtered.length === 0 && <p className="px-3 py-3 text-xs text-slate-400 text-center">{t('promotions.noProductsFound')}</p>}
      </div>
      {selectedProducts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedProducts.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 text-xs px-2 py-0.5">
              {p.name}
              <button type="button" onClick={() => toggle(p.id)}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">{selected.length !== 1 ? t('promotions.nProductsSelected', { n: String(selected.length) }) : t('promotions.nProductSelected', { n: '1' })}</p>
    </div>
  );
}

// ── Category picker ────────────────────────────────────────
function CategoryPicker({
  selected, onChange,
  categories,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  categories: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const toggle = useCallback((id: string) => {
    onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);
  }, [selected, onChange]);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        {categories.map((c) => {
          const checked = selected.includes(c.id);
          return (
            <label key={c.id} className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors',
              checked ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-50',
            )}>
              <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} className="h-3.5 w-3.5 accent-blue-600" />
              <Layers className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{c.name}</span>
            </label>
          );
        })}
        {categories.length === 0 && <p className="col-span-2 text-xs text-slate-400 py-2">{t('promotions.noCategoriesFound')}</p>}
      </div>
      <p className="text-xs text-slate-400">{selected.length !== 1 ? t('promotions.nCategoriesSelected', { n: String(selected.length) }) : t('promotions.nCategorySelected', { n: '1' })}</p>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────
export default function PromotionsPage() {
  const { currentStore, user, storeUser } = useAuthStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [tab, setTab] = useState<'active' | 'scheduled' | 'expired' | 'all'>('active');
  const currency = currentStore?.currency ?? 'USD';
  const canEdit = storeUser?.role === 'owner' || storeUser?.role === 'manager';

  const { data: promos = [], isLoading } = useQuery({
    queryKey: ['promotions', currentStore?.id],
    queryFn: () => fetchPromotions(currentStore!.id),
    enabled: !!currentStore,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-simple', currentStore?.id],
    queryFn: () => fetchProductsSimple(currentStore!.id),
    enabled: !!currentStore && showDialog,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories-simple', currentStore?.id],
    queryFn: () => fetchCategoriesSimple(currentStore!.id),
    enabled: !!currentStore && showDialog,
  });

  const filtered = useMemo(() => {
    if (tab === 'all') return promos;
    return promos.filter((p) => getPromotionStatus(p) === tab);
  }, [promos, tab]);

  const activeCount = promos.filter((p) => getPromotionStatus(p) === 'active').length;
  const scheduledCount = promos.filter((p) => getPromotionStatus(p) === 'scheduled').length;

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowDialog(true); };
  const openEdit = (p: Promotion) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? '',
      discount_type: p.discount_type,
      discount_value: String(p.discount_value),
      applies_to: p.applies_to,
      category_ids: p.category_ids ?? [],
      product_ids: p.product_ids ?? [],
      start_date: p.start_date ? p.start_date.slice(0, 10) : '',
      start_time: p.start_date ? p.start_date.slice(11, 16) : '',
      end_date: p.end_date ? p.end_date.slice(0, 10) : '',
      end_time: p.end_date ? p.end_date.slice(11, 16) : '',
      is_active: p.is_active,
      priority: String(p.priority),
      min_order_amount: p.min_order_amount ? String(p.min_order_amount) : '',
    });
    setShowDialog(true);
  };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const val = parseFloat(form.discount_value);
      if (!form.name.trim()) throw new Error('Name is required');
      if (isNaN(val) || val <= 0) throw new Error('Discount value must be > 0');
      if (form.applies_to === 'product' && form.product_ids.length === 0)
        throw new Error('Select at least one product');
      if (form.applies_to === 'category' && form.category_ids.length === 0)
        throw new Error('Select at least one category');

      const { data, error } = await supabase.rpc('upsert_promotion', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_id: editing?.id ?? null,
        p_name: form.name.trim(),
        p_description: form.description.trim() || null,
        p_discount_type: form.discount_type,
        p_discount_value: val,
        p_applies_to: form.applies_to,
        p_category_ids: form.applies_to === 'category' ? form.category_ids : null,
        p_product_ids: form.applies_to === 'product' ? form.product_ids : null,
        p_start_date: buildIso(form.start_date, form.start_time),
        p_end_date: buildIso(form.end_date, form.end_time),
        p_is_active: form.is_active,
        p_priority: parseInt(form.priority) || 0,
        p_min_order_amount: form.min_order_amount ? parseFloat(form.min_order_amount) : null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions', currentStore?.id] });
      // Invalidate POS products so discounts refresh
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      toast.success(editing ? t('promotions.toastUpdated') : t('promotions.toastCreated'));
      setShowDialog(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { mutate: remove } = useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('delete_promotion', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_id: id,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) throw new Error(result?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      toast.success(t('promotions.toastDeleted'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalDiscountGiven = promos.length;
  const now = new Date();

  return (
    <PageShell>
      <PageHeader
        title={t('promotions.title')}
        description={t('promotions.description')}
        icon={Tag}
        variant="banner"
        actions={canEdit ? (
          <Button onClick={openAdd} className="gap-2 h-10 rounded-xl font-semibold bg-white/20 hover:bg-white/30 border border-white/30 text-white shadow-none">
            <Plus className="h-4 w-4" /> {t('promotions.addBtn')}
          </Button>
        ) : undefined}
      />

      <StatStrip>
        <StatChip label={t('promotions.statTotal')} value={String(promos.length)} accent="blue" />
        <StatChip label={t('promotions.statActive')} value={String(activeCount)} accent={activeCount > 0 ? 'emerald' : 'slate'} />
        <StatChip label={t('promotions.statScheduled')} value={String(scheduledCount)} accent="violet" />
        <StatChip label={t('promotions.statExpired')} value={String(promos.filter((p) => getPromotionStatus(p) === 'expired').length)} accent="slate" />
      </StatStrip>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="mb-4">
          {([
            { key: 'active', label: t('promotions.tabActive') },
            { key: 'scheduled', label: t('promotions.tabScheduled') },
            { key: 'expired', label: t('promotions.tabExpired') },
            { key: 'all', label: t('promotions.tabAll') },
          ] as const).map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>{tab.label}</TabsTrigger>
          ))}
        </TabsList>

        {(['active', 'scheduled', 'expired', 'all'] as const).map((tabKey) => (
          <TabsContent key={tabKey} value={tabKey}>
            <DataPanel>
              {isLoading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Tag className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">{tabKey === 'all' ? t('promotions.noPromosAll') : t('promotions.noPromos', { status: tabKey })}</p>
                  {canEdit && <Button variant="link" className="text-blue-600 mt-1" onClick={openAdd}>{t('promotions.createOne')}</Button>}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filtered.map((p) => {
                    const status = getPromotionStatus(p);
                    const daysLeft = p.end_date ? differenceInDays(new Date(p.end_date), now) : null;
                    return (
                      <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                        <div className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                          p.discount_type === 'percentage' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600',
                        )}>
                          {p.discount_type === 'percentage' ? <Percent className="h-5 w-5" /> : <DollarSign className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{p.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            <span className="font-medium text-blue-600">
                              {p.discount_type === 'percentage'
                              ? t('promotions.discountPct', { value: String(p.discount_value) })
                              : t('promotions.discountFixed', { value: String(p.discount_value), currency })}
                            </span>
                            {' · '}
                            {p.applies_to === 'all' ? t('promotions.appliesToAll') :
                             p.applies_to === 'category'
                               ? ((p.category_ids ?? []).length !== 1
                                 ? t('promotions.appliesToCategory', { n: String((p.category_ids ?? []).length) })
                                 : t('promotions.appliesToCategorySingular', { n: '1' }))
                               : ((p.product_ids ?? []).length !== 1
                                 ? t('promotions.appliesToProduct', { n: String((p.product_ids ?? []).length) })
                                 : t('promotions.appliesToProductSingular', { n: '1' }))}
                            {p.start_date ? ` · ${t('promotions.dateFrom', { date: format(parseISO(p.start_date), 'MMM d') })}` : ''}
                            {p.end_date ? ` ${t('promotions.dateTo', { date: format(parseISO(p.end_date), 'MMM d') })}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {status === 'active' && daysLeft !== null && daysLeft <= 7 && daysLeft >= 0 && (
                            <span className="text-xs text-orange-600 font-medium">
                              {daysLeft === 0 ? t('promotions.endsToday') : t('promotions.daysLeft', { n: String(daysLeft) })}
                            </span>
                          )}
                          <Badge className={cn('border-0 text-[10px]', STATUS_STYLES[status])}>
                            {status}
                          </Badge>
                        </div>
                        {canEdit && (
                          <div className="flex gap-1 shrink-0">
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEdit(p)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-700" onClick={() => remove(p.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </DataPanel>
          </TabsContent>
        ))}
      </Tabs>

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(o) => setShowDialog(o)}>
        <DialogContent className="max-w-lg max-h-[min(92vh,640px)] flex flex-col overflow-hidden p-0 gap-0 rounded-2xl">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-blue-600" />
              {editing ? t('promotions.dialogEditTitle') : t('promotions.dialogAddTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">
            <div className="space-y-1.5">
              <Label>{t('promotions.labelName')}</Label>
              <Input placeholder={t('promotions.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('promotions.labelDesc')}</Label>
              <Textarea rows={2} placeholder={t('promotions.descPlaceholder')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('promotions.labelDiscountType')}</Label>
                <Select value={form.discount_type} onValueChange={(v) => v && setForm({ ...form, discount_type: v as 'percentage' | 'fixed' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">{t('promotions.optPercentage')}</SelectItem>
                    <SelectItem value="fixed">{t('promotions.optFixed', { currency })}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('promotions.labelDiscountValue')}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                    {form.discount_type === 'percentage' ? '%' : currency}
                  </span>
                  <Input className="pl-8" type="number" min={0} step="0.01" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Applies To */}
            <div className="space-y-2">
              <Label>{t('promotions.labelAppliesTo')}</Label>
              <div className="flex gap-2">
                {([
                  { key: 'all', label: t('promotions.optEntireStore') },
                  { key: 'category', label: t('promotions.optByCategory') },
                  { key: 'product', label: t('promotions.optByProduct') },
                ] as const).map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setForm({ ...form, applies_to: v.key })}
                    className={cn(
                      'flex-1 rounded-lg border py-1.5 text-sm font-medium transition-all',
                      form.applies_to === v.key
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-slate-200 hover:border-slate-300 text-slate-600',
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {form.applies_to === 'category' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">{t('promotions.selectCategories')}</Label>
                  <CategoryPicker
                    selected={form.category_ids}
                    onChange={(ids) => setForm({ ...form, category_ids: ids })}
                    categories={categories}
                  />
                </div>
              )}

              {form.applies_to === 'product' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">{t('promotions.selectProducts')}</Label>
                  <ProductPicker
                    selected={form.product_ids}
                    onChange={(ids) => setForm({ ...form, product_ids: ids })}
                    products={products}
                  />
                </div>
              )}
            </div>

            {/* Schedule */}
            <div>
              <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                <Calendar className="h-3.5 w-3.5" /> {t('promotions.sectionSchedule')}
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('promotions.labelStartDate')}</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('promotions.labelStartTime')}</Label>
                  <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('promotions.labelEndDate')}</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('promotions.labelEndTime')}</Label>
                  <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">{t('promotions.scheduleNote')}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('promotions.labelMinOrder', { currency })}</Label>
                <Input type="number" min={0} placeholder={t('promotions.minOrderPlaceholder')} value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('promotions.labelPriority')}</Label>
                <Input type="number" min={0} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
                <p className="text-xs text-slate-400">{t('promotions.priorityNote')}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 accent-blue-600" />
              <Label htmlFor="is_active" className="cursor-pointer">{t('promotions.labelIsActive')}</Label>
            </div>
          </div>
          <DialogFooter className="shrink-0 !mx-0 !mb-0 px-5 py-4 border-t bg-slate-50/50 rounded-b-2xl gap-2">
            <Button variant="outline" onClick={() => setShowDialog(false)}>{t('promotions.btnCancel')}</Button>
            <Button onClick={() => save()} disabled={saving} className="bg-gradient-to-r from-blue-600 to-indigo-600">
              {saving ? t('promotions.btnSaving') : editing ? t('promotions.btnUpdate') : t('promotions.btnCreate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
