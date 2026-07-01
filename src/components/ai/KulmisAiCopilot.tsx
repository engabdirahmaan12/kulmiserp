'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  Sparkles,
  Send,
  Plus,
  Loader2,
  TrendingUp,
  Package,
  Users,
  Receipt,
  ShoppingCart,
  AlertTriangle,
  HeartPulse,
  FileText,
  Copy,
  Check,
  Bot,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAiCopilotStore } from '@/lib/stores/ai-copilot';
import { useStoreIntelligence } from '@/lib/hooks/useIntelligence';
import { useAuthStore } from '@/lib/stores/auth';
import { answerCopilotQuery, quickActionQuery, runQuickReport } from '@/lib/intelligence/copilot';
import { isSomaliQuery } from '@/lib/intelligence/query-language';
import { cn } from '@/lib/utils';
import type { ReportKind } from '@/lib/intelligence/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

const QUICK_ACTION_IDS: { id: string; labelKey: string; icon: typeof Sparkles; report?: ReportKind }[] = [
  { id: 'report', labelKey: 'ai.quickActions.report', icon: FileText, report: 'monthly' },
  { id: 'inventory', labelKey: 'ai.quickActions.inventory', icon: Package, report: 'inventory' },
  { id: 'debts', labelKey: 'ai.quickActions.debts', icon: Receipt, report: 'debt' },
  { id: 'customers', labelKey: 'ai.quickActions.customers', icon: Users },
  { id: 'expenses', labelKey: 'ai.quickActions.expenses', icon: ShoppingCart },
  { id: 'health', labelKey: 'ai.quickActions.health', icon: HeartPulse, report: 'health' },
];

const SUGGESTION_KEYS = [
  'ai.suggestions.todaySales',
  'ai.suggestions.lowStock',
  'ai.suggestions.debts',
  'ai.suggestions.profit',
  'ai.suggestions.bestSellers',
  'ai.suggestions.weeklyReport',
  'ai.suggestions.healthCheck',
] as const;

function parseStreamMeta(text: string) {
  const actionsMatch = text.match(/\[\[ACTIONS:([\s\S]*?)\]\]/);
  const sourceMatch = text.match(/\[\[SOURCE:(.*?)\]\]/);
  let content = text.replace(/\[\[ACTIONS:[\s\S]*?\]\]/, '').replace(/\[\[SOURCE:.*?\]\]/, '').trim();
  let actions: { label: string; href: string }[] | undefined;
  if (actionsMatch?.[1]) {
    try {
      actions = JSON.parse(actionsMatch[1]);
    } catch {
      /* ignore */
    }
  }
  const source = sourceMatch?.[1] === 'llm' ? 'llm' : 'rules';
  return { content, actions, source: source as 'llm' | 'rules' };
}

export function AiFloatingButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<AiFloatingButtonInner />, document.body);
}

function AiFloatingButtonInner() {
  const { open, toggle, fabExpanded, fabHydrated, toggleFab, hydrateFabPreference } =
    useAiCopilotStore();

  useEffect(() => {
    hydrateFabPreference();
  }, [hydrateFabPreference]);

  if (!fabHydrated) return null;

  return (
    <TooltipProvider delay={300}>
      <div
        className={cn(
          'fixed bottom-6 z-[60] flex items-center transition-all duration-300 ease-out',
          fabExpanded ? 'right-6' : 'right-0',
        )}
      >
        {/* Small arrow — collapse / expand */}
        <Tooltip>
          <TooltipTrigger
            className={cn(
              'flex h-10 w-7 shrink-0 items-center justify-center',
              'bg-gradient-to-b from-blue-600 to-indigo-600 text-white shadow-md',
              'hover:from-blue-700 hover:to-indigo-700 active:scale-95 transition-all',
              fabExpanded ? 'rounded-l-lg -mr-0.5' : 'rounded-l-xl h-12 w-8 shadow-lg',
            )}
            onClick={toggleFab}
            aria-label={fabExpanded ? 'Minimize AI button' : 'Show AI button'}
          >
            {fabExpanded ? (
              <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
            )}
          </TooltipTrigger>
          <TooltipContent side="left">
            {fabExpanded ? 'Hide button' : 'Show AI button'}
          </TooltipContent>
        </Tooltip>

        {/* Main AI button */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-300 ease-out',
            fabExpanded ? 'w-14 opacity-100' : 'w-0 opacity-0 pointer-events-none',
          )}
        >
          <Tooltip>
            <TooltipTrigger
              className={cn(
                'relative flex h-14 w-14 items-center justify-center rounded-full',
                'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/35',
                'transition-transform duration-200 hover:scale-105 active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
              )}
              onClick={toggle}
              aria-label="Ask KULMIS AI"
              aria-expanded={open}
            >
              <span className="absolute inset-0 rounded-full bg-blue-500/40 animate-ping opacity-60" />
              <span className="absolute inset-0 rounded-full ring-4 ring-blue-400/25 animate-pulse" />
              <Sparkles className="relative h-6 w-6" />
            </TooltipTrigger>
            <TooltipContent side="left">Ask KULMIS AI</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

function InsightCards({
  fmt,
  data,
}: {
  fmt: (n: number) => string;
  data: NonNullable<ReturnType<typeof useStoreIntelligence>['data']>;
}) {
  const cards = [
    { icon: TrendingUp, label: "Today's Sales", value: fmt(data.briefing.summary.sales), tone: 'text-blue-600 bg-blue-50' },
    { icon: TrendingUp, label: 'Monthly Profit', value: fmt(data.metrics.monthProfit), tone: 'text-emerald-600 bg-emerald-50' },
    {
      icon: Package,
      label: 'Low Stock',
      value: `${data.lowStockProducts.length} product${data.lowStockProducts.length === 1 ? '' : 's'}`,
      tone: data.lowStockProducts.length > 0 ? 'text-amber-600 bg-amber-50' : 'text-slate-600 bg-slate-50',
    },
    {
      icon: Users,
      label: 'Pending Debts',
      value: `${data.debtSummary.customersWithBalance} customer${data.debtSummary.customersWithBalance === 1 ? '' : 's'}`,
      tone: data.debtSummary.customersWithBalance > 0 ? 'text-rose-600 bg-rose-50' : 'text-slate-600 bg-slate-50',
    },
    { icon: Receipt, label: 'Monthly Revenue', value: fmt(data.metrics.monthRevenue), tone: 'text-violet-600 bg-violet-50' },
    { icon: ShoppingCart, label: 'Monthly Expenses', value: fmt(data.metrics.monthExpenses), tone: 'text-orange-600 bg-orange-50' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map(({ icon: Icon, label, value, tone }) => (
        <div key={label} className={cn('rounded-xl border border-slate-100 p-2.5', tone.split(' ').slice(1).join(' '))}>
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className={cn('h-3.5 w-3.5', tone.split(' ')[0])} />
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide truncate">{label}</p>
          </div>
          <p className={cn('text-sm font-bold tabular-nums truncate', tone.split(' ')[0])}>{value}</p>
        </div>
      ))}
    </div>
  );
}

export function KulmisAiCopilot() {
  const { open, setOpen, messages, newChat, addMessage, updateLastAssistant, collapseFab, fabExpanded } =
    useAiCopilotStore();
  const { currentStore, user } = useAuthStore();
  const { data, isLoading, refetch } = useStoreIntelligence();
  const { t, locale, formatCurrency } = useTranslation();
  const currency = currentStore?.currency ?? 'USD';
  const [query, setQuery] = useState('');
  const [thinking, setThinking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const quickActions = QUICK_ACTION_IDS.map((a) => ({ ...a, label: t(a.labelKey) }));
  const suggestions = SUGGESTION_KEYS.map((key) => t(key));

  const fmt = useCallback(
    (n: number) => formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    [currency, formatCurrency],
  );

  useEffect(() => {
    if (open) {
      refetch();
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open, refetch]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const ask = useCallback(
    async (text: string) => {
      if (!text.trim() || !data || !currentStore || thinking) return;

      const q = text.trim();
      // A Somali question always gets a Somali answer, even if the UI
      // language switcher is still set to English/Arabic.
      const effectiveLocale = isSomaliQuery(q) ? 'so' : locale;
      setQuery('');
      addMessage({ role: 'user', content: q });
      setThinking(true);
      addMessage({ role: 'assistant', content: '', source: 'rules' });

      try {
        const res = await fetch('/api/ai/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: currentStore.id,
            storeName: currentStore.name,
            currency,
            query: q,
            intelligence: data,
            userName: user?.full_name,
            stream: true,
            locale: effectiveLocale,
          }),
        });

        if (!res.ok || !res.body) {
          const fallback = answerCopilotQuery(q, data, currency, currentStore.name, effectiveLocale);
          updateLastAssistant(fallback.answer, { actions: fallback.actions, source: 'rules' });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          const { content } = parseStreamMeta(accumulated);
          updateLastAssistant(content);
        }

        const { content, actions, source } = parseStreamMeta(accumulated);
        updateLastAssistant(content, { actions, source });
      } catch {
        const fallback = answerCopilotQuery(q, data, currency, currentStore.name, effectiveLocale);
        updateLastAssistant(fallback.answer, { actions: fallback.actions, source: 'rules' });
      } finally {
        setThinking(false);
      }
    },
    [addMessage, currency, currentStore, data, locale, thinking, updateLastAssistant, user?.full_name],
  );

  const runQuick = (action: (typeof quickActions)[number]) => {
    if (!data || !currentStore) return;
    if (action.report) {
      const res = runQuickReport(action.report, data, currency, currentStore.name, locale);
      addMessage({ role: 'user', content: action.label });
      addMessage({ role: 'assistant', content: res.answer, actions: res.actions, source: 'rules' });
      return;
    }
    ask(quickActionQuery(action.id));
  };

  const copyReport = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <>
      <AiFloatingButton />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton
          className="w-full sm:w-[400px] sm:max-w-[400px] p-0 gap-0 border-l border-slate-200 flex flex-col h-full overflow-hidden"
        >
          {/* Header */}
          <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <Bot className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{t('ai.title')}</p>
                <p className="text-xs text-blue-100 truncate">{currentStore?.name ?? t('ai.yourStore')}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-white hover:bg-white/15 shrink-0"
                onClick={newChat}
              >
                <Plus className="h-3.5 w-3.5 me-1" /> {t('ai.newChat')}
              </Button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {/* Health + insights */}
            <div className="p-4 space-y-4 border-b border-slate-100 bg-slate-50/50">
              {isLoading || !data ? (
                <div className="flex items-center justify-center py-8 text-slate-400 text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading insights…
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                        <HeartPulse className="h-3.5 w-3.5 text-rose-500" /> Business Health
                      </p>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px] capitalize',
                          data.health.status === 'excellent' && 'bg-blue-100 text-blue-700',
                          data.health.status === 'good' && 'bg-indigo-100 text-indigo-700',
                          data.health.status === 'fair' && 'bg-amber-100 text-amber-700',
                          data.health.status === 'critical' && 'bg-red-100 text-red-700',
                        )}
                      >
                        {data.health.status}
                      </Badge>
                    </div>
                    <div className="flex items-end gap-2">
                      <span className="text-3xl font-bold text-slate-900 tabular-nums">{data.health.score}</span>
                      <span className="text-sm text-slate-400 mb-1">/100</span>
                    </div>
                    <Progress value={data.health.score} className="h-1.5 mt-2" />
                    <div className="mt-2 flex flex-wrap gap-1">
                      {data.health.factors.slice(0, 5).map((f) => (
                        <span key={f.label} className="text-[10px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
                          {f.label}: {Math.round(f.score)}
                        </span>
                      ))}
                    </div>
                  </div>

                  <InsightCards fmt={fmt} data={data} />

                  {data.briefing.recommendations[0] && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-900 flex gap-2">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600" />
                      <span>{data.briefing.recommendations[0]}</span>
                    </div>
                  )}

                  {data.metrics.growthRate !== null && (
                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                      <TrendingUp className={cn('h-3.5 w-3.5', data.metrics.growthRate >= 0 ? 'text-emerald-500' : 'text-red-500')} />
                      Sales {data.metrics.growthRate >= 0 ? 'up' : 'down'} {Math.abs(data.metrics.growthRate)}% vs last month
                    </p>
                  )}

                  {data.lowStockProducts.length > 0 && (
                    <p className="text-xs text-amber-800 flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Low stock: {data.lowStockProducts.slice(0, 3).map((p) => p.name).join(', ')}
                      {data.lowStockProducts.length > 3 ? ` +${data.lowStockProducts.length - 3} more` : ''}
                    </p>
                  )}
                </>
              )}

              {/* Quick actions */}
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Quick actions</p>
                <div className="flex flex-wrap gap-1.5">
                  {quickActions.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={!data || thinking}
                      onClick={() => runQuick(a)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50"
                    >
                      <a.icon className="h-3 w-3" />
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Suggested */}
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Suggested</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={thinking}
                      onClick={() => ask(s)}
                      className="text-[11px] rounded-full bg-white border border-slate-200 px-2.5 py-1 text-slate-600 hover:border-blue-200 hover:text-blue-700 transition-colors disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Chat history */}
            <div className="p-4 space-y-3 min-h-[120px]">
              {messages.length === 0 && !thinking && (
                <p className="text-center text-xs text-slate-400 py-6">
                  Ask anything about sales, inventory, debts, or reports
                </p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[92%] rounded-2xl px-3 py-2 text-sm',
                      m.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-slate-100 text-slate-800 rounded-bl-md',
                    )}
                  >
                    {m.role === 'assistant' && !m.content && thinking ? (
                      <span className="flex items-center gap-2 text-slate-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('ai.thinking')}
                      </span>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{m.content}</pre>
                    )}
                    {m.role === 'assistant' && m.content && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200/80">
                        {m.source === 'llm' && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1.5">AI</Badge>
                        )}
                        <button
                          type="button"
                          className="text-[10px] text-slate-500 hover:text-slate-700 flex items-center gap-0.5"
                          onClick={() => copyReport(m.content, m.id)}
                        >
                          {copied === m.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copied === m.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                    {m.actions && m.actions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.actions.map((a) => (
                          <Link
                            key={a.href + a.label}
                            href={a.href}
                            onClick={() => setOpen(false)}
                            className="text-[11px] text-blue-600 hover:underline"
                          >
                            {a.label} →
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Input footer */}
          <div className="shrink-0 border-t border-slate-100 bg-white p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(query);
              }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('ai.placeholder')}
                disabled={thinking || !data}
                className="rounded-xl text-sm h-10"
              />
              <Button
                type="submit"
                size="icon"
                disabled={thinking || !query.trim() || !data}
                className="shrink-0 h-10 w-10 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600"
              >
                {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            <div className="flex items-center justify-between mt-2 px-1">
              <p className="text-[10px] text-slate-400">
                Store-scoped · {currentStore?.name} data only
              </p>
              {fabExpanded && (
                <button
                  type="button"
                  onClick={collapseFab}
                  className="text-[10px] text-slate-400 hover:text-slate-600 underline-offset-2 hover:underline"
                >
                  Minimize
                </button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
