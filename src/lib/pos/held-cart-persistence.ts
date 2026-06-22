import { createClient } from '@/lib/supabase/client';
import type { CartItem, Customer } from '@/types';
import { ensureCartLineKey, toSaleRpcItem } from '@/lib/pos/units';
import { dbSaleItemToSaleLine } from '@/lib/units/engine';
import type { HeldCart } from '@/lib/stores/pos';

function cartItemToHeldRow(storeId: string, saleId: string, item: CartItem) {
  const line = ensureCartLineKey(item);
  const rpc = toSaleRpcItem(line);
  return {
    store_id: storeId,
    sale_id: saleId,
    product_id: line.product_id,
    product_name: line.product_name,
    product_sku: line.product_sku ?? null,
    quantity: rpc.base_qty,
    unit_price: line.unit_price,
    cost_price: line.cost_price,
    discount_amount: line.discount_amount,
    tax_amount: line.tax_amount,
    subtotal: line.subtotal,
    sale_unit_id: line.sale_unit_id ?? null,
    sale_unit_code: line.sale_unit_code ?? null,
    sale_unit_qty: line.quantity,
    base_qty: rpc.base_qty,
    price_tier: line.price_tier ?? 'retail',
  };
}

export async function saveHeldCartToDatabase(params: {
  storeId: string;
  userId: string;
  name: string;
  items: CartItem[];
  customer: Customer | null;
  discount_amount: number;
  discount_type: 'fixed' | 'percentage';
}): Promise<string> {
  const supabase = createClient();
  const subtotal = params.items.reduce(
    (s, i) => s + i.unit_price * i.quantity - i.discount_amount,
    0,
  );
  const taxAmount = params.items.reduce((s, i) => s + i.tax_amount, 0);
  const discountAmt =
    params.discount_type === 'percentage'
      ? subtotal * (params.discount_amount / 100)
      : params.discount_amount;
  const total = subtotal - discountAmt + taxAmount;

  const { data: storeRow } = await supabase
    .from('stores')
    .select('invoice_prefix, invoice_counter')
    .eq('id', params.storeId)
    .single();

  const prefix = storeRow?.invoice_prefix ?? 'INV';
  const counter = storeRow?.invoice_counter ?? 0;
  const invoiceNumber = `${prefix}-HOLD-${String(counter + 1).padStart(5, '0')}`;

  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .insert({
      store_id: params.storeId,
      invoice_number: invoiceNumber,
      customer_id: params.customer?.id ?? null,
      cashier_id: params.userId,
      status: 'held',
      subtotal,
      discount_amount: params.discount_amount,
      discount_type: params.discount_type,
      tax_amount: taxAmount,
      total_amount: total,
      paid_amount: 0,
      change_amount: 0,
      credit_amount: 0,
      payment_method: 'cash',
      payment_details: [],
      notes: params.name,
      is_offline: false,
      sale_date: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (saleErr) throw saleErr;

  const rows = params.items.map((item) => cartItemToHeldRow(params.storeId, sale.id, item));
  if (rows.length > 0) {
    const { error: itemsErr } = await supabase.from('sale_items').insert(rows);
    if (itemsErr) throw itemsErr;
  }

  await supabase
    .from('stores')
    .update({ invoice_counter: counter + 1 })
    .eq('id', params.storeId);

  return sale.id;
}

export async function fetchHeldCartsFromDatabase(storeId: string): Promise<HeldCart[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sales')
    .select('id, notes, sale_date, updated_at, customer_id, discount_amount, discount_type, items:sale_items(*)')
    .eq('store_id', storeId)
    .eq('status', 'held')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((sale) => {
    const items = (sale.items ?? []).map((row) => {
      const core = dbSaleItemToSaleLine(row);
      return ensureCartLineKey({
        line_key: `${core.product_id}:${core.sale_unit_id ?? 'base'}`,
        product_id: core.product_id!,
        product_name: core.product_name,
        product_sku: core.product_sku,
        quantity: core.sale_unit_qty,
        unit_price: core.unit_price,
        cost_price: core.cost_price,
        discount_amount: core.discount_amount,
        tax_rate: core.tax_amount > 0 && core.unit_price * core.sale_unit_qty > core.discount_amount
          ? (core.tax_amount / (core.unit_price * core.sale_unit_qty - core.discount_amount)) * 100
          : 0,
        tax_amount: core.tax_amount,
        subtotal: core.subtotal,
        sale_unit_id: core.sale_unit_id ?? undefined,
        sale_unit_code: core.sale_unit_code ?? undefined,
        conversion_factor: core.conversion_factor,
        base_qty: core.base_qty,
        price_tier: core.price_tier,
        track_inventory: true,
        allows_decimal: false,
      });
    });

    return {
      id: sale.id,
      name: sale.notes || 'Held cart',
      items,
      discount_amount: Number(sale.discount_amount) || 0,
      discount_type: (sale.discount_type as 'fixed' | 'percentage') ?? 'fixed',
      held_at: sale.updated_at ?? sale.sale_date,
      db_sale_id: sale.id,
    };
  });
}

export async function deleteHeldCartFromDatabase(saleId: string): Promise<void> {
  const supabase = createClient();
  await supabase.from('sale_items').delete().eq('sale_id', saleId);
  const { error } = await supabase.from('sales').delete().eq('id', saleId);
  if (error) throw error;
}
