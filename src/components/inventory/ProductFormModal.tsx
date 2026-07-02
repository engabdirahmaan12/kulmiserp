'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Package, ImageIcon, Wand2, Tag,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '@/types';
import { cn } from '@/lib/utils';
import { BarcodeScannerField } from '@/components/barcode/BarcodeScannerField';
import { ProductMediaEditor, syncProductGallery, type PendingGalleryItem } from '@/components/inventory/ProductMediaEditor';
import {
  ProductUnitsEditor,
  defaultProductUnitsState,
  type ProductUnitsFormState,
} from '@/components/inventory/ProductUnitsEditor';
import { uploadProductImage } from '@/lib/storage/upload';
import { toSelectItems } from '@/lib/ui/select-utils';
import { toBaseUnitCost } from '@/lib/units/conversion';
import { PRODUCT_SALES_MODE_LABELS, type ProductSalesMode } from '@/lib/units/conversion';
import type { ProductUnit, QuantityPriceRow, UnitType } from '@/types';
import { Switch } from '@/components/ui/switch';
import { getPriceLevelsEnabled, getQuantityPricingEnabled } from '@/lib/pos/pricing';

/** Stable fallback — avoid `= []` in useQuery destructuring (new ref every render). */
const EMPTY_PRODUCT_UNITS: ProductUnit[] = [];
const EMPTY_UNIT_TYPES: UnitType[] = [];

const toNumber = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required'),
  secondary_name: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  barcode_type: z.string().default('CODE128'),
  category_id: z.string().optional(),
  brand: z.string().optional(),
  unit: z.string().default('piece'),
  cost_price: z.preprocess(toNumber, z.number().min(0)),
  selling_price: z.preprocess(toNumber, z.number().min(0, 'Sell price is required')),
  is_taxable: z.boolean().default(false),
  tax_rate: z.preprocess(toNumber, z.number().min(0).max(100)),
  track_inventory: z.boolean().default(true),
  stock_quantity: z.preprocess(toNumber, z.number().min(0)),
  min_stock_level: z.preprocess(toNumber, z.number().min(0)),
  reorder_point: z.preprocess(toNumber, z.number().min(0)),
  is_active: z.boolean().default(true),
  discount_type: z.enum(['percentage', 'fixed']).optional(),
  discount_value: z.preprocess(toNumber, z.number().min(0)).optional(),
  discount_start: z.string().optional(),
  discount_end: z.string().optional(),
  sales_mode: z.enum(['retail', 'wholesale', 'both']).default('both'),
});

type ProductForm = z.infer<typeof productSchema>;

const DEFAULT_VALUES: ProductForm = {
  name: '',
  secondary_name: '',
  sku: '',
  barcode: '',
  barcode_type: 'CODE128',
  category_id: undefined,
  brand: '',
  unit: 'piece',
  cost_price: 0,
  selling_price: 0,
  is_taxable: false,
  tax_rate: 0,
  track_inventory: true,
  stock_quantity: 0,
  min_stock_level: 0,
  reorder_point: 0,
  is_active: true,
  discount_type: undefined,
  discount_value: 0,
  discount_start: '',
  discount_end: '',
  sales_mode: 'both',
};

const BARCODE_TYPES = ['CODE128', 'EAN13', 'EAN8', 'UPC', 'CODE39'];

interface ProductFormModalProps {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}

function buildUnitsFormFromProduct(
  product: Product,
  unitTypes: UnitType[],
  existingProductUnits: ProductUnit[],
): ProductUnitsFormState {
  const purchaseUnit = existingProductUnits.find((u) => u.is_purchase_unit);
  const baseId = product.base_unit_id ?? purchaseUnit?.unit_type_id ?? unitTypes[0]?.id ?? '';
  const saleExtras = existingProductUnits.filter((u) => !u.is_purchase_unit && u.unit_type_id !== baseId);

  return {
    base_unit_id: baseId,
    purchase_unit_id: purchaseUnit?.unit_type_id ?? baseId,
    purchase_conversion: purchaseUnit?.conversion_factor ?? 1,
    purchase_unit_cost: (product.cost_price ?? 0) * (purchaseUnit?.conversion_factor ?? 1),
    purchase_barcode: purchaseUnit?.barcode ?? '',
    retail_price: product.selling_price ?? 0,
    wholesale_price: product.wholesale_price ?? 0,
    distributor_price: product.distributor_price ?? 0,
    vip_price: product.vip_price ?? 0,
    sale_units: saleExtras.map((u) => ({
      unit_type_id: u.unit_type_id,
      conversion_factor: u.conversion_factor,
      is_purchase_unit: false,
      is_default_sale: u.is_default_sale,
      barcode: u.barcode ?? null,
      retail_price: u.retail_price,
      wholesale_price: u.wholesale_price,
      distributor_price: u.distributor_price,
      vip_price: u.vip_price,
      quantity_prices: u.quantity_prices ?? [],
    })),
  };
}

function productToFormValues(product: Product): ProductForm {
  return {
    name: product.name,
    secondary_name: product.description || '',
    sku: product.sku || '',
    barcode: product.barcode || '',
    barcode_type: 'CODE128',
    category_id: product.category_id || undefined,
    brand: product.brand || '',
    unit: product.unit || 'piece',
    cost_price: product.cost_price,
    selling_price: product.selling_price,
    is_taxable: product.is_taxable,
    tax_rate: product.tax_rate,
    track_inventory: product.track_inventory,
    stock_quantity: product.stock_quantity,
    min_stock_level: product.min_stock_level,
    reorder_point: product.reorder_point,
    is_active: product.is_active,
    discount_type: (product.discount_type as 'percentage' | 'fixed' | undefined) ?? undefined,
    discount_value: product.discount_value ?? 0,
    discount_start: product.discount_start ? product.discount_start.slice(0, 10) : '',
    discount_end: product.discount_end ? product.discount_end.slice(0, 10) : '',
    sales_mode: (product.sales_mode as ProductSalesMode) ?? 'both',
  };
}

function generateSku() {
  return `SKU-${Date.now().toString(36).toUpperCase().slice(-8)}`;
}

function generateBarcode(type: string) {
  const base = Date.now().toString().slice(-10);
  if (type === 'EAN13') return base.padStart(13, '0').slice(0, 13);
  if (type === 'EAN8') return base.padStart(8, '0').slice(0, 8);
  if (type === 'UPC') return base.padStart(12, '0').slice(0, 12);
  return `BC${base}`;
}

async function assertStoreBarcodeFree(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
  barcode: string,
  excludeProductId?: string,
) {
  let productQuery = supabase
    .from('products')
    .select('id')
    .eq('store_id', storeId)
    .eq('barcode', barcode);
  if (excludeProductId) productQuery = productQuery.neq('id', excludeProductId);
  const { data: productDup } = await productQuery.maybeSingle();
  if (productDup) throw new Error('This barcode is already used by another product');

  const { data: unitRows } = await supabase
    .from('product_units')
    .select('id, product_id, product:products!inner(store_id)')
    .eq('barcode', barcode)
    .eq('product.store_id', storeId);

  for (const row of unitRows ?? []) {
    if (excludeProductId && row.product_id === excludeProductId) continue;
    throw new Error('This barcode is already used by another product unit');
  }
}

/** Outlined field with label on border (reference UI style) */
function OutlinedField({
  label,
  required,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('relative', className)}>
      <span className="absolute -top-2 left-3 z-10 bg-white px-1 text-xs font-medium text-slate-500">
        {label}{required ? ' *' : ''}
      </span>
      {children}
      {error && <p className="text-xs text-red-500 mt-1.5 pl-1">{error}</p>}
    </div>
  );
}

const fieldInputClass =
  'h-12 w-full rounded-xl border-slate-200 bg-slate-50/80 text-sm focus-visible:bg-white';

export function ProductFormModal({ open, product, onClose }: ProductFormModalProps) {
  const { currentStore, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [mainBlob, setMainBlob] = useState<Blob | null>(null);
  const [removeMainImage, setRemoveMainImage] = useState(false);
  const [pendingGallery, setPendingGallery] = useState<PendingGalleryItem[]>([]);
  const [deletedGalleryIds, setDeletedGalleryIds] = useState<string[]>([]);
  const [unitsForm, setUnitsForm] = useState<ProductUnitsFormState>(() => defaultProductUnitsState([]));

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('product_categories')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('name');
      return data || [];
    },
    enabled: !!currentStore && open,
  });

  const { data: existingBrands = [] } = useQuery({
    queryKey: ['product-brands', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('products')
        .select('brand')
        .eq('store_id', currentStore!.id)
        .not('brand', 'is', null);
      const names = new Set<string>();
      for (const row of data ?? []) {
        if (row.brand?.trim()) names.add(row.brand.trim());
      }
      return Array.from(names).sort((a, b) => a.localeCompare(b));
    },
    enabled: !!currentStore && open,
  });

  const { data: unitTypes = EMPTY_UNIT_TYPES } = useQuery({
    queryKey: ['unit-types', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('unit_types')
        .select('*')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as UnitType[];
    },
    enabled: !!currentStore && open,
  });

  const { data: existingProductUnits = EMPTY_PRODUCT_UNITS, isFetched: productUnitsFetched } = useQuery({
    queryKey: ['product-units', product?.id],
    queryFn: async () => {
      const supabase = createClient();
      const [{ data, error }, { data: qtyPriceData }] = await Promise.all([
        supabase
          .from('product_units')
          .select('*, unit_type:unit_types(*)')
          .eq('product_id', product!.id),
        supabase
          .from('product_quantity_prices')
          .select('id, unit_type_id, price_tier, min_qty, max_qty, price')
          .eq('product_id', product!.id)
          .eq('is_active', true),
      ]);
      if (error) throw error;

      const qtyByUnit = new Map<string, QuantityPriceRow[]>();
      for (const row of (qtyPriceData ?? []) as Array<QuantityPriceRow & { unit_type_id: string }>) {
        const list = qtyByUnit.get(row.unit_type_id) ?? [];
        list.push({ id: row.id, price_tier: row.price_tier, min_qty: row.min_qty, max_qty: row.max_qty, price: row.price });
        qtyByUnit.set(row.unit_type_id, list);
      }

      return (data ?? []).map((u) => ({
        ...u,
        quantity_prices: qtyByUnit.get(u.unit_type_id) ?? [],
      })) as ProductUnit[];
    },
    enabled: !!product?.id && open,
  });

  const categorySelectItems = useMemo(
    () => toSelectItems(categories, (c) => c.id, (c) => c.name, [{ value: 'auto', label: 'Auto (first letter)' }]),
    [categories],
  );

  const productId = product?.id ?? null;
  const formSyncedRef = useRef<string | null>(null);
  const unitsSyncedRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ProductForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(productSchema) as any,
    defaultValues: DEFAULT_VALUES,
  });

  useEffect(() => {
    if (!open) {
      formSyncedRef.current = null;
      return;
    }

    const formKey = productId ?? 'new';
    if (formSyncedRef.current === formKey) return;
    formSyncedRef.current = formKey;

    if (product) {
      reset(productToFormValues(product));
      setImagePreview(product.image_url || null);
    } else {
      reset(DEFAULT_VALUES);
      setImagePreview(null);
    }
    setMainBlob(null);
    setRemoveMainImage(false);
    setPendingGallery([]);
    setDeletedGalleryIds([]);
  }, [open, productId, product, reset]);

  useEffect(() => {
    if (!open) {
      unitsSyncedRef.current = null;
      return;
    }
    if (unitTypes.length === 0) return;
    if (productId && !productUnitsFetched) return;

    const unitsKey = `${productId ?? 'new'}:${unitTypes.length}:${existingProductUnits.length}`;
    if (unitsSyncedRef.current === unitsKey) return;
    unitsSyncedRef.current = unitsKey;

    if (product) {
      setUnitsForm(buildUnitsFormFromProduct(product, unitTypes, existingProductUnits));
    } else {
      setUnitsForm(defaultProductUnitsState(unitTypes));
    }
  }, [open, productId, product, unitTypes, existingProductUnits, productUnitsFetched]);

  const categoryValue = watch('category_id');
  const categoryName = categories.find((c) => c.id === categoryValue)?.name;
  const trackInventory = watch('track_inventory');
  const isActive = watch('is_active');
  const salesMode = watch('sales_mode') as ProductSalesMode;
  const baseUnitType = unitTypes.find((u) => u.id === unitsForm.base_unit_id);
  const stockStep = baseUnitType?.allows_decimal ? '0.001' : '1';

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: ProductForm) => {
      if (!currentStore?.id) throw new Error('No store selected');

      const supabase = createClient();
      const sku = data.sku?.trim() || generateSku();
      const barcode = data.barcode?.trim() || null;

      if (barcode) {
        await assertStoreBarcodeFree(supabase, currentStore.id, barcode, product?.id);
      }

      const unitBarcodes: string[] = [];
      const pushUnitBarcode = (code?: string | null) => {
        const trimmed = code?.trim();
        if (!trimmed) return;
        if (trimmed === barcode) throw new Error('Unit barcode must differ from the product barcode');
        if (unitBarcodes.includes(trimmed)) throw new Error('Duplicate barcode on sale units');
        unitBarcodes.push(trimmed);
      };

      pushUnitBarcode(unitsForm.purchase_barcode);
      for (const su of unitsForm.sale_units) pushUnitBarcode(su.barcode);

      for (const code of unitBarcodes) {
        await assertStoreBarcodeFree(supabase, currentStore.id, code, product?.id);
      }

      let image_url: string | null = removeMainImage ? null : (product?.image_url ?? null);
      if (mainBlob) {
        const tempId = product?.id ?? 'new';
        const up = await uploadProductImage(currentStore.id, tempId, mainBlob);
        image_url = up.url;
      }

      const baseUnit = unitTypes.find((u) => u.id === unitsForm.base_unit_id);
      const baseCost = toBaseUnitCost(unitsForm.purchase_unit_cost, unitsForm.purchase_conversion);

      const basePayload = {
        name: data.name.trim(),
        description: data.secondary_name?.trim() || null,
        sku,
        barcode,
        brand: data.brand?.trim() || null,
        unit: baseUnit?.code?.toLowerCase() ?? data.unit ?? 'piece',
        base_unit_id: unitsForm.base_unit_id || null,
        cost_price: baseCost,
        selling_price: unitsForm.retail_price,
        wholesale_price: unitsForm.wholesale_price || null,
        distributor_price: unitsForm.distributor_price || null,
        vip_price: unitsForm.vip_price || null,
        is_taxable: data.is_taxable,
        tax_rate: data.is_taxable ? data.tax_rate : 0,
        track_inventory: data.track_inventory,
        min_stock_level: data.track_inventory ? data.min_stock_level : 0,
        reorder_point: data.track_inventory ? data.reorder_point : 0,
        is_active: data.is_active,
        sales_mode: data.sales_mode,
        store_id: currentStore.id,
        category_id: data.category_id && data.category_id !== 'auto' ? data.category_id : null,
        image_url,
        discount_type: data.discount_type || null,
        discount_value: (data.discount_value && data.discount_value > 0) ? data.discount_value : null,
        discount_start: (data.discount_start && data.discount_type) ? new Date(data.discount_start).toISOString() : null,
        discount_end: (data.discount_end && data.discount_type) ? new Date(data.discount_end).toISOString() : null,
      };

      let productId = product?.id;

      if (product) {
        const { error } = await supabase.from('products').update(basePayload).eq('id', product.id);
        if (error) throw error;
        productId = product.id;
        await syncProductGallery(currentStore.id, product.id, image_url, pendingGallery, deletedGalleryIds);
      } else {
        const openingStock = data.track_inventory ? data.stock_quantity : 0;
        const { data: created, error } = await supabase
          .from('products')
          .insert({ ...basePayload, stock_quantity: 0 })
          .select('id')
          .single();
        if (error) throw error;

        if (created?.id) {
          productId = created.id;
          await syncProductGallery(currentStore.id, created.id, image_url, pendingGallery, []);
        }

        if (openingStock > 0 && created?.id) {
          const { data: adj, error: adjErr } = await supabase.rpc('record_stock_adjustment', {
            p_store_id: currentStore.id,
            p_user_id: user!.id,
            p_product_id: created.id,
            p_quantity_after: openingStock,
            p_reason: 'Opening stock',
            p_movement_type: 'opening',
          });
          if (adjErr) throw adjErr;
          const adjResult = adj as { success?: boolean; error?: string };
          if (!adjResult?.success) throw new Error(adjResult?.error || 'Failed to post opening inventory');
        }
      }

      if (productId && unitsForm.base_unit_id) {
        await supabase.from('product_units').delete().eq('product_id', productId);

        const rows: Array<Record<string, unknown>> = [];

        const saleByUnitId = new Map(
          unitsForm.sale_units.filter((su) => su.unit_type_id).map((su) => [su.unit_type_id, su]),
        );
        const purchaseUnitId = unitsForm.purchase_unit_id || unitsForm.base_unit_id;
        const purchaseSale = saleByUnitId.get(purchaseUnitId);
        const purchaseBarcode =
          (purchaseSale?.barcode ?? unitsForm.purchase_barcode)?.trim() || null;

        rows.push({
          product_id: productId,
          unit_type_id: purchaseUnitId,
          conversion_factor: unitsForm.purchase_conversion || 1,
          is_purchase_unit: true,
          is_default_sale:
            purchaseUnitId === unitsForm.base_unit_id || Boolean(purchaseSale?.is_default_sale),
          barcode: purchaseBarcode,
          retail_price: purchaseSale?.retail_price ?? (purchaseUnitId === unitsForm.base_unit_id ? unitsForm.retail_price : null),
          wholesale_price: (purchaseSale?.wholesale_price ?? (purchaseUnitId === unitsForm.base_unit_id ? unitsForm.wholesale_price : null)) || null,
          distributor_price: (purchaseSale?.distributor_price ?? (purchaseUnitId === unitsForm.base_unit_id ? unitsForm.distributor_price : null)) || null,
          vip_price: (purchaseSale?.vip_price ?? (purchaseUnitId === unitsForm.base_unit_id ? unitsForm.vip_price : null)) || null,
        });

        if (purchaseUnitId !== unitsForm.base_unit_id) {
          const baseSale = saleByUnitId.get(unitsForm.base_unit_id);
          rows.push({
            product_id: productId,
            unit_type_id: unitsForm.base_unit_id,
            conversion_factor: 1,
            is_purchase_unit: false,
            is_default_sale: baseSale?.is_default_sale ?? !purchaseSale?.is_default_sale,
            barcode: baseSale?.barcode?.trim() || null,
            retail_price: baseSale?.retail_price ?? unitsForm.retail_price,
            wholesale_price: (baseSale?.wholesale_price ?? unitsForm.wholesale_price) || null,
            distributor_price: (baseSale?.distributor_price ?? unitsForm.distributor_price) || null,
            vip_price: (baseSale?.vip_price ?? unitsForm.vip_price) || null,
          });
        }

        for (const su of unitsForm.sale_units) {
          if (!su.unit_type_id) continue;
          if (su.unit_type_id === purchaseUnitId || su.unit_type_id === unitsForm.base_unit_id) continue;
          rows.push({
            product_id: productId,
            unit_type_id: su.unit_type_id,
            conversion_factor: su.conversion_factor || 1,
            is_purchase_unit: false,
            is_default_sale: su.is_default_sale ?? false,
            barcode: su.barcode?.trim() || null,
            retail_price: su.retail_price,
            wholesale_price: su.wholesale_price,
            distributor_price: su.distributor_price,
            vip_price: su.vip_price,
          });
        }

        const seen = new Set<string>();
        const dedupedRows = rows.filter((row) => {
          const id = String(row.unit_type_id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

        const { error: unitsError } = await supabase.from('product_units').insert(dedupedRows);
        if (unitsError) throw unitsError;

        // Quantity/bulk-break prices are only editable on the sale-unit rows.
        await supabase.from('product_quantity_prices').delete().eq('product_id', productId);
        const qtyRows = unitsForm.sale_units.flatMap((su) =>
          su.unit_type_id
            ? (su.quantity_prices ?? []).map((qp) => ({
                store_id: currentStore.id,
                product_id: productId,
                unit_type_id: su.unit_type_id,
                price_tier: qp.price_tier,
                min_qty: qp.min_qty,
                max_qty: qp.max_qty,
                price: qp.price,
              }))
            : [],
        );
        if (qtyRows.length > 0) {
          const { error: qtyError } = await supabase.from('product_quantity_prices').insert(qtyRows);
          if (qtyError) throw qtyError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['product-brands', currentStore?.id] });
      if (product?.id) queryClient.invalidateQueries({ queryKey: ['product-images', product.id] });
      toast.success(product ? 'Product updated' : 'Product saved');
      onClose();
    },
    onError: (error: Error) => {
      const msg = error.message || 'Unknown error';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        if (msg.toLowerCase().includes('barcode')) {
          toast.error('This barcode is already used by another product.');
        } else {
          toast.error('SKU already exists. Please use a different SKU.');
        }
      } else {
        toast.error('Failed to save: ' + msg);
      }
    },
  });

  const onInvalid = (fieldErrors: FieldErrors<ProductForm>) => {
    const firstError = Object.values(fieldErrors)[0];
    toast.error(firstError?.message || 'Please fill in all required fields');
  };

  const barcodeType = watch('barcode_type');

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 rounded-2xl border-slate-200 shadow-xl"
        showCloseButton
      >
        <div className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="text-xl font-bold text-slate-900">
            {product ? 'Edit product' : 'Add product'}
          </DialogTitle>
        </div>

        <form onSubmit={handleSubmit((d) => mutate({
          ...d,
          selling_price: unitsForm.retail_price,
          cost_price: toBaseUnitCost(unitsForm.purchase_unit_cost, unitsForm.purchase_conversion),
        }), onInvalid)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

            <ProductMediaEditor
              productId={product?.id}
              storeId={currentStore!.id}
              categoryName={categoryName}
              mainPreview={removeMainImage ? null : imagePreview}
              onMainPreviewChange={setImagePreview}
              onMainBlobChange={setMainBlob}
              onRemoveMain={() => {
                setRemoveMainImage(true);
                setImagePreview(null);
                setMainBlob(null);
              }}
              pendingGallery={pendingGallery}
              onPendingGalleryChange={setPendingGallery}
              onDeleteExisting={(id) => setDeletedGalleryIds((prev) => [...prev, id])}
            />

            {/* Category */}
            <OutlinedField label="Category">
              <Select
                items={categorySelectItems}
                value={categoryValue || 'auto'}
                onValueChange={(v: string | null) =>
                  setValue('category_id', v === 'auto' ? undefined : v ?? undefined)
                }
              >
                <SelectTrigger className={cn(fieldInputClass, 'w-full')}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Uncategorized</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </OutlinedField>

            {/* Brand */}
            <OutlinedField label="Brand (optional)">
              <Input
                id="brand"
                list="product-brand-suggestions"
                {...register('brand')}
                className={fieldInputClass}
                placeholder="e.g. Samsung, Coca-Cola"
              />
              <datalist id="product-brand-suggestions">
                {existingBrands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </OutlinedField>

            {/* Product name */}
            <OutlinedField label="Product name" required error={errors.name?.message}>
              <Input
                id="name"
                {...register('name')}
                className={cn(fieldInputClass, errors.name && 'border-red-400')}
              />
            </OutlinedField>

            {/* Description */}
            <OutlinedField label="Description (optional)">
              <Input id="secondary_name" {...register('secondary_name')} className={fieldInputClass} />
            </OutlinedField>

            {/* Product type & status */}
            <div className="grid gap-4 sm:grid-cols-2">
              <OutlinedField label="Product type">
                <Select
                  value={salesMode}
                  onValueChange={(v) => setValue('sales_mode', (v ?? 'both') as ProductSalesMode)}
                >
                  <SelectTrigger className={cn(fieldInputClass, 'w-full')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRODUCT_SALES_MODE_LABELS) as ProductSalesMode[]).map((mode) => (
                      <SelectItem key={mode} value={mode} label={PRODUCT_SALES_MODE_LABELS[mode]}>
                        {PRODUCT_SALES_MODE_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </OutlinedField>
              <div className="flex flex-col justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">Active</p>
                    <p className="text-xs text-slate-500">Inactive products are hidden from POS</p>
                  </div>
                  <Switch
                    checked={isActive}
                    onCheckedChange={(v) => setValue('is_active', v)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">Track inventory</p>
                    <p className="text-xs text-slate-500">Stock in base units only</p>
                  </div>
                  <Switch
                    checked={trackInventory}
                    onCheckedChange={(v) => setValue('track_inventory', v)}
                  />
                </div>
              </div>
            </div>

            {/* Barcode row */}
            <OutlinedField label="Barcode">
              <div className="flex gap-2 items-center">
                <BarcodeScannerField
                  value={watch('barcode') || ''}
                  onChange={(v) => setValue('barcode', v)}
                  onScan={(v) => setValue('barcode', v)}
                  inputClassName={fieldInputClass}
                  className="flex-1"
                  closeCameraOnScan
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-xl border-slate-200 bg-slate-50 text-teal-600 hover:bg-teal-50"
                  onClick={() => setValue('barcode', generateBarcode(barcodeType))}
                  title="Generate barcode"
                >
                  <Wand2 className="h-5 w-5" />
                </Button>
              </div>
            </OutlinedField>

            {/* Barcode type */}
            <OutlinedField label="Barcode type">
              <Select
                value={barcodeType}
                onValueChange={(v: string | null) => setValue('barcode_type', v ?? 'CODE128')}
              >
                <SelectTrigger className={cn(fieldInputClass, 'w-full')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BARCODE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </OutlinedField>

            {/* Units & pricing */}
            {unitTypes.length > 0 ? (
              <ProductUnitsEditor
                unitTypes={unitTypes}
                value={unitsForm}
                onChange={setUnitsForm}
                priceLevelsEnabled={getPriceLevelsEnabled(currentStore?.settings as Record<string, unknown> | undefined)}
                quantityPricingEnabled={getQuantityPricingEnabled(currentStore?.settings as Record<string, unknown> | undefined)}
              />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <OutlinedField label="Cost">
                  <Input
                    id="cost_price"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('cost_price', { valueAsNumber: true })}
                    className={fieldInputClass}
                  />
                </OutlinedField>
                <OutlinedField label="Sell price" required error={errors.selling_price?.message}>
                  <Input
                    id="selling_price"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('selling_price', { valueAsNumber: true })}
                    className={cn(fieldInputClass, errors.selling_price && 'border-red-400')}
                  />
                </OutlinedField>
              </div>
            )}

            {/* Quantity & Low stock threshold (base units) */}
            <div className="grid grid-cols-2 gap-4">
              <OutlinedField label={product ? 'Opening stock (base units)' : 'Quantity (base units)'}>
                <Input
                  id="stock_quantity"
                  type="number"
                  step={stockStep}
                  min="0"
                  {...register('stock_quantity', { valueAsNumber: true })}
                  className={fieldInputClass}
                  disabled={!!product || !trackInventory}
                />
              </OutlinedField>
              <OutlinedField label={`Low stock threshold${baseUnitType ? ` (${baseUnitType.code})` : ''}`}>
                <Input
                  id="min_stock_level"
                  type="number"
                  step={stockStep}
                  min="0"
                  {...register('min_stock_level', { valueAsNumber: true })}
                  className={fieldInputClass}
                  disabled={!trackInventory}
                />
              </OutlinedField>
            </div>

            {/* Product-level discount */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-semibold text-slate-700">Product Discount (optional)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <OutlinedField label="Discount type">
                  <Select
                    value={watch('discount_type') ?? ''}
                    onValueChange={(v) => setValue('discount_type', (v || undefined) as 'percentage' | 'fixed' | undefined)}
                  >
                    <SelectTrigger className={cn(fieldInputClass, 'w-full')}>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed Amount</SelectItem>
                    </SelectContent>
                  </Select>
                </OutlinedField>
                <OutlinedField label="Discount value">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('discount_value', { valueAsNumber: true })}
                    className={fieldInputClass}
                    disabled={!watch('discount_type')}
                    placeholder="0"
                  />
                </OutlinedField>
              </div>
              {watch('discount_type') && (
                <div className="grid grid-cols-2 gap-3">
                  <OutlinedField label="Starts on">
                    <Input
                      type="date"
                      {...register('discount_start')}
                      className={fieldInputClass}
                    />
                  </OutlinedField>
                  <OutlinedField label="Ends on">
                    <Input
                      type="date"
                      {...register('discount_end')}
                      className={fieldInputClass}
                    />
                  </OutlinedField>
                </div>
              )}
              <p className="text-xs text-slate-400">Applies only to this product. Use Promotions for store-wide discounts.</p>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-4 px-6 py-5 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-teal-600 hover:text-teal-700 hover:bg-teal-50 font-semibold h-11 px-6"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-11 px-8 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-semibold shadow-sm shadow-teal-200"
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
