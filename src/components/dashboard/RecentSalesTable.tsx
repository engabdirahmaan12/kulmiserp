'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import { PAYMENT_METHODS_LABELS } from '@/types';
import Link from 'next/link';

interface Sale {
  id: string;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  sale_date: string;
  status: string;
  customer?: { full_name: string } | null;
}

interface RecentSalesTableProps {
  sales: Sale[];
  currency: string;
}

const statusColors: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
  refunded: 'bg-orange-100 text-orange-700',
  held: 'bg-slate-100 text-slate-700',
  draft: 'bg-blue-100 text-blue-700',
};

export function RecentSalesTable({ sales, currency }: RecentSalesTableProps) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ShoppingCart className="h-4 w-4 text-blue-600" />
            Recent Sales
          </CardTitle>
          <Link href="/dashboard/pos" className="text-xs text-blue-600 hover:underline">
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {sales.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-slate-400 text-sm">
            No sales yet today
          </div>
        ) : (
          <div className="space-y-0">
            {sales.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 -mx-2 px-2 rounded transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50">
                  <ShoppingCart className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {sale.invoice_number}
                    </span>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColors[sale.status] || 'bg-slate-100 text-slate-700'}`}>
                      {sale.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {sale.customer?.full_name || 'Walk-in'} •{' '}
                    {PAYMENT_METHODS_LABELS[sale.payment_method as keyof typeof PAYMENT_METHODS_LABELS] || sale.payment_method}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{fmt(sale.total_amount)}</p>
                  <p className="text-xs text-slate-400">
                    {format(new Date(sale.sale_date), 'h:mm a')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
