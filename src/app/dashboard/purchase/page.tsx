'use client';

import { useState, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, PageFilterBar, DataPanel, StatStrip, StatChip } from '@/components/layout/PageShell';
import { btnPrimary, inputSoft } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ShoppingBag, Plus, Search, CheckCircle, X, Minus, Package,
  ChevronRight, Truck,
} from 'lucide-react';
import { format } from 'date-fns';
import type { PurchaseOrder, PurchaseOrderItem, Supplier, Product } from '@/types';
import { PurchaseCheckoutModal } from '@/components/purchase/PurchaseCheckoutModal';
import {
  computePurchaseLineBase,
  defaultPurchaseUnitCost,
  getPurchaseUnitForProduct,
  getPurchaseUnitsForProduct,
  lineStateFromPurchaseUnit,
  purchaseUnitCostForProduct,
} from '@/lib/purchase/units';
import { BarcodeScannerField } from '@/components/barcode/BarcodeScannerField';
import { toSelectItems } from '@/lib/ui/select-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

type POWithSupplier = PurchaseOrder & { supplier: Supplier | null; items?: PurchaseOrderItem[] };

const STATUS_CLASS = {
  draft: 'bg-slate-100 text-slate-600',
  pending: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
} as const;

interface LineItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  purchase_unit_id?: string;
  purchase_unit_code?: string;
  conversion_factor: number;
  allows_decimal: boolean;
}

async function fetchPOs(storeId: string): Promise<POWithSupplier[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, supplier:suppliers(*)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as POWithSupplier[];
}

async function fetchPODetails(poId: string): Promise<{ items: PurchaseOrderItem[]; po: POWithSupplier }> {
  const supabase = createClient();
  const [poRes, itemsRes] = await Promise.all([
    supabase.from('purchase_orders').select('*, supplier:suppliers(*)').eq('id', poId).single(),
    supabase.from('purchase_order_items').select('*, product:products(name, sku)').eq('purchase_order_id', poId),
  ]);
  if (poRes.error) throw poRes.error;
  if (itemsRes.error) throw itemsRes.error;
  return {
    po: poRes.data as POWithSupplier,
    items: (itemsRes.data ?? []) as PurchaseOrderItem[],
  };
}

async function fetchSuppliers(storeId: string): Promise<Supplier[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('suppliers').select('*').eq('store_id', storeId).eq('is_active', true).order('name');
  if (error) throw error;
  return (data ?? []) as Supplier[];
}

async function fetchProducts(storeId: string): Promise<Product[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('products')
    .select('*, product_units(*, unit_type:unit_types(*))')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as Product[];
}

const emptyLine = (): LineItem => ({
  product_id: '',
  product_name: '',
  quantity: 1,
  unit_cost: 0,
  conversion_factor: 1,
  allows_decimal: false,
});

export default function PurchaseOrdersPage() {
  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showNewPO, setShowNewPO] = useState(false);
  const [selectedPO, setSelectedPO] = useState<POWithSupplier | null>(null);
  const [poItems, setPoItems] = useState<PurchaseOrderItem[]>([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [newProductLine, setNewProductLine] = useState<number | null>(null);
  const [newProductForm, setNewProductForm] = useState({
    name: '',
    barcode: '',
    selling_price: 0,
    category_id: '',
  });
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState({ name: '', phone: '', contact_person: '' });

  // New PO form state
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLine()]);

  const currency = currentStore?.currency ?? 'USD';
  const fmtC = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['purchase_orders', currentStore?.id],
    queryFn: () => fetchPOs(currentStore!.id),
    enabled: !!currentStore,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', currentStore?.id],
    queryFn: () => fetchSuppliers(currentStore!.id),
    enabled: !!currentStore,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', currentStore?.id],
    queryFn: () => fetchProducts(currentStore!.id),
    enabled: !!currentStore,
  });

  const filtered = pos.filter((po) => {
    if (!search) return true;
    return (
      po.po_number.toLowerCase().includes(search.toLowerCase()) ||
      po.supplier?.name.toLowerCase().includes(search.toLowerCase())
    );
  });

  const supplierSelectItems = useMemo(
    () => toSelectItems(suppliers, (s) => s.id, (s) => s.name),
    [suppliers],
  );
  const productSelectItems = useMemo(
    () => toSelectItems(products, (p) => p.id, (p) => p.name),
    [products],
  );

  const stats = {
    total: pos.length,
    pending: pos.filter((p) => p.status === 'pending').length,
    totalSpent: pos.filter((p) => p.status === 'received').reduce((s, p) => s + p.total_amount, 0),
  };

  const openSheet = async (po: POWithSupplier) => {
    try {
      const { po: fresh, items } = await fetchPODetails(po.id);
      setSelectedPO(fresh);
      setPoItems(items);
    } catch {
      setSelectedPO(po);
      const supabase = createClient();
      const { data } = await supabase
        .from('purchase_order_items')
        .select('*, product:products(name, sku)')
        .eq('purchase_order_id', po.id);
      setPoItems((data ?? []) as PurchaseOrderItem[]);
    }
  };

  const resetForm = () => {
    setSupplierId('');
    setExpectedDate('');
    setNotes('');
    setLineItems([emptyLine()]);
  };

  const addLine = () => setLineItems((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) => setLineItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        if (field === 'product_id') {
          const product = products.find((p) => p.id === value);
          const pu = product ? getPurchaseUnitForProduct(product) : null;
          return {
            ...item,
            product_id: value as string,
            product_name: product?.name ?? '',
            unit_cost: product ? defaultPurchaseUnitCost(product) : 0,
            purchase_unit_id: pu?.purchase_unit_id,
            purchase_unit_code: pu?.purchase_unit_code,
            conversion_factor: pu?.conversion_factor ?? 1,
            allows_decimal: pu?.allows_decimal ?? false,
          };
        }
        if (field === 'purchase_unit_id') {
          const product = products.find((p) => p.id === item.product_id);
          const unit = product?.product_units?.find((u) => u.unit_type_id === value);
          if (!product || !unit) return item;
          const state = lineStateFromPurchaseUnit(product, unit);
          return {
            ...item,
            purchase_unit_id: state.purchase_unit_id,
            purchase_unit_code: state.purchase_unit_code,
            conversion_factor: state.conversion_factor,
            allows_decimal: state.allows_decimal,
            unit_cost: purchaseUnitCostForProduct(product, unit),
          };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const lineTotal = lineItems.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

  const { mutate: createPO, isPending: creating } = useMutation({
    mutationFn: async (asDraft: boolean) => {
      if (!supplierId) throw new Error(t('purchases.selectSupplier'));
      const supabase = createClient();
      const validLines = lineItems.filter((l) => l.product_id && l.quantity > 0);
      if (validLines.length === 0) throw new Error(t('purchases.addOneItem'));
      const subtotal = validLines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
      const poNumber = await (async () => {
        const { data, error } = await supabase.rpc('next_purchase_invoice_number', {
          p_store_id: currentStore!.id,
        });
        if (error || !data) throw new Error(error?.message ?? 'Failed to generate purchase invoice number');
        return data as string;
      })();
      const { data: po, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
          store_id: currentStore!.id,
          po_number: poNumber,
          supplier_id: supplierId || null,
          created_by: user!.id,
          status: asDraft ? 'draft' : 'pending',
          subtotal,
          tax_amount: 0,
          total_amount: subtotal,
          paid_amount: 0,
          notes: notes || null,
          expected_date: expectedDate || null,
        })
        .select()
        .single();
      if (poError) throw poError;
      const items = validLines.map((l) => {
        const { baseQty } = computePurchaseLineBase(l.quantity, l.unit_cost, l.conversion_factor);
        return {
          store_id: currentStore!.id,
          purchase_order_id: po.id,
          product_id: l.product_id,
          product_name: l.product_name,
          quantity: l.quantity,
          received_quantity: 0,
          unit_cost: l.unit_cost,
          subtotal: l.quantity * l.unit_cost,
          purchase_unit_id: l.purchase_unit_id ?? null,
          purchase_unit_code: l.purchase_unit_code ?? null,
          purchase_unit_qty: l.quantity,
          base_qty: baseQty,
        };
      });
      const { error: itemsError } = await supabase.from('purchase_order_items').insert(items);
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_orders', currentStore?.id] });
      toast.success(t('purchases.poCreated'));
      setShowNewPO(false);
      resetForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: createSupplier, isPending: creatingSupplier } = useMutation({
    mutationFn: async () => {
      if (!newSupplierForm.name.trim()) throw new Error(t('purchases.supplierNameRequired'));
      const supabase = createClient();
      const { data, error } = await supabase
        .from('suppliers')
        .insert({
          store_id: currentStore!.id,
          name: newSupplierForm.name.trim(),
          phone: newSupplierForm.phone.trim() || null,
          contact_person: newSupplierForm.contact_person.trim() || null,
          is_active: true,
          balance: 0,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', currentStore?.id] });
      setSupplierId(data.id);
      setShowAddSupplier(false);
      setNewSupplierForm({ name: '', phone: '', contact_person: '' });
      toast.success(t('purchases.supplierAdded'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: createProductForLine, isPending: creatingProduct } = useMutation({
    mutationFn: async (lineIndex: number) => {
      const supabase = createClient();
      if (!newProductForm.name.trim()) throw new Error('Product name required');
      const { data: product, error } = await supabase
        .from('products')
        .insert({
          store_id: currentStore!.id,
          name: newProductForm.name.trim(),
          barcode: newProductForm.barcode || null,
          category_id: newProductForm.category_id || null,
          cost_price: lineItems[lineIndex].unit_cost,
          selling_price: newProductForm.selling_price || lineItems[lineIndex].unit_cost * 1.2,
          sku: `SKU-${Date.now().toString(36).slice(-6).toUpperCase()}`,
        })
        .select()
        .single();
      if (error) throw error;
      updateLine(lineIndex, 'product_id', product.id);
      setNewProductLine(null);
      setNewProductForm({ name: '', barcode: '', selling_price: 0, category_id: '' });
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell>
      <PageHeader
        title={t('purchases.title')}
        description={t('purchases.description')}
        icon={ShoppingBag}
        variant="banner"
        actions={
          <Button onClick={() => setShowNewPO(true)} className={cn(btnPrimary, 'gap-2 h-10 rounded-xl font-semibold')}>
            <Plus className="h-4 w-4" /> {t('purchases.newPurchaseOrder')}
          </Button>
        }
      />

      <StatStrip>
        <StatChip label={t('purchases.totalOrders')} value={String(stats.total)} accent="blue" />
        <StatChip label={t('purchases.pending')} value={String(stats.pending)} sub={t('purchases.awaitingReceive')} accent="orange" />
        <StatChip label={t('purchases.totalSpent')} value={fmtC(stats.totalSpent)} accent="blue" />
        <StatChip label={t('purchases.suppliers')} value={String(suppliers.length)} accent="violet" />
      </StatStrip>

      <PageFilterBar>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder={t('purchases.searchPoSupplier')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(inputSoft, 'pl-9')}
          />
        </div>
      </PageFilterBar>

      <DataPanel>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('purchases.poNum')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden sm:table-cell">{t('purchases.supplier')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden md:table-cell">{t('purchases.date')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase hidden lg:table-cell">{t('purchases.expected')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('purchases.total')}</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-600 uppercase">{t('purchases.status')}</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => openSheet(po)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{po.po_number}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {po.supplier?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                      {format(new Date(po.created_at), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">
                      {po.expected_date ? format(new Date(po.expected_date), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {fmtC(po.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`${STATUS_CLASS[po.status]} border-0 text-xs`}>{t(`poStatus.${po.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <ShoppingBag className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">{t('purchases.noPoYet')}</p>
                <Button variant="link" className="mt-1 text-blue-600" onClick={() => setShowNewPO(true)}>
                  {t('purchases.createFirstOrder')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DataPanel>

      {/* PO Detail Sheet */}
      <Sheet open={!!selectedPO} onOpenChange={() => setSelectedPO(null)}>
        <SheetContent className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col overflow-hidden">
          {selectedPO && (
            <PODetailPanel
              po={selectedPO}
              poItems={poItems}
              suppliers={suppliers}
              supplierSelectItems={supplierSelectItems}
              fmtC={fmtC}
              onReceive={() => setShowCheckout(true)}
              onSupplierAssigned={(po) => {
                setSelectedPO(po);
                queryClient.invalidateQueries({ queryKey: ['purchase_orders', currentStore?.id] });
              }}
              onClose={() => setSelectedPO(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <PurchaseCheckoutModal
        open={showCheckout}
        po={selectedPO}
        onClose={() => setShowCheckout(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['purchase_orders', currentStore?.id] });
          queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
          queryClient.invalidateQueries({ queryKey: ['store-transactions', currentStore?.id] });
          setSelectedPO(null);
          setShowCheckout(false);
        }}
      />

      {/* New PO Dialog */}
      <Dialog open={showNewPO} onOpenChange={(o) => { setShowNewPO(o); if (!o) { resetForm(); setNewProductLine(null); } }}>
        <DialogContent className="sm:max-w-3xl w-[calc(100%-1.5rem)] max-h-[min(92vh,780px)] flex flex-col overflow-hidden p-0 gap-0 rounded-2xl">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b border-slate-100">
            <DialogTitle className="text-lg font-bold">{t('purchases.newPurchaseOrder')}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-5 py-4 gap-4">
            {/* Header fields — compact row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
              <div className="space-y-1.5 sm:col-span-1">
                <Label className="text-xs font-medium text-slate-600">{t('purchases.supplierRequired')}</Label>
                <div className="flex gap-2">
                  <Select
                    value={supplierId || null}
                    items={supplierSelectItems}
                    onValueChange={(v) => v && setSupplierId(v)}
                  >
                    <SelectTrigger className="h-10 w-full min-w-0 flex-1 rounded-xl border-slate-200 bg-white">
                      <SelectValue placeholder={t('purchases.selectSupplierPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-slate-400">
                          {t('purchases.noSuppliersYet')}
                        </div>
                      ) : (
                        suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl border-slate-200"
                    title={t('purchases.addSupplierTooltip')}
                    onClick={() => setShowAddSupplier(true)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {suppliers.length === 0 && (
                  <p className="text-[11px] text-amber-600">{t('purchases.addSupplierHint')}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">{t('purchases.expectedDate')}</Label>
                <Input type="date" className="h-9" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">{t('purchases.notes')}</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('purchases.optionalNotes')}
                  className="h-9"
                />
              </div>
            </div>

            {/* Line items */}
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <div className="flex items-center justify-between shrink-0">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('purchases.orderItems')}</Label>
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={addLine} className="h-8 gap-1 text-xs">
                    <Plus className="h-3.5 w-3.5" /> {t('purchases.addLine')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const idx = lineItems.length;
                      setLineItems((prev) => [...prev, emptyLine()]);
                      setNewProductLine(idx);
                    }}
                    className="h-8 gap-1 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('purchases.newProduct')}
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-h-0 rounded-xl border border-slate-200 overflow-hidden flex flex-col bg-slate-50/40">
                <div className="grid grid-cols-[1fr_72px_72px_88px_72px_80px_36px] gap-2 px-3 py-2 bg-slate-100/80 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shrink-0">
                  <span>{t('purchases.product')}</span>
                  <span className="text-center">Unit</span>
                  <span className="text-center">{t('purchases.qty')}</span>
                  <span className="text-right">{t('purchases.unitCost')}</span>
                  <span className="text-right">Base</span>
                  <span className="text-right">{t('purchases.lineTotal')}</span>
                  <span />
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-slate-100">
                  {lineItems.map((line, i) => {
                    const { baseQty, baseUnitCost } = computePurchaseLineBase(
                      line.quantity,
                      line.unit_cost,
                      line.conversion_factor,
                    );
                    return (
                    <div key={i} className="grid grid-cols-[1fr_72px_72px_88px_72px_80px_36px] gap-2 px-3 py-2 items-center bg-white">
                      <Select value={line.product_id || null} items={productSelectItems} onValueChange={(v) => v && updateLine(i, 'product_id', v)}>
                        <SelectTrigger className="h-8 w-full min-w-0 text-xs rounded-lg">
                          <SelectValue placeholder={t('purchases.selectProduct')} />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(() => {
                        const product = products.find((p) => p.id === line.product_id);
                        const puOptions = product ? getPurchaseUnitsForProduct(product) : [];
                        if (puOptions.length <= 1) {
                          return (
                            <span className="text-[10px] text-center font-medium text-slate-600 truncate" title={line.purchase_unit_code}>
                              {line.purchase_unit_code ?? '—'}
                            </span>
                          );
                        }
                        return (
                          <Select
                            value={line.purchase_unit_id ?? puOptions[0]?.unit_type_id ?? null}
                            onValueChange={(v) => v && updateLine(i, 'purchase_unit_id', v)}
                          >
                            <SelectTrigger className="h-8 text-[10px] px-1 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {puOptions.map((u) => (
                                <SelectItem key={u.unit_type_id} value={u.unit_type_id} className="text-xs">
                                  {u.unit_type?.code ?? '?'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      })()}
                      <Input
                        type="number"
                        min={line.allows_decimal ? 0.001 : 1}
                        step={line.allows_decimal ? 'any' : 1}
                        value={line.quantity}
                        onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
                        className="h-8 text-xs text-center px-1"
                      />
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.unit_cost}
                        onChange={(e) => updateLine(i, 'unit_cost', Number(e.target.value))}
                        className="h-8 text-xs text-right px-2"
                      />
                      <span className="text-[10px] text-right text-emerald-700 tabular-nums" title={`${baseUnitCost.toFixed(4)}/base`}>
                        {baseQty}
                      </span>
                      <span className="text-xs font-semibold text-slate-700 text-right tabular-nums">
                        {fmtC(line.quantity * line.unit_cost)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={lineItems.length === 1}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between px-3 py-2.5 border-t border-slate-200 bg-white shrink-0">
                  <span className="text-xs text-slate-500">{t('purchases.itemsCount', { count: lineItems.filter((l) => l.product_id).length })}</span>
                  <span className="text-sm font-bold text-slate-900">{t('purchases.totalLabel', { amount: fmtC(lineTotal) })}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 !mx-0 !mb-0 gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl sm:flex-row sm:justify-end">
            <Button variant="outline" className="h-9" onClick={() => { setShowNewPO(false); resetForm(); }}>{t('purchases.cancel')}</Button>
            <Button variant="outline" className="h-9" onClick={() => createPO(true)} disabled={creating}>
              <Minus className="h-4 w-4 mr-1" /> {t('purchases.saveAsDraft')}
            </Button>
            <Button
              onClick={() => createPO(false)}
              disabled={creating}
              className="h-9 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-200/40"
            >
              {creating ? t('purchases.creating') : t('purchases.submitOrder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New product for PO line — separate dialog keeps main form compact */}
      <Dialog open={newProductLine !== null} onOpenChange={(o) => !o && setNewProductLine(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('purchases.addNewProduct')}</DialogTitle>
          </DialogHeader>
          {newProductLine !== null && (
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label className="text-xs">{t('purchases.productNameReq')}</Label>
                <Input
                  placeholder={t('purchases.productName')}
                  value={newProductForm.name}
                  onChange={(e) => setNewProductForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('purchases.barcode')}</Label>
                <BarcodeScannerField
                  value={newProductForm.barcode}
                  onChange={(v) => setNewProductForm((f) => ({ ...f, barcode: v }))}
                  onScan={(v) => setNewProductForm((f) => ({ ...f, barcode: v }))}
                  placeholder={t('purchases.scanBarcode')}
                  closeCameraOnScan={false}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('purchases.sellingPrice')}</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={newProductForm.selling_price || ''}
                    onChange={(e) => setNewProductForm((f) => ({ ...f, selling_price: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('purchases.buyingPrice')}</Label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={lineItems[newProductLine]?.unit_cost || ''}
                    onChange={(e) => updateLine(newProductLine, 'unit_cost', Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNewProductLine(null)}>{t('purchases.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              disabled={creatingProduct || newProductLine === null}
              onClick={() => newProductLine !== null && createProductForLine(newProductLine)}
            >
              {creatingProduct ? t('purchases.creating') : t('purchases.createAttach')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick add supplier */}
      <Dialog open={showAddSupplier} onOpenChange={setShowAddSupplier}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-blue-600" />
              {t('purchases.addSupplierFull')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">{t('purchases.supplierNameReq')}</Label>
              <Input
                autoFocus
                placeholder={t('purchases.supplierNamePlaceholder')}
                value={newSupplierForm.name}
                onChange={(e) => setNewSupplierForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('purchases.phone')}</Label>
                <Input
                  placeholder={t('purchases.optional')}
                  value={newSupplierForm.phone}
                  onChange={(e) => setNewSupplierForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('purchases.contactPerson')}</Label>
                <Input
                  placeholder={t('purchases.optional')}
                  value={newSupplierForm.contact_person}
                  onChange={(e) => setNewSupplierForm((f) => ({ ...f, contact_person: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAddSupplier(false)}>{t('purchases.cancel')}</Button>
            <Button
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              disabled={creatingSupplier || !newSupplierForm.name.trim()}
              onClick={() => createSupplier()}
            >
              {creatingSupplier ? t('purchases.saving') : t('purchases.saveSelect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function PODetailPanel({
  po,
  poItems,
  suppliers,
  supplierSelectItems,
  fmtC,
  onReceive,
  onSupplierAssigned,
  onClose,
}: {
  po: POWithSupplier;
  poItems: PurchaseOrderItem[];
  suppliers: Supplier[];
  supplierSelectItems: ReturnType<typeof toSelectItems>;
  fmtC: (n: number) => string;
  onReceive: () => void;
  onSupplierAssigned: (po: POWithSupplier) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const statusClass = STATUS_CLASS[po.status];
  const balanceDue = po.total_amount - po.paid_amount;
  const canReceive = po.status === 'pending' || po.status === 'partial';
  const itemQty = poItems.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <SheetHeader className="shrink-0 px-5 pt-5 pb-3 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <SheetTitle className="text-base font-bold flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-blue-600 shrink-0" />
              <span className="truncate">{po.po_number}</span>
            </SheetTitle>
            <p className="text-xs text-slate-500 mt-1 truncate">
              {po.supplier?.name ?? t('purchases.noSupplierAssigned')}
            </p>
          </div>
          <div className="text-right shrink-0 space-y-1">
            <p className="text-lg font-bold text-slate-900 tabular-nums">{fmtC(po.total_amount)}</p>
            <Badge className={cn('text-[10px] border-0', statusClass)}>{t(`poStatus.${po.status}`)}</Badge>
          </div>
        </div>
      </SheetHeader>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 py-4 overflow-hidden">
        {/* Meta chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
          <MetaChip label={t('purchases.supplier')}>
            {po.supplier?.name ? (
              <span className="truncate">{po.supplier.name}</span>
            ) : po.supplier_id ? (
              <span className="text-slate-400">{t('purchases.unavailable')}</span>
            ) : (
              <Select
                items={supplierSelectItems}
                value={po.supplier_id ?? null}
                onValueChange={async (v) => {
                  if (!v) return;
                  const supabase = createClient();
                  const { error } = await supabase
                    .from('purchase_orders')
                    .update({ supplier_id: v })
                    .eq('id', po.id);
                  if (error) return toast.error(error.message);
                  const { po: fresh } = await fetchPODetails(po.id);
                  onSupplierAssigned(fresh);
                  toast.success(t('purchases.supplierAssigned'));
                }}
              >
                <SelectTrigger className="h-7 w-full text-xs mt-0.5">
                  <SelectValue placeholder={t('purchases.assign')} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </MetaChip>
          <MetaChip label={t('purchases.created')}>{format(new Date(po.created_at), 'MMM d, yyyy')}</MetaChip>
          <MetaChip label={t('purchases.expected')}>
            {po.expected_date ? format(new Date(po.expected_date), 'MMM d, yyyy') : '—'}
          </MetaChip>
          <MetaChip label={t('purchases.lines')}>{t('purchases.unitsLabel', { lines: poItems.length, units: itemQty })}</MetaChip>
        </div>

        {po.status === 'received' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
            <MetaChip label={t('purchases.received')}>
              {po.received_date ? format(new Date(po.received_date), 'MMM d, yyyy') : '—'}
            </MetaChip>
            <MetaChip label={t('purchases.due')}>
              {po.due_date ? format(new Date(po.due_date), 'MMM d, yyyy') : '—'}
            </MetaChip>
            <MetaChip label={t('purchases.paid')}>
              <span className="text-blue-600">{fmtC(po.paid_amount)}</span>
            </MetaChip>
            <MetaChip label={t('purchases.balanceAp')}>
              <span className={cn('font-semibold', balanceDue > 0 ? 'text-red-600' : 'text-slate-600')}>
                {fmtC(balanceDue)}
              </span>
            </MetaChip>
          </div>
        )}

        {po.notes && (
          <div className="shrink-0 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-900">
            {po.notes}
          </div>
        )}

        {/* Items table */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 overflow-hidden bg-slate-50/40">
          <div className="grid grid-cols-[1fr_52px_52px_56px_72px_80px] gap-2 px-3 py-2 bg-slate-100/80 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shrink-0">
            <span>{t('purchases.product')}</span>
            <span className="text-center">Unit</span>
            <span className="text-center">{t('purchases.qty')}</span>
            <span className="text-center">Base</span>
            <span className="text-right">{t('purchases.cost')}</span>
            <span className="text-right">{t('purchases.total')}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-slate-100">
            {poItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <Package className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-xs">{t('purchases.noLineItems')}</p>
              </div>
            ) : (
              poItems.map((item) => {
                const purchaseQty = item.purchase_unit_qty ?? item.quantity;
                const baseQty = item.base_qty ?? item.quantity;
                return (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_52px_52px_56px_72px_80px] gap-2 px-3 py-2.5 items-center bg-white text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-900 truncate text-xs sm:text-sm">
                      {item.product_name}
                    </span>
                  </div>
                  <span className="text-center text-[10px] font-medium text-slate-500 uppercase truncate" title={item.purchase_unit_code}>
                    {item.purchase_unit_code ?? '—'}
                  </span>
                  <span className="text-center text-xs text-slate-600 tabular-nums">{purchaseQty}</span>
                  <span className="text-center text-xs text-slate-400 tabular-nums">{baseQty}</span>
                  <span className="text-right text-xs text-slate-500 tabular-nums">{fmtC(item.unit_cost)}</span>
                  <span className="text-right text-xs font-semibold text-slate-900 tabular-nums">
                    {fmtC(item.subtotal)}
                  </span>
                </div>
              );})
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur px-5 py-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{t('purchases.subtotal')}</span>
          <span className="tabular-nums">{fmtC(po.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-base font-bold">
          <span>{t('purchases.total')}</span>
          <span className="tabular-nums text-slate-900">{fmtC(po.total_amount)}</span>
        </div>

        {po.status === 'received' && balanceDue > 0 && (
          <Button
            variant="outline"
            className="w-full h-10 border-blue-200 text-blue-700 hover:bg-blue-50"
            onClick={() => { window.location.href = '/dashboard/debts'; }}
          >
            {t('purchases.manageSupplierPayable')}
          </Button>
        )}

        {canReceive && (
          <Button
            onClick={onReceive}
            className="w-full h-10 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 gap-2 shadow-md shadow-blue-200/30"
          >
            <CheckCircle className="h-4 w-4" />
            {t('purchases.receiveCheckout')}
          </Button>
        )}

        <Button variant="ghost" className="w-full h-9 text-slate-600" onClick={onClose}>
          {t('purchases.close')}
        </Button>
      </div>
    </div>
  );
}

function MetaChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 truncate">{label}</p>
      <div className="text-xs font-medium text-slate-800 mt-0.5 truncate">{children}</div>
    </div>
  );
}
