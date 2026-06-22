export type InventoryCostMethod = 'average' | 'fifo' | 'lifo';

export const COST_METHOD_OPTIONS: {
  value: InventoryCostMethod;
  label: string;
  description: string;
}[] = [
  {
    value: 'average',
    label: 'Weighted Average Cost',
    description: 'Default. Recalculates average cost after each purchase. Sales use the current average.',
  },
  {
    value: 'fifo',
    label: 'FIFO (First In, First Out)',
    description: 'Oldest purchase costs are consumed first on sales.',
  },
  {
    value: 'lifo',
    label: 'LIFO (Last In, First Out)',
    description: 'Newest purchase costs are consumed first on sales.',
  },
];

export function costMethodLabel(method?: string | null): string {
  return COST_METHOD_OPTIONS.find((o) => o.value === method)?.label ?? 'Weighted Average Cost';
}

/** WAC formula display helper */
export function formatWacFormula(
  qtyBefore: number,
  prevCost: number,
  purchaseQty: number,
  purchaseCost: number,
  qtyAfter: number,
  newCost: number,
): string {
  if (purchaseQty <= 0) return `${prevCost.toFixed(2)}`;
  return `(${qtyBefore} × ${prevCost.toFixed(2)} + ${purchaseQty} × ${purchaseCost.toFixed(2)}) ÷ ${qtyAfter} = ${newCost.toFixed(2)}`;
}

export function inventoryValue(qty: number, avgCost: number): number {
  return Math.max(0, qty) * Math.max(0, avgCost);
}
