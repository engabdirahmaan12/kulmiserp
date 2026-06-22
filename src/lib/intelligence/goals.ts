const KEY = 'kulmis_store_goals';

export interface StoreGoals {
  monthlyRevenue?: number;
  monthlyProfit?: number;
}

export function getStoreGoals(storeId: string): StoreGoals {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(`${KEY}_${storeId}`);
    return raw ? (JSON.parse(raw) as StoreGoals) : {};
  } catch {
    return {};
  }
}

export function saveStoreGoals(storeId: string, goals: StoreGoals): void {
  localStorage.setItem(`${KEY}_${storeId}`, JSON.stringify(goals));
}
