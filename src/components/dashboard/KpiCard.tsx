import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  title: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  color: 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'teal' | 'slate';
  trend?: { value: number; label: string };
  href?: string;
}

const colorMap = {
  blue:   { icon: 'bg-blue-50 text-blue-600',    border: 'hover:border-blue-200' },
  green:  { icon: 'bg-emerald-50 text-emerald-600', border: 'hover:border-emerald-200' },
  red:    { icon: 'bg-red-50 text-red-600',       border: 'hover:border-red-200' },
  orange: { icon: 'bg-orange-50 text-orange-600', border: 'hover:border-orange-200' },
  purple: { icon: 'bg-purple-50 text-purple-600', border: 'hover:border-purple-200' },
  teal:   { icon: 'bg-teal-50 text-teal-600',     border: 'hover:border-teal-200' },
  slate:  { icon: 'bg-slate-100 text-slate-600',  border: 'hover:border-slate-300' },
};

export function KpiCard({ title, value, sub, icon: Icon, color, trend }: KpiCardProps) {
  const c = colorMap[color];

  return (
    <Card className={cn('transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 border-slate-100', c.border)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground mb-1.5 truncate">{title}</p>
            <p className="text-2xl font-bold text-slate-900 tracking-tight truncate">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
          </div>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', c.icon)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend && (
          <div className="mt-3 flex items-center gap-1 pt-3 border-t border-slate-50">
            {trend.value >= 0
              ? <TrendingUp className="h-3 w-3 text-emerald-500" />
              : <TrendingDown className="h-3 w-3 text-red-500" />}
            <span className={cn('text-xs font-semibold', trend.value >= 0 ? 'text-emerald-600' : 'text-red-500')}>
              {trend.value >= 0 ? '+' : ''}{trend.value}%
            </span>
            <span className="text-xs text-muted-foreground">{trend.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
