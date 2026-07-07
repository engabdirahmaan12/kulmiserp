'use client';

import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell } from '@/components/layout/PageShell';
import { btnSuccess } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InvoiceDocument } from '@/components/invoice/InvoiceDocument';
import {
  FileText,
  Plus,
  Trash2,
  Search,
  CheckCircle2,
  Save,
  Eye,
  Package,
  X,
} from 'lucide-react';
import type { Customer, PaymentMethod, Product, SaleItem } from '@/types';
import { computeDiscountedPrice, type ActiveDiscount } from '@/types';
import type { InvoiceData } from '@/lib/invoice-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  dbSaleItemToSaleLine,
  defaultSalePriceForProduct,
  lineBaseQty,
  pickDefaultSaleUnit,
  repriceSaleLineUnit,
  saleLineToDraftRow,
  saleLineToRpcPayload,
  type SaleLineCore,
} from '@/lib/units/engine';
import type { PriceTier } from '@/lib/units/conversion';
import { getPosAllowPriceOverride } from '@/lib/pos/pricing';
import { usePermission } from '@/lib/hooks/usePermission';
import { useStorePaymentMethods } from '@/lib/hooks/useStorePaymentMethods';
import { InvoiceLineUnitSelect } from '@/components/sales/InvoiceLineUnitSelect';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LineItem {
  id: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  sale_unit_id?: string;
  sale_unit_code?: string;
  conversion_factor?: number;
  base_qty?: number;
  cost_price?: number;
  price_tier?: PriceTier;
  /** Set when a manual price override was applied — audit trail. */
  original_unit_price?: number | null;
  price_override_reason?: string | null;
}

function newLineItem(): LineItem {
  return {
    id: crypto.randomUUID(),
    description: '',
    quantity: 1,
    unit_price: 0,
    discount_pct: 0,
    tax_pct: 0,
    conversion_factor: 1,
    base_qty: 1,
  };
}

function lineItemToSaleCore(item: LineItem, overriddenByUserId: string | null = null): SaleLineCore {
  const conv = item.conversion_factor ?? 1;
  const saleQty = item.quantity;
  const { discountAmt, taxAmt } = computeItemTotals(item);
  const base = item.base_qty ?? lineBaseQty(saleQty, conv);
  const lineNet = item.unit_price * saleQty - discountAmt;
  return {
    product_id: item.product_id,
    product_name: item.description,
    sale_unit_qty: saleQty,
    base_qty: base,
    sale_unit_id: item.sale_unit_id ?? null,
    sale_unit_code: item.sale_unit_code ?? null,
    conversion_factor: conv,
    unit_price: item.unit_price,
    cost_price: item.cost_price ?? 0,
    discount_amount: discountAmt,
    tax_amount: taxAmt,
    subtotal: lineNet + taxAmt,
    price_tier: item.price_tier ?? 'retail',
    original_unit_price: item.original_unit_price ?? null,
    price_override_reason: item.price_override_reason ?? null,
    price_overridden_by: item.price_override_reason ? overriddenByUserId : null,
  };
}

function computeItemTotals(item: LineItem) {
  const gross = item.quantity * item.unit_price;
  const discountAmt = gross * (item.discount_pct / 100);
  const afterDiscount = gross - discountAmt;
  const taxAmt = afterDiscount * (item.tax_pct / 100);
  const subtotal = afterDiscount + taxAmt;
  return { gross, discountAmt, taxAmt, subtotal };
}

function fmtCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

const DEFAULT_PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'waafi', label: 'WAAFI' },
  { value: 'evc', label: 'EVC' },
  { value: 'sahal', label: 'SAHAL' },
  { value: 'zaad', label: 'ZAAD' },
  { value: 'credit', label: 'Credit' },
];

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchCustomers(storeId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('id, store_id, full_name, phone, email, balance, credit_limit, total_purchases, address, notes, is_active, created_at, updated_at')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('full_name');
  if (error) throw error;
  return data as Customer[];
}

type ProductRow = Product & {
  active_discount?: ActiveDiscount | null;
  category?: { name: string } | null;
};

async function fetchProducts(storeId: string): Promise<ProductRow[]> {
  const supabase = createClient();
  const [{ data, error }, { data: discounts }] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:product_categories(name), product_units(*, unit_type:unit_types(*))')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('name'),
    supabase.rpc('get_store_active_discounts', { p_store_id: storeId }),
  ]);
  if (error) throw error;
  const discountMap: Record<string, ActiveDiscount> = {};
  if (discounts && Array.isArray(discounts)) {
    for (const d of (discounts as Array<{ product_id: string; discount_type: 'percentage' | 'fixed'; discount_value: number; source?: string; status?: string }>)) {
      if (d.product_id) discountMap[d.product_id] = { discount_type: d.discount_type, discount_value: d.discount_value, source: d.source, status: d.status };
    }
  }
  return (data ?? []).map((p) => ({
    ...p,
    active_discount: discountMap[p.id] ?? null,
    category: Array.isArray(p.category) ? (p.category[0] ?? null) : (p.category ?? null),
  }));
}

async function fetchCategories(storeId: string) {
  const supabase = createClient();
  const { data } = await supabase.from('product_categories').select('id, name').eq('store_id', storeId).order('name');
  return (data ?? []) as { id: string; name: string }[];
}

async function generateInvoiceNumber(storeId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('stores')
    .select('invoice_prefix, invoice_counter')
    .eq('id', storeId)
    .single();
  if (error) throw error;
  const { invoice_prefix, invoice_counter } = data;
  return `${invoice_prefix}${String((invoice_counter ?? 0) + 1).padStart(5, '0')}`;
}

interface SaveSalePayload {
  storeId: string;
  userId: string;
  customer: Customer | null;
  invoiceNumber: string;
  saleDate: string;
  items: LineItem[];
  notes: string;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  status: 'draft' | 'completed';
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

async function saveSale(payload: SaveSalePayload) {
  const supabase = createClient();
  const {
    storeId, userId, customer, invoiceNumber, saleDate,
    items, notes, paymentMethod, paidAmount, status,
    subtotal, discountTotal, taxTotal, total,
  } = payload;

  if (status === 'completed') {
    const lineItems = items
      .filter((it) => it.description.trim())
      .map((it) => saleLineToRpcPayload(lineItemToSaleCore(it, userId)));

    const creditAmount = paidAmount < total ? total - paidAmount : 0;
    const { data, error } = await supabase.rpc('complete_custom_sale', {
      p_store_id: storeId,
      p_user_id: userId,
      p_customer_id: customer?.id ?? null,
      p_items: lineItems,
      p_subtotal: subtotal,
      p_discount_amount: discountTotal,
      p_tax_amount: taxTotal,
      p_total_amount: total,
      p_paid_amount: paidAmount,
      p_credit_amount: creditAmount,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
      p_sale_date: saleDate,
    });
    if (error) throw error;
    const result = data as { success?: boolean; error?: string; sale_id?: string; invoice_number?: string };
    if (!result?.success) throw new Error(result?.error || 'Failed to complete sale');
    return result.sale_id!;
  }

  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .insert({
      store_id: storeId,
      invoice_number: invoiceNumber,
      customer_id: customer?.id ?? null,
      cashier_id: userId,
      status,
      subtotal,
      discount_amount: discountTotal,
      discount_type: 'fixed',
      tax_amount: taxTotal,
      total_amount: total,
      paid_amount: paidAmount,
      change_amount: Math.max(0, paidAmount - total),
      credit_amount: 0,
      payment_method: paymentMethod,
      payment_details: [{ method: paymentMethod, amount: paidAmount }],
      notes,
      is_offline: false,
      sale_date: saleDate,
    })
    .select('id')
    .single();
  if (saleErr) throw saleErr;

  const saleItems = items
    .filter((it) => it.description.trim())
    .map((it) => saleLineToDraftRow(storeId, sale.id, lineItemToSaleCore(it, userId)));

  if (saleItems.length > 0) {
    const { error: itemsErr } = await supabase.from('sale_items').insert(saleItems);
    if (itemsErr) throw itemsErr;
  }
  return sale.id;
}

async function fetchDraftSale(draftId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales')
    .select('*, items:sale_items(*)')
    .eq('id', draftId)
    .single();
  if (error) throw error;
  return data as { id: string; invoice_number: string; notes: string | null; sale_date: string; customer_id: string | null; items: SaleItem[] };
}

function saleLineToLineItem(row: SaleItem): LineItem {
  const core = dbSaleItemToSaleLine(row);
  const gross = core.unit_price * core.sale_unit_qty;
  const discountPct = gross > 0 ? (core.discount_amount / gross) * 100 : 0;
  const afterDisc = gross - core.discount_amount;
  const taxPct = afterDisc > 0 ? (core.tax_amount / afterDisc) * 100 : 0;
  return {
    id: row.id ?? crypto.randomUUID(),
    product_id: core.product_id,
    description: core.product_name,
    quantity: core.sale_unit_qty,
    unit_price: core.unit_price,
    discount_pct: parseFloat(discountPct.toFixed(4)),
    tax_pct: parseFloat(taxPct.toFixed(4)),
    sale_unit_id: core.sale_unit_id ?? undefined,
    sale_unit_code: core.sale_unit_code ?? undefined,
    conversion_factor: core.conversion_factor,
    base_qty: core.base_qty,
    cost_price: core.cost_price,
  };
}

// ─── Product Search Row ───────────────────────────────────────────────────────

interface ProductSearchCellProps {
  item: LineItem;
  products: ProductRow[];
  storeDefaultTax: number;
  tier: PriceTier;
  onChange: (id: string, patch: Partial<LineItem>) => void;
  onOpenQuickAdd: () => void;
}

function ProductSearchCell({ item, products, storeDefaultTax, tier, onChange, onOpenQuickAdd }: ProductSearchCellProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return products.slice(0, 8);
    const q = search.toLowerCase();
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku?.toLowerCase().includes(q) ?? false) ||
        (p.barcode?.toLowerCase().includes(q) ?? false) ||
        (p.brand?.toLowerCase().includes(q) ?? false) ||
        (p.category?.name?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 10);
  }, [products, search]);

  const selectProduct = (p: ProductRow) => {
    const defaultUnit = pickDefaultSaleUnit(p);
    let unitPrice = defaultSalePriceForProduct(p, tier);
    let discountPct = 0;
    if (p.active_discount) {
      if (p.active_discount.discount_type === 'percentage') {
        discountPct = p.active_discount.discount_value;
      } else if (unitPrice > 0) {
        discountPct = (p.active_discount.discount_value / unitPrice) * 100;
      }
      unitPrice = computeDiscountedPrice(unitPrice, p.active_discount).discountedPrice;
    }
    const conv = defaultUnit?.conversion_factor ?? 1;
    onChange(item.id, {
      product_id: p.id,
      description: p.name,
      unit_price: unitPrice,
      cost_price: p.cost_price,
      tax_pct: p.is_taxable ? p.tax_rate : 0,
      discount_pct: parseFloat(discountPct.toFixed(4)),
      sale_unit_id: defaultUnit?.unit_type_id,
      sale_unit_code: defaultUnit?.unit_type?.code,
      conversion_factor: conv,
      base_qty: lineBaseQty(1, conv),
      quantity: 1,
      price_tier: tier,
    });
    setSearch('');
    setOpen(false);
  };

  const clear = () => {
    onChange(item.id, { product_id: undefined, description: '' });
    setSearch('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div className="relative">
      {item.product_id && item.description ? (
        <div className="flex items-center gap-1.5 h-8 border rounded-md px-2 bg-blue-50 border-blue-200">
          <Package className="h-3 w-3 text-blue-500 shrink-0" />
          <span className="text-sm text-blue-800 flex-1 truncate">{item.description}</span>
          <button type="button" onClick={clear} className="text-blue-400 hover:text-blue-700">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder={t('customSales.searchProductOrType')}
              value={search || item.description}
              onChange={(e) => {
                const v = e.target.value;
                setSearch(v);
                onChange(item.id, { description: v, product_id: undefined });
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 200)}
              className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
          </div>
          {open && (
            <div className="absolute top-full left-0 z-30 mt-1 w-64 min-w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-400">{t('customSales.noProductsFound')}</div>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={() => selectProduct(p)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                  >
                    <Package className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {[p.category?.name, p.brand, p.sku].filter(Boolean).join(' · ') || t('customSales.sku')}
                      </p>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      {p.active_discount ? (
                        <>
                          <span className="text-xs font-semibold text-emerald-600">
                            {fmtCurrency(computeDiscountedPrice(p.selling_price, p.active_discount).discountedPrice)}
                          </span>
                          <span className="text-[10px] text-slate-400 line-through">{fmtCurrency(p.selling_price)}</span>
                        </>
                      ) : (
                        <span className="text-xs font-semibold text-teal-600">
                          {fmtCurrency(defaultSalePriceForProduct(p, tier))}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
              <button
                type="button"
                onMouseDown={onOpenQuickAdd}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50 border-t border-slate-100 font-medium"
              >
                <Plus className="h-4 w-4" /> {t('customSales.addNewProduct')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Quick Add Product Modal ───────────────────────────────────────────────────

interface QuickAddProductProps {
  open: boolean;
  onClose: () => void;
  storeId: string;
  onCreated: (product: ProductRow) => void;
  categories: { id: string; name: string }[];
}

function QuickAddProductModal({ open, onClose, storeId, onCreated, categories }: QuickAddProductProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', cost_price: '', selling_price: '', barcode: '', sku: '', category_id: '', brand: '', unit: 'pcs' });

  const { mutate: create, isPending } = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Product name required');
      const sell = parseFloat(form.selling_price);
      if (isNaN(sell) || sell <= 0) throw new Error('Selling price required');
      const supabase = createClient();
      const { data, error } = await supabase
        .from('products')
        .insert({
          store_id: storeId,
          name: form.name.trim(),
          cost_price: parseFloat(form.cost_price) || 0,
          selling_price: sell,
          barcode: form.barcode.trim() || null,
          sku: form.sku.trim() || null,
          category_id: form.category_id || null,
          brand: form.brand.trim() || null,
          unit: form.unit || 'pcs',
          is_active: true,
          track_inventory: false,
          stock_quantity: 0,
          min_stock_level: 0,
          reorder_point: 0,
          tax_rate: 0,
          is_taxable: false,
          variants: [],
        })
        .select('id, name, sku, selling_price, cost_price, unit, tax_rate, is_taxable, is_active, category_id, stock_quantity, brand, category:product_categories(name)')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['custom-sale-products', storeId] });
      const { category, ...rest } = data as typeof data & { category?: { name: string }[] };
      onCreated({ ...rest, category: Array.isArray(category) ? (category[0] ?? null) : (category ?? null) } as ProductRow);
      toast.success(t('customSales.productAdded', { name: form.name }));
      onClose();
      setForm({ name: '', cost_price: '', selling_price: '', barcode: '', sku: '', category_id: '', brand: '', unit: 'pcs' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" /> {t('customSales.quickAddProduct')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('customSales.productName')} *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('customSales.productNamePlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('customSales.costPrice')}</Label>
              <Input type="number" min={0} step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{t('customSales.sellingPrice')} *</Label>
              <Input type="number" min={0} step="0.01" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('customSales.sku')}</Label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{t('customSales.barcode')}</Label>
              <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('customSales.category')}</Label>
              <Select value={form.category_id} onValueChange={(v) => v && setForm({ ...form, category_id: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder={t('customSales.none')} /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('customSales.brand')}</Label>
              <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder={t('customSales.optional')} />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t('customSales.unit')}</Label>
            <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('customSales.cancel')}</Button>
          <Button onClick={() => create()} disabled={isPending} className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            {isPending ? t('customSales.adding') : t('customSales.addProduct')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function CustomSalesPage() {
  const router = useRouter();
  const { currentStore, user } = useAuthStore();
  const { role } = usePermission();
  const { t } = useTranslation();
  const canOverridePrice =
    getPosAllowPriceOverride((currentStore?.settings ?? {}) as Record<string, unknown>) &&
    (role === 'owner' || role === 'manager');
  const currency = currentStore?.currency || 'USD';

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [items, setItems] = useState<LineItem[]>([newLineItem()]);
  const [cartTier, setCartTier] = useState<PriceTier>('retail');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial' | 'credit'>('full');
  const [paidAmount, setPaidAmount] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', currentStore?.id],
    queryFn: () => fetchCustomers(currentStore!.id),
    enabled: !!currentStore,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['custom-sale-products', currentStore?.id],
    queryFn: () => fetchProducts(currentStore!.id),
    enabled: !!currentStore,
    staleTime: 60_000,
  });

  const { data: storePaymentMethods = [] } = useStorePaymentMethods();
  const paymentMethods = useMemo(() => {
    const dynamic = storePaymentMethods
      .filter((m) => m.slug !== 'customer_deposit')
      .map((m) => ({ value: m.slug as PaymentMethod, label: m.label }));
    const seen = new Set(dynamic.map((m) => m.value));
    const merged = [...dynamic];
    for (const m of DEFAULT_PAYMENT_METHODS) {
      if (!seen.has(m.value)) merged.push(m);
    }
    return merged;
  }, [storePaymentMethods]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  useEffect(() => {
    const resumeId = sessionStorage.getItem('resume_custom_draft_id');
    if (!resumeId || !currentStore) return;
    sessionStorage.removeItem('resume_custom_draft_id');
    fetchDraftSale(resumeId)
      .then((draft) => {
        setDraftId(draft.id);
        setNotes(draft.notes ?? '');
        setSaleDate(draft.sale_date?.split('T')[0] ?? new Date().toISOString().split('T')[0]);
        const lines = (draft.items ?? []).map(saleLineToLineItem);
        if (lines.length > 0) setItems(lines);
        if (draft.customer_id) {
          const c = customers.find((x) => x.id === draft.customer_id);
          if (c) setSelectedCustomer(c);
        }
        toast.success('Draft loaded');
      })
      .catch(() => toast.error('Failed to load draft'));
  }, [currentStore, customers]);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories-simple', currentStore?.id],
    queryFn: () => fetchCategories(currentStore!.id),
    enabled: !!currentStore,
  });

  const { data: invoiceNumber = '' } = useQuery({
    queryKey: ['invoice-number', currentStore?.id],
    queryFn: () => generateInvoiceNumber(currentStore!.id),
    enabled: !!currentStore,
    staleTime: 0,
  });

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 8);
    return customers
      .filter(
        (c) =>
          c.full_name.toLowerCase().includes(customerSearch.toLowerCase()) ||
          c.phone?.includes(customerSearch)
      )
      .slice(0, 8);
  }, [customers, customerSearch]);

  const totals = useMemo(() => {
    let subtotal = 0, discountTotal = 0, taxTotal = 0, total = 0;
    for (const item of items) {
      const { gross, discountAmt, taxAmt, subtotal: itSubtotal } = computeItemTotals(item);
      subtotal += gross - discountAmt;
      discountTotal += discountAmt;
      taxTotal += taxAmt;
      total += itSubtotal;
    }
    return { subtotal, discountTotal, taxTotal, total };
  }, [items]);

  const saveMutation = useMutation({
    mutationFn: (status: 'draft' | 'completed') => {
      if (status === 'completed') {
        for (const it of items) {
          if (!it.product_id) continue;
          const p = productMap.get(it.product_id);
          const need = it.base_qty ?? lineBaseQty(it.quantity, it.conversion_factor ?? 1);
          if (p?.track_inventory && need > p.stock_quantity) {
            throw new Error(`Insufficient stock for ${p.name} (need ${need} base units, have ${p.stock_quantity})`);
          }
        }
        if ((paymentMode === 'credit' || paymentMode === 'partial') && !selectedCustomer) {
          throw new Error('Customer required for partial or credit sales');
        }
      }
      const effectivePaid =
        paymentMode === 'credit' ? 0
          : paymentMode === 'full' ? totals.total
            : Math.min(parseFloat(paidAmount) || 0, totals.total);
      const effectiveMethod = paymentMode === 'credit' ? 'credit' as PaymentMethod : paymentMethod;
      return saveSale({
        storeId: currentStore!.id,
        userId: user!.id,
        customer: selectedCustomer,
        invoiceNumber,
        saleDate: new Date(saleDate).toISOString(),
        items,
        notes,
        paymentMethod: effectiveMethod,
        paidAmount: effectivePaid,
        status,
        ...totals,
      });
    },
    onSuccess: (_, status) => {
      if (status === 'completed') {
        toast.success(t('customSales.saleCompleted'));
        router.push('/dashboard/sales-history');
      } else {
        toast.success(t('customSales.draftSaved'));
        router.push('/dashboard/drafts');
      }
    },
    onError: (err) => toast.error(t('customSales.failedToSave', { error: (err as Error).message })),
  });

  const updateItem = useCallback((id: string, patch: Partial<LineItem>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        if (patch.quantity !== undefined || patch.conversion_factor !== undefined) {
          next.base_qty = lineBaseQty(next.quantity, next.conversion_factor ?? 1);
        }
        return next;
      }),
    );
  }, []);

  const handleUnitChange = useCallback((itemId: string, unitTypeId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId || !it.product_id) return it;
        const product = productMap.get(it.product_id);
        if (!product) return it;
        const gross = it.unit_price * it.quantity;
        const discountAmt = gross * (it.discount_pct / 100);
        const tier = it.price_tier ?? 'retail';
        const repriced = repriceSaleLineUnit(
          product,
          {
            sale_unit_id: unitTypeId,
            sale_unit_qty: it.quantity,
            discount_amount: discountAmt,
            price_tier: tier,
          },
          tier,
        );
        if (!repriced) return it;
        return {
          ...it,
          sale_unit_id: repriced.sale_unit_id ?? unitTypeId,
          sale_unit_code: repriced.sale_unit_code ?? undefined,
          conversion_factor: repriced.conversion_factor,
          base_qty: repriced.base_qty,
          unit_price: repriced.unit_price ?? it.unit_price,
          cost_price: repriced.cost_price ?? it.cost_price,
        };
      }),
    );
  }, [productMap]);

  // Cart-level Retail/Wholesale switch — one tap reprices every product line.
  const changeCartTier = (tier: PriceTier) => {
    setCartTier(tier);
    setItems((prev) =>
      prev.map((it) => {
        if (!it.product_id) return { ...it, price_tier: tier };
        const product = productMap.get(it.product_id);
        if (!product) return { ...it, price_tier: tier };
        const gross = it.unit_price * it.quantity;
        const discountAmt = gross * (it.discount_pct / 100);
        const repriced = repriceSaleLineUnit(
          product,
          { sale_unit_id: it.sale_unit_id ?? null, sale_unit_qty: it.quantity, discount_amount: discountAmt, price_tier: tier },
          tier,
        );
        if (!repriced) return { ...it, price_tier: tier };
        return {
          ...it,
          price_tier: tier,
          unit_price: repriced.unit_price ?? it.unit_price,
          cost_price: repriced.cost_price ?? it.cost_price,
          sale_unit_code: repriced.sale_unit_code ?? it.sale_unit_code,
          conversion_factor: repriced.conversion_factor ?? it.conversion_factor,
          base_qty: repriced.base_qty ?? it.base_qty,
          original_unit_price: null,
          price_override_reason: null,
        };
      }),
    );
  };

  // Select/clear a customer and pre-set the tier from their price level (new lines use it).
  const applyCustomer = (c: Customer | null) => {
    setSelectedCustomer(c);
    const tier =
      (c?.price_tier as PriceTier)
      ?? ((currentStore?.settings as Record<string, unknown>)?.default_price_tier as PriceTier)
      ?? 'retail';
    setCartTier(tier);
  };

  const removeItem = useCallback((id: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  }, []);

  const addItem = () => setItems((prev) => [...prev, newLineItem()]);

  const canSave = items.some((it) => it.description.trim() && it.unit_price > 0);

  // Build invoice preview data
  const previewData: InvoiceData = {
    type: 'custom',
    invoice_number: invoiceNumber || 'INV-00001',
    store_id: currentStore?.id,
    store_name: currentStore?.name || 'Store',
    store_address: currentStore?.address,
    store_phone: currentStore?.phone,
    store_email: currentStore?.email,
    logo_url: currentStore?.logo_url,
    tax_number: (currentStore?.settings as Record<string, unknown>)?.tax_number as string | undefined,
    footer_message: (currentStore?.settings as Record<string, unknown>)?.invoice_footer as string | undefined,
    terms_and_conditions: (currentStore?.settings as Record<string, unknown>)?.invoice_terms as string | undefined,
    currency,
    date: new Date(saleDate).toISOString(),
    customer_name: selectedCustomer?.full_name,
    customer_phone: selectedCustomer?.phone,
    items: items
      .filter((it) => it.description.trim())
      .map((it) => {
        const { discountAmt, taxAmt, subtotal } = computeItemTotals(it);
        return {
          name: it.description,
          quantity: it.quantity,
          unit_code: it.sale_unit_code,
          base_qty: it.base_qty ?? lineBaseQty(it.quantity, it.conversion_factor ?? 1),
          unit_price: it.unit_price,
          discount_amount: discountAmt,
          tax_amount: taxAmt,
          subtotal,
          price_tier: it.price_tier,
          is_custom_price: it.original_unit_price != null,
        };
      }),
    subtotal: totals.subtotal,
    discount_amount: totals.discountTotal,
    tax_amount: totals.taxTotal,
    total_amount: totals.total,
    paid_amount: parseFloat(paidAmount) || totals.total,
    credit_amount: Math.max(0, totals.total - (parseFloat(paidAmount) || totals.total)),
    notes,
    payment_method: paymentMethod,
  };

  return (
    <PageShell>
      <PageHeader
        title={t('customSales.title')}
        description={t('customSales.description')}
        icon={FileText}
        variant="banner"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-9 bg-white/20 hover:bg-white/30 border-white/30 text-white shadow-none"
            onClick={() => setShowPreview(true)}
            disabled={!canSave}
          >
            <Eye className="h-4 w-4" /> {t('customSales.previewInvoice')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left: Builder ── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Customer + Date */}
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">{t('customSales.invoiceDetails')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Customer Search */}
              <div className="relative">
                <Label className="text-xs text-slate-500 mb-1.5 block">{t('customSales.customerOptional')}</Label>
                {selectedCustomer ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                      {selectedCustomer.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{selectedCustomer.full_name}</p>
                      {selectedCustomer.phone && <p className="text-xs text-slate-400">{selectedCustomer.phone}</p>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => applyCustomer(null)}>
                      <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder={t('customSales.searchCustomers')}
                      value={customerSearch}
                      onChange={(e) => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                      className="pl-9 h-9"
                    />
                    {showCustomerDropdown && filteredCustomers.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                        {filteredCustomers.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 transition-colors"
                            onMouseDown={() => { applyCustomer(c); setCustomerSearch(''); setShowCustomerDropdown(false); }}
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                              {c.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{c.full_name}</p>
                              {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Invoice Date */}
              <div>
                <Label className="text-xs text-slate-500 mb-1.5 block">{t('customSales.invoiceDate')}</Label>
                <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="h-9" />
              </div>
            </div>

            {/* Retail / Wholesale switch — one tap reprices every product line. */}
            <div>
              <Label className="text-xs text-slate-500 mb-1.5 block">{t('customSales.priceLevel')}</Label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 max-w-xs">
                {(['retail', 'wholesale'] as const).map((tier) => {
                  const active = cartTier === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => changeCartTier(tier)}
                      className={cn(
                        'rounded-lg py-2 text-sm font-semibold transition-all',
                        active
                          ? tier === 'wholesale'
                            ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm'
                            : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white/70',
                      )}
                    >
                      {tier === 'retail' ? t('pos.priceRetail') : t('pos.priceWholesale')}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">{t('customSales.lineItems')}</h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setShowQuickAdd(true)}>
                  <Plus className="h-3.5 w-3.5" /> {t('customSales.newProduct')}
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5" /> {t('customSales.addLine')}
                </Button>
              </div>
            </div>

            {/* Header row */}
            <div className="hidden md:grid grid-cols-[2fr_80px_70px_90px_70px_70px_80px_36px] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-400 uppercase">
              <span>{t('customSales.productDescription')}</span>
              <span className="text-center">Unit</span>
              <span className="text-center">{t('customSales.qty')}</span>
              <span className="text-right">{t('customSales.unitPrice')}</span>
              <span className="text-right">{t('customSales.discPct')}</span>
              <span className="text-right">{t('customSales.taxPct')}</span>
              <span className="text-right">{t('customSales.subtotal')}</span>
              <span />
            </div>

            <div className="divide-y divide-slate-100">
              {items.map((item, idx) => {
                const { subtotal } = computeItemTotals(item);
                const product = item.product_id ? productMap.get(item.product_id) : undefined;
                const tier = item.price_tier ?? 'retail';
                const expectedPrice = product
                  ? repriceSaleLineUnit(
                      product,
                      { sale_unit_id: item.sale_unit_id, sale_unit_qty: item.quantity || 1, discount_amount: 0, price_tier: tier },
                      tier,
                    )?.unit_price ?? null
                  : null;
                const isOverriding = expectedPrice != null && Math.abs((item.unit_price || 0) - expectedPrice) > 0.0001;

                return (
                  <Fragment key={item.id}>
                    <div
                      className="grid grid-cols-1 md:grid-cols-[2fr_80px_70px_90px_70px_70px_80px_36px] gap-2 px-4 py-3 items-center"
                    >
                      <div className="md:hidden text-xs text-slate-400 font-medium mb-1">{t('customSales.itemN', { n: idx + 1 })}</div>

                      {/* Product search */}
                      <ProductSearchCell
                        item={item}
                        products={products}
                        storeDefaultTax={currentStore?.tax_rate ?? 0}
                        tier={cartTier}
                        onChange={updateItem}
                        onOpenQuickAdd={() => setShowQuickAdd(true)}
                      />

                      <div className="flex justify-center">
                        {item.product_id && productMap.get(item.product_id) ? (
                          <InvoiceLineUnitSelect
                            product={productMap.get(item.product_id)!}
                            value={item.sale_unit_id}
                            onChange={(unitId) => handleUnitChange(item.id, unitId)}
                            compact
                          />
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </div>

                      <Input
                        type="number" min="0.01" step="0.01" placeholder="Qty"
                        value={item.quantity || ''}
                        onChange={(e) => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm text-center"
                      />
                      <Input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={item.unit_price || ''}
                        onChange={(e) => {
                          const price = parseFloat(e.target.value) || 0;
                          const stillOverriding = expectedPrice != null && Math.abs(price - expectedPrice) > 0.0001;
                          updateItem(item.id, {
                            unit_price: price,
                            ...(stillOverriding
                              ? {}
                              : { original_unit_price: null, price_override_reason: null }),
                          });
                        }}
                        disabled={!!product && isOverriding && !canOverridePrice}
                        className={cn('h-8 text-sm text-right', isOverriding && canOverridePrice && 'border-amber-400')}
                      />
                      <Input
                        type="number" min="0" max="100" placeholder="0"
                        value={item.discount_pct || ''}
                        onChange={(e) => updateItem(item.id, { discount_pct: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm text-right"
                      />
                      <Input
                        type="number" min="0" max="100" placeholder="0"
                        value={item.tax_pct || ''}
                        onChange={(e) => updateItem(item.id, { tax_pct: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-sm text-right"
                      />
                      <div className="h-8 flex items-center justify-end text-sm font-medium text-slate-700">
                        {fmtCurrency(subtotal, currency)}
                      </div>
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50"
                        onClick={() => removeItem(item.id)}
                        disabled={items.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {isOverriding && (
                      <div className="px-4 pb-3 -mt-1">
                        {canOverridePrice ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1.5">
                            <p className="text-[11px] font-medium text-amber-800">
                              Price overridden — system price is {fmtCurrency(expectedPrice ?? 0, currency)}
                            </p>
                            <Input
                              value={item.price_override_reason ?? ''}
                              onChange={(e) => updateItem(item.id, {
                                original_unit_price: expectedPrice,
                                price_override_reason: e.target.value,
                              })}
                              placeholder="Reason for this price change…"
                              className="h-8 text-xs bg-white"
                            />
                          </div>
                        ) : (
                          <p className="text-[11px] text-red-600">
                            This price differs from the system price ({fmtCurrency(expectedPrice ?? 0, currency)}) —
                            only owners/managers can override it. Ask them, or enable it in Settings.
                          </p>
                        )}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>

            <div className="px-4 py-3 border-t border-slate-100">
              <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1.5 text-xs h-8" onClick={addItem}>
                <Plus className="h-3.5 w-3.5" /> {t('customSales.addAnotherItem')}
              </Button>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4">
            <Label className="text-xs text-slate-500 mb-1.5 block">{t('customSales.notesOptional')}</Label>
            <Textarea
              placeholder={t('customSales.notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none text-sm"
              rows={3}
            />
          </div>
        </div>

        {/* ── Right: Summary ── */}
        <div className="lg:col-span-1 mt-5 lg:mt-0">
          <div className="sticky top-20 rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-4 text-white text-center">
              <p className="font-bold text-base">{currentStore?.name || t('customSales.storeName')}</p>
              <p className="text-blue-200 text-xs mt-0.5">{t('customSales.invoiceLabel', { num: invoiceNumber || 'INV-00001' })}</p>
              <p className="text-blue-200 text-xs">
                {new Date(saleDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
              {selectedCustomer && (
                <Badge className="mt-2 bg-white/20 text-white border-0 text-xs">{selectedCustomer.full_name}</Badge>
              )}
            </div>

            <div className="p-4 space-y-4">
              {/* Items Summary */}
              <div className="space-y-1.5">
                {items.filter((it) => it.description.trim()).map((item) => {
                  const { subtotal } = computeItemTotals(item);
                  return (
                    <div key={item.id} className="flex justify-between text-xs text-slate-600">
                      <span className="truncate max-w-[60%]">
                        {item.description} <span className="text-slate-400">×{item.quantity}</span>
                      </span>
                      <span className="font-medium shrink-0">{fmtCurrency(subtotal, currency)}</span>
                    </div>
                  );
                })}
                {!items.some((it) => it.description.trim()) && (
                  <p className="text-xs text-slate-400 italic text-center py-2">{t('customSales.addItemsToPreview')}</p>
                )}
              </div>

              <div className="border-t border-dashed border-slate-200" />

              {/* Totals */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>{t('customSales.subtotal')}</span>
                  <span>{fmtCurrency(totals.subtotal + totals.discountTotal, currency)}</span>
                </div>
                {totals.discountTotal > 0 && (
                  <div className="flex justify-between text-sm text-red-500">
                    <span>{t('customSales.discount')}</span>
                    <span>-{fmtCurrency(totals.discountTotal, currency)}</span>
                  </div>
                )}
                {totals.taxTotal > 0 && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>{t('customSales.tax')}</span>
                    <span>{fmtCurrency(totals.taxTotal, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-900 border-t pt-2 mt-2">
                  <span>{t('customSales.total')}</span>
                  <span>{fmtCurrency(totals.total, currency)}</span>
                </div>
              </div>

              {/* Payment */}
              <div className="space-y-2.5">
                <div className="flex gap-1.5">
                  {(['full', 'partial', 'credit'] as const).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      size="sm"
                      variant={paymentMode === mode ? 'default' : 'outline'}
                      className="flex-1 h-8 text-xs capitalize"
                      onClick={() => {
                        setPaymentMode(mode);
                        if (mode === 'full') setPaidAmount(totals.total.toFixed(2));
                        if (mode === 'credit') setPaidAmount('0');
                      }}
                    >
                      {mode === 'full' ? 'Paid' : mode === 'partial' ? 'Partial' : 'Credit'}
                    </Button>
                  ))}
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1.5 block">{t('customSales.paymentMethod')}</Label>
                  <Select
                    value={paymentMode === 'credit' ? 'credit' : paymentMethod}
                    onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}
                    disabled={paymentMode === 'credit'}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {paymentMethods.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {paymentMode !== 'credit' && (
                <div>
                  <Label className="text-xs text-slate-500 mb-1.5 block">{t('customSales.amountPaid')}</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    placeholder={totals.total.toFixed(2)}
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    className="h-9 text-sm"
                    readOnly={paymentMode === 'full'}
                  />
                  {paymentMode === 'partial' && paidAmount && parseFloat(paidAmount) < totals.total && (
                    <p className="text-xs text-orange-500 mt-1">{t('customSales.balance', { amount: fmtCurrency(totals.total - parseFloat(paidAmount), currency) })}</p>
                  )}
                </div>
                )}
                {paymentMode === 'credit' && !selectedCustomer && (
                  <p className="text-xs text-red-600">Select a customer for credit sales.</p>
                )}
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-1">
                <Button
                  variant="outline"
                  className="w-full h-9 gap-2"
                  onClick={() => setShowPreview(true)}
                  disabled={!canSave}
                >
                  <Eye className="h-4 w-4" /> {t('customSales.previewInvoice')}
                </Button>
                <Button
                  className={cn(btnSuccess, 'w-full h-10 gap-2 rounded-xl font-semibold')}
                  onClick={() => saveMutation.mutate('completed')}
                  disabled={!canSave || saveMutation.isPending}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {saveMutation.isPending && saveMutation.variables === 'completed' ? t('customSales.saving') : t('customSales.completeSale')}
                </Button>
                <Button
                  className="w-full h-9 gap-2"
                  variant="outline"
                  onClick={() => saveMutation.mutate('draft')}
                  disabled={!canSave || saveMutation.isPending}
                >
                  <Save className="h-4 w-4" />
                  {saveMutation.isPending && saveMutation.variables === 'draft' ? t('customSales.saving') : t('customSales.saveAsDraft')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Add Product Modal */}
      <QuickAddProductModal
        open={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        storeId={currentStore?.id ?? ''}
        categories={categories}
        onCreated={(product) => {
          // Add a new line item pre-filled with the created product
          setItems((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              product_id: product.id,
              description: product.name,
              quantity: 1,
              unit_price: product.selling_price,
              discount_pct: 0,
              tax_pct: product.is_taxable ? product.tax_rate : 0,
            },
          ]);
        }}
      />

      {/* Invoice Preview Modal */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[min(92vh,720px)] flex flex-col overflow-hidden p-0 gap-0 rounded-2xl">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-600" /> {t('customSales.invoicePreview')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden px-4 py-3">
            <InvoiceDocument data={previewData} variant="panel" showControls />
          </div>
          <DialogFooter className="shrink-0 !mx-0 !mb-0 px-5 py-4 border-t bg-slate-50/50 rounded-b-2xl gap-2">
            <Button variant="outline" onClick={() => setShowPreview(false)}>{t('customSales.close')}</Button>
            <Button
              className={cn(btnSuccess, 'gap-2')}
              onClick={() => { setShowPreview(false); saveMutation.mutate('completed'); }}
              disabled={saveMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t('customSales.confirmCompleteSale')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
