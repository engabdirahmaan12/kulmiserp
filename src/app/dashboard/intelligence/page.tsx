'use client';

import { useState } from 'react';
import { useStoreIntelligence } from '@/lib/hooks/useIntelligence';
import { useAuthStore } from '@/lib/stores/auth';
import { answerCopilotQuery } from '@/lib/intelligence/copilot';
import { isSomaliQuery } from '@/lib/intelligence/query-language';
import { PageShell } from '@/components/layout/PageShell';
import { ReportPageHeader, ReportKpiGrid, ReportKpiCard, ReportWidget } from '@/components/reports/ReportLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
  Sparkles, Send, Package, Users, TrendingDown, ShoppingCart,
  Activity, Target, AlertTriangle,
} from 'lucide-react';
import {
  BusinessHealthCard,
  DailyBriefingCard,
  ActivityTimelineCard,
  GoalsWidget,
  ExecutiveMetricsStrip,
} from '@/components/intelligence/IntelligenceWidgets';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

const SEGMENT_STYLE = {
  vip: 'bg-violet-100 text-violet-700',
  regular: 'bg-blue-100 text-blue-700',
  new: 'bg-sky-100 text-sky-700',
  at_risk: 'bg-amber-100 text-amber-700',
};

export default function IntelligencePage() {
  const { data, isLoading } = useStoreIntelligence();
  const { currentStore } = useAuthStore();
  const { t, locale } = useTranslation();
  const currency = currentStore?.currency ?? 'USD';
  const [query, setQuery] = useState('');
  const [copilotHistory, setCopilotHistory] = useState<{ q: string; answer: string; actions?: { label: string; href: string }[] }[]>([]);

  const ask = () => {
    if (!query.trim() || !data) return;
    // A Somali question always gets a Somali answer, even if the UI
    // language switcher is still set to English/Arabic.
    const effectiveLocale = isSomaliQuery(query) ? 'so' : locale;
    const res = answerCopilotQuery(query, data, currency, currentStore?.name, effectiveLocale);
    setCopilotHistory((h) => [{ q: query, ...res }, ...h].slice(0, 8));
    setQuery('');
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  return (
    <PageShell>
      <ReportPageHeader
        title={t('intelligence.title')}
        description={t('intelligence.description')}
      />

      <div className="space-y-5 mt-4">
        <DailyBriefingCard />
        <ExecutiveMetricsStrip />

        {/* AI Copilot */}
        <ReportWidget title={t('intelligence.copilotTitle')} subtitle={t('intelligence.copilotSubtitle')}>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder={t('intelligence.copilotPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              className="rounded-xl"
            />
            <Button onClick={ask} className="shrink-0 gap-1.5 bg-gradient-to-r from-blue-600 to-indigo-600">
              <Send className="h-4 w-4" /> {t('intelligence.askBtn')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {[t('intelligence.suggProfit'), t('intelligence.suggLowStock'), t('intelligence.suggDebts'), t('intelligence.suggHealth')].map((s) => (
              <button
                key={s}
                type="button"
                className="text-xs rounded-full bg-slate-100 hover:bg-blue-50 hover:text-blue-700 px-3 py-1 transition-colors"
                onClick={() => { setQuery(s); }}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {copilotHistory.map((h, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-400 mb-1">{t('intelligence.copilotYou', { q: h.q })}</p>
                <p className="text-slate-800">{h.answer}</p>
                {h.actions && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {h.actions.map((a) => (
                      <Link key={a.href} href={a.href} className="text-xs text-blue-600 hover:underline">{a.label}</Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!copilotHistory.length && (
              <p className="text-sm text-slate-400 text-center py-4">{t('intelligence.copilotEmpty')}</p>
            )}
          </div>
        </ReportWidget>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-4">
            <BusinessHealthCard />
            <GoalsWidget />
          </div>
          <div className="lg:col-span-2">
            <ActivityTimelineCard limit={12} />
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-48 rounded-2xl" />
        ) : data && (
          <>
            <ReportKpiGrid className="grid-cols-2 lg:grid-cols-4">
              <ReportKpiCard label={t('intelligence.kpiAlerts')} value={String(data.alerts.length)} icon={AlertTriangle} accent="orange" />
              <ReportKpiCard label={t('intelligence.kpiReorder')} value={String(data.forecasts.length)} icon={Package} accent="blue" />
              <ReportKpiCard label={t('intelligence.kpiDeadStock')} value={String(data.deadStock.length)} icon={TrendingDown} accent="rose" />
              <ReportKpiCard label={t('intelligence.kpiVip')} value={String(data.customerSegments.filter((c) => c.segment === 'vip').length)} icon={Users} accent="violet" />
            </ReportKpiGrid>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ReportWidget title={t('intelligence.reorderTitle')} subtitle={t('intelligence.reorderSub')}>
                <div className="space-y-2">
                  {data.forecasts.slice(0, 8).map((f) => (
                    <div key={f.productId} className="flex justify-between items-center text-sm border-b border-slate-50 pb-2">
                      <span className="font-medium truncate pr-2">{f.name}</span>
                      <span className="text-xs text-slate-500 shrink-0">
                        {f.daysUntilStockout !== null ? t('intelligence.reorderDaysLeft', { days: String(f.daysUntilStockout) }) : '—'} · {t('intelligence.reorderQty', { qty: String(f.suggestedReorderQty) })}
                      </span>
                    </div>
                  ))}
                  {!data.forecasts.length && <p className="text-sm text-slate-400 py-4 text-center">{t('intelligence.noReorders')}</p>}
                </div>
                <Link href="/dashboard/purchase" className="inline-flex mt-3 text-xs text-blue-600 hover:underline gap-1">
                  <ShoppingCart className="h-3 w-3" /> {t('intelligence.createPO')}
                </Link>
              </ReportWidget>

              <ReportWidget title={t('intelligence.deadStockTitle')} subtitle={t('intelligence.deadStockSub')}>
                <div className="space-y-2">
                  {data.deadStock.slice(0, 8).map((d) => (
                    <div key={d.productId} className="flex justify-between items-center text-sm">
                      <span className="truncate pr-2">{d.name}</span>
                      <Badge variant="secondary" className="text-[10px] capitalize shrink-0">{d.recommendation}</Badge>
                    </div>
                  ))}
                  {!data.deadStock.length && <p className="text-sm text-slate-400 py-4 text-center">{t('intelligence.noDeadStock')}</p>}
                </div>
              </ReportWidget>

              <ReportWidget title={t('intelligence.customerIntelTitle')} subtitle={t('intelligence.customerIntelSub')}>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {data.customerSegments.slice(0, 15).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded', SEGMENT_STYLE[c.segment])}>
                        {c.segment.replace('_', ' ')}
                      </span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-slate-400 tabular-nums text-xs">{fmt(c.totalPurchases)}</span>
                    </div>
                  ))}
                </div>
              </ReportWidget>

              <ReportWidget title={t('intelligence.purchaseRecTitle')} subtitle={t('intelligence.purchaseRecSub')}>
                <div className="space-y-2">
                  {data.purchaseRecommendations.slice(0, 10).map((r, i) => (
                    <div key={r.productId} className="flex gap-2 text-sm">
                      <span className="text-slate-400 w-5">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{r.name}</p>
                        <p className="text-xs text-slate-500">{r.reason} · {t('intelligence.recQty', { n: String(r.suggestedQty) })}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ReportWidget>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
