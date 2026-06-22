'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface LowStockProduct {
  id: string;
  name: string;
  stock_quantity: number;
  min_stock_level: number;
  unit?: string;
}

interface LowStockAlertProps {
  products: LowStockProduct[];
}

export function LowStockAlert({ products }: LowStockAlertProps) {
  return (
    <Card className="border-slate-200 border-l-4 border-l-orange-400">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Low Stock Alerts
          </CardTitle>
          <Link href="/dashboard/inventory" className="text-xs text-blue-600 hover:underline">
            View inventory
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <div className="flex h-32 items-center justify-center flex-col gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">All products well stocked</p>
          </div>
        ) : (
          <div className="space-y-2">
            {products.map((p) => {
              const percentage = p.min_stock_level > 0
                ? Math.min((p.stock_quantity / p.min_stock_level) * 100, 100)
                : 100;
              return (
                <div key={p.id} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 truncate flex-1 mr-2">
                      {p.name}
                    </span>
                    <span className="text-xs font-semibold text-orange-600 shrink-0">
                      {p.stock_quantity} {p.unit || 'pcs'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        percentage < 25 ? 'bg-red-500' : percentage < 50 ? 'bg-orange-400' : 'bg-yellow-400'
                      }`}
                      style={{ width: `${Math.max(percentage, 5)}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400">Min: {p.min_stock_level} {p.unit || 'pcs'}</p>
                </div>
              );
            })}
            {products.length > 0 && (
              <Link
                href="/dashboard/inventory"
                className="block mt-3 text-center text-xs text-blue-600 hover:underline"
              >
                View all low stock items →
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
