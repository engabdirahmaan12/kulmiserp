import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, Customer, PaymentDetail, PaymentMethod, Product } from '@/types';
import type { PriceTier } from '@/lib/units/conversion';
import { ensureCartLineKey, recalcCartItem, repriceCartItemForTier } from '@/lib/pos/units';
import { refreshCartStockLimits } from '@/lib/pos/stock';

interface HeldCart {
  id: string;
  name: string;
  items: CartItem[];
  customer?: Customer;
  discount_amount: number;
  discount_type: 'fixed' | 'percentage';
  held_at: string;
  /** Set when persisted to sales table (status held) */
  db_sale_id?: string;
}

interface PosState {
  // Cart
  items: CartItem[];
  customer: Customer | null;
  discount_amount: number;
  discount_type: 'fixed' | 'percentage';
  notes: string;
  
  // Payment
  payment_method: PaymentMethod;
  payment_details: PaymentDetail[];
  
  // Held carts
  held_carts: HeldCart[];
  
  // Offline sales queue
  offline_queue: OfflineSale[];
  
  // UI state
  isCheckoutOpen: boolean;
  isPaymentOpen: boolean;
  barcodeInput: string;

  // Actions
  addItem: (item: CartItem) => boolean;
  removeItem: (lineKey: string) => void;
  updateQuantity: (lineKey: string, quantity: number) => void;
  updateItemDiscount: (lineKey: string, discount: number) => void;
  updateUnitPrice: (lineKey: string, unitPrice: number) => void;
  updateLineItem: (
    lineKey: string,
    updates: { quantity?: number; unit_price?: number; discount_amount?: number }
  ) => void;
  replaceCartLine: (oldLineKey: string, newItem: CartItem) => void;
  repriceCartForTier: (products: Product[], tier: PriceTier) => void;
  syncStockLimits: (products: Product[]) => void;
  setCustomer: (customer: Customer | null) => void;
  setDiscount: (amount: number, type: 'fixed' | 'percentage') => void;
  setNotes: (notes: string) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setPaymentDetails: (details: PaymentDetail[]) => void;
  clearCart: () => void;
  holdCart: (name: string) => HeldCart | null;
  mergeHeldCarts: (carts: HeldCart[]) => void;
  markHeldCartPersisted: (localId: string, dbSaleId: string) => void;
  resumeCart: (id: string) => void;
  deleteHeldCart: (id: string) => void;
  addToOfflineQueue: (sale: OfflineSale) => void;
  removeFromOfflineQueue: (id: string) => void;
  syncOfflineSales: () => Promise<void>;
  setCheckoutOpen: (open: boolean) => void;
  setBarcodeInput: (input: string) => void;

  // Computed
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  itemCount: number;
}

export interface OfflineSale {
  id: string;
  store_id: string;
  items: CartItem[];
  customer_id?: string;
  cashier_id: string;
  payment_method: PaymentMethod;
  payment_details: PaymentDetail[];
  discount_amount: number;
  discount_type: 'fixed' | 'percentage';
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  created_at: string;
}

function calculateSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.unit_price * item.quantity - item.discount_amount, 0);
}

function calculateTax(items: CartItem[]): number {
  return items.reduce((sum, item) => {
    const itemSubtotal = item.unit_price * item.quantity - item.discount_amount;
    return sum + itemSubtotal * (item.tax_rate / 100);
  }, 0);
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      items: [],
      customer: null,
      discount_amount: 0,
      discount_type: 'fixed',
      notes: '',
      payment_method: 'cash',
      payment_details: [],
      held_carts: [],
      offline_queue: [],
      isCheckoutOpen: false,
      isPaymentOpen: false,
      barcodeInput: '',

      addItem: (newItem) => {
        const item = ensureCartLineKey(newItem);
        const { items } = get();
        const existing = items.find((i) => i.line_key === item.line_key);
        if (existing) {
          const newQty = existing.quantity + item.quantity;
          if (existing.max_stock !== undefined && newQty > existing.max_stock) {
            return false;
          }
          set({
            items: items.map((i) =>
              i.line_key === item.line_key ? recalcCartItem(i, newQty) : i
            ),
          });
        } else {
          if (item.max_stock !== undefined && item.quantity > item.max_stock) {
            return false;
          }
          set({ items: [...items, item] });
        }
        return true;
      },

      removeItem: (lineKey) => {
        set({ items: get().items.filter((i) => i.line_key !== lineKey) });
      },

      updateQuantity: (lineKey, quantity) => {
        if (quantity <= 0) {
          get().removeItem(lineKey);
          return;
        }
        set({
          items: get().items.map((i) =>
            i.line_key === lineKey ? recalcCartItem(i, quantity) : i
          ),
        });
      },

      updateItemDiscount: (lineKey, discount) => {
        set({
          items: get().items.map((i) => {
            if (i.line_key !== lineKey) return i;
            const next = { ...i, discount_amount: discount };
            return recalcCartItem(next, next.quantity);
          }),
        });
      },

      updateUnitPrice: (lineKey, unitPrice) => {
        set({
          items: get().items.map((i) => {
            if (i.line_key !== lineKey) return i;
            const next = { ...i, unit_price: unitPrice };
            return recalcCartItem(next, next.quantity);
          }),
        });
      },

      updateLineItem: (lineKey, updates) => {
        set({
          items: get().items.map((i) => {
            if (i.line_key !== lineKey) return i;
            const quantity = updates.quantity ?? i.quantity;
            const unit_price = updates.unit_price ?? i.unit_price;
            const discount_amount = updates.discount_amount ?? i.discount_amount;
            return recalcCartItem({ ...i, unit_price, discount_amount }, quantity);
          }),
        });
      },

      replaceCartLine: (oldLineKey, newItem) => {
        const item = ensureCartLineKey(newItem);
        const items = get().items.filter((i) => i.line_key !== oldLineKey);
        const existing = items.find((i) => i.line_key === item.line_key);
        if (existing) {
          const mergedQty = existing.quantity + item.quantity;
          if (existing.max_stock !== undefined && mergedQty > existing.max_stock) return;
          set({
            items: items.map((i) =>
              i.line_key === item.line_key ? recalcCartItem(i, mergedQty) : i
            ),
          });
        } else {
          set({ items: [...items, item] });
        }
      },

      repriceCartForTier: (products, tier) => {
        const productMap = new Map(products.map((p) => [p.id, p]));
        const current = get().items;
        const repriced = current.map((i) => {
          const product = productMap.get(i.product_id);
          if (!product) return { ...i, price_tier: tier };
          return repriceCartItemForTier(i, product, tier);
        });
        const next = refreshCartStockLimits(repriced, products);
        const changed = next.some((item, i) => {
          const prev = current[i];
          return (
            item.unit_price !== prev?.unit_price
            || item.max_stock !== prev?.max_stock
            || item.subtotal !== prev?.subtotal
            || item.price_tier !== prev?.price_tier
          );
        });
        if (changed) set({ items: next });
      },

      syncStockLimits: (products) => {
        const current = get().items;
        const next = refreshCartStockLimits(current, products);
        const changed = next.some(
          (item, i) => item.max_stock !== current[i]?.max_stock,
        );
        if (changed) set({ items: next });
      },

      setCustomer: (customer) => set({ customer }),
      setDiscount: (amount, type) => set({ discount_amount: amount, discount_type: type }),
      setNotes: (notes) => set({ notes }),
      setPaymentMethod: (method) => set({ payment_method: method }),
      setPaymentDetails: (details) => set({ payment_details: details }),

      clearCart: () =>
        set({
          items: [],
          customer: null,
          discount_amount: 0,
          discount_type: 'fixed',
          notes: '',
          payment_method: 'cash',
          payment_details: [],
          isCheckoutOpen: false,
        }),

      holdCart: (name) => {
        const { items, customer, discount_amount, discount_type } = get();
        if (items.length === 0) return null;
        const held: HeldCart = {
          id: crypto.randomUUID(),
          name,
          items,
          customer: customer ?? undefined,
          discount_amount,
          discount_type,
          held_at: new Date().toISOString(),
        };
        set({ held_carts: [...get().held_carts, held] });
        get().clearCart();
        return held;
      },

      mergeHeldCarts: (carts) => {
        const existing = new Set(get().held_carts.map((c) => c.db_sale_id ?? c.id));
        const merged = carts.filter((c) => !existing.has(c.db_sale_id ?? c.id));
        if (merged.length > 0) {
          set({ held_carts: [...get().held_carts, ...merged] });
        }
      },

      markHeldCartPersisted: (localId, dbSaleId) => {
        set({
          held_carts: get().held_carts.map((c) =>
            c.id === localId ? { ...c, db_sale_id: dbSaleId, id: dbSaleId } : c,
          ),
        });
      },

      resumeCart: (id) => {
        const cart = get().held_carts.find((c) => c.id === id);
        if (!cart) return;
        set({
          items: cart.items.map((i) => ensureCartLineKey(i)),
          customer: cart.customer ?? null,
          discount_amount: cart.discount_amount,
          discount_type: cart.discount_type,
          held_carts: get().held_carts.filter((c) => c.id !== id),
        });
      },

      deleteHeldCart: (id) => {
        set({ held_carts: get().held_carts.filter((c) => c.id !== id) });
      },

      addToOfflineQueue: (sale) => {
        set({ offline_queue: [...get().offline_queue, sale] });
      },

      removeFromOfflineQueue: (id) => {
        set({ offline_queue: get().offline_queue.filter((s) => s.id !== id) });
      },

      syncOfflineSales: async () => {
        const queue = get().offline_queue;
        if (queue.length === 0) return;

        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();

        for (const sale of queue) {
          try {
            const { toSaleRpcItem } = await import('@/lib/pos/units');
            const saleItems = sale.items.map((item) => toSaleRpcItem(ensureCartLineKey(item)));

            const paid = sale.payment_details?.[0]?.amount ?? sale.total_amount;
            const creditAmount = sale.payment_method === 'credit'
              ? sale.total_amount
              : Math.max(0, sale.total_amount - paid);

            const { data, error } = await supabase.rpc('complete_pos_sale', {
              p_store_id: sale.store_id,
              p_cashier_id: sale.cashier_id,
              p_customer_id: sale.customer_id || null,
              p_items: saleItems,
              p_subtotal: sale.subtotal,
              p_discount_amount: sale.discount_type === 'percentage'
                ? sale.subtotal * (sale.discount_amount / 100)
                : sale.discount_amount,
              p_discount_type: sale.discount_type,
              p_tax_amount: sale.tax_amount,
              p_total_amount: sale.total_amount,
              p_paid_amount: sale.payment_method === 'credit' ? 0 : sale.total_amount,
              p_change_amount: 0,
              p_credit_amount: creditAmount,
              p_payment_method: sale.payment_method,
              p_payment_details: sale.payment_details,
              p_notes: sale.notes ? `Offline sync: ${sale.notes}` : 'Offline sync',
            });

            if (!error && (data as { success?: boolean })?.success) {
              set({ offline_queue: get().offline_queue.filter((s) => s.id !== sale.id) });
            }
          } catch {
            /* retry later */
          }
        }
      },

      setCheckoutOpen: (open) => set({ isCheckoutOpen: open }),
      setBarcodeInput: (input) => set({ barcodeInput: input }),

      get subtotal() {
        return calculateSubtotal(get().items);
      },
      get discountAmount() {
        const { discount_amount, discount_type, items } = get();
        if (discount_type === 'percentage') {
          return calculateSubtotal(items) * (discount_amount / 100);
        }
        return discount_amount;
      },
      get taxAmount() {
        return calculateTax(get().items);
      },
      get total() {
        const sub = calculateSubtotal(get().items);
        const disc =
          get().discount_type === 'percentage'
            ? sub * (get().discount_amount / 100)
            : get().discount_amount;
        return sub - disc + calculateTax(get().items);
      },
      get itemCount() {
        return get().items.reduce((sum, i) => sum + i.quantity, 0);
      },
    }),
    {
      name: 'kulmis-pos',
      partialize: (state) => ({
        held_carts: state.held_carts,
        offline_queue: state.offline_queue,
      }),
    }
  )
);
