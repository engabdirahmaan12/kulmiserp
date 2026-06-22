/** Canonical plan prices — server-side only, never trust client */
export const PLAN_PRICES: Record<string, number> = {
  basic: 29,
  business: 79,
  enterprise: 199,
};

export function getPlanTotalUsd(planId: string, months: number): number | null {
  const pricePerMonth = PLAN_PRICES[planId];
  if (!pricePerMonth) return null;
  const monthsNum = Math.max(1, Math.min(24, Math.round(months)));
  return parseFloat((pricePerMonth * monthsNum).toFixed(2));
}

export function getPlanPricePerMonth(planId: string): number | null {
  return PLAN_PRICES[planId] ?? null;
}
