'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package } from 'lucide-react';

interface TopProductsCardProps {
  storeId: string;
  currency: string;
}

export function TopProductsCard({ storeId, currency }: TopProductsCardProps) {
  const { data: topProducts } = useQuery({
    queryKey: ['top-products', storeId],
    queryFn: async () => {
      const supabase = createClient();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

      const { data } = await supabase
        .from('sale_items')
        .select('product_name, quantity, base_qty, sale_unit_qty, sale_unit_code, subtotal, sale:sales!inner(store_id, sale_date, status)')
        .eq('sale.store_id', storeId)
        .eq('sale.status', 'completed')
        .gte('sale.sale_date', monthStart);

      if (!data) return [];

      const productMap: Record<string, { name: string; qty: number; baseQty: number; revenue: number }> = {};
      for (const item of data) {
        if (!productMap[item.product_name]) {
          productMap[item.product_name] = { name: item.product_name, qty: 0, baseQty: 0, revenue: 0 };
        }
        productMap[item.product_name].qty += Number(item.sale_unit_qty ?? item.quantity ?? 0);
        productMap[item.product_name].baseQty += Number(item.base_qty ?? item.quantity ?? 0);
        productMap[item.product_name].revenue += item.subtotal || 0;
      }

      return Object.values(productMap)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
    },
    enabled: !!storeId,
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  const maxRevenue = topProducts?.length ? Math.max(...topProducts.map((p) => p.revenue)) : 1;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Package className="h-4 w-4 text-blue-600" />
          Top Products This Month
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!topProducts || topProducts.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-slate-400 text-sm">
            No sales data yet
          </div>
        ) : (
          <div className="space-y-3">
            {topProducts.map((product, index) => (
              <div key={product.name} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-slate-700 truncate">{product.name}</span>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="text-sm font-semibold text-slate-900">{fmt(product.revenue)}</span>
                    <p className="text-xs text-slate-400">{product.qty} sold</p>
                  </div>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(product.revenue / maxRevenue) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
