'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { canViewAccounting, canWriteAccounting, getStoreRole } from '@/lib/accounting/permissions';
import { useAccountingPageExport } from '@/lib/accounting/useAccountingPageExport';
import { ChartOfAccountsTab } from '@/components/accounting/ChartOfAccountsTab';
import { JournalEntriesTab } from '@/components/accounting/JournalEntriesTab';
import { ExpensesTab } from '@/components/accounting/ExpensesTab';
import { TrialBalanceTab } from '@/components/accounting/TrialBalanceTab';
import { PnLTab } from '@/components/accounting/PnLTab';
import { AccountingDashboardTab } from '@/components/accounting/AccountingDashboardTab';
import { BalanceSheetTab } from '@/components/accounting/BalanceSheetTab';
import { CashFlowTab } from '@/components/accounting/CashFlowTab';
import { GeneralLedgerTab } from '@/components/accounting/GeneralLedgerTab';
import { PaymentAccountsTab } from '@/components/accounting/PaymentAccountsTab';
import { FundTransfersTab } from '@/components/accounting/FundTransfersTab';
import { ReceivablesTab } from '@/components/accounting/ReceivablesTab';
import { PayablesTab } from '@/components/accounting/PayablesTab';
import { AuditLogsTab } from '@/components/accounting/AuditLogsTab';
import { InventoryValuationTab } from '@/components/accounting/InventoryValuationTab';
import { CurrencyTab } from '@/components/accounting/CurrencyTab';
import { AccountingSettingsTab } from '@/components/accounting/AccountingSettingsTab';
import { PayrollTab } from '@/components/accounting/PayrollTab';
import { PeriodCloseTab } from '@/components/accounting/PeriodCloseTab';
import {
  AccountingNavSidebar,
  AccountingNavMobile,
  AccountingFinancialHeader,
  type AccountingTabId,
} from '@/components/accounting/AccountingNavSidebar';
import { PageShell } from '@/components/layout/PageShell';
import { ReportExportActions } from '@/components/reports/ReportLayout';
import { isAccountingTab } from '@/lib/i18n/nav-config';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function AccountingPage() {
  return (
    <Suspense fallback={<AccountingLoadingFallback />}>
      <AccountingPageInner />
    </Suspense>
  );
}

function AccountingLoadingFallback() {
  const { t } = useTranslation();
  return <PageShell><div className="p-8 text-slate-500">{t('accounting.loading')}</div></PageShell>;
}

function AccountingPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const tabParam = searchParams.get('tab');
  const expenseParam = searchParams.get('expense');
  const initialTab: AccountingTabId =
    expenseParam ? 'expenses' : isAccountingTab(tabParam) ? tabParam : 'dashboard';
  const [activeTab, setActiveTab] = useState<AccountingTabId>(initialTab);
  const { storeUser, currentStore, user } = useAuthStore();
  const role = getStoreRole(storeUser, currentStore, user?.id);
  const canView = canViewAccounting(role);
  const canWrite = canWriteAccounting(role);

  useEffect(() => {
    if (expenseParam) {
      setActiveTab('expenses');
      return;
    }
    if (isAccountingTab(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam, expenseParam]);

  if (!canView) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-slate-600 dark:text-slate-400">{t('accounting.noPermission')}</p>
          <button type="button" className="mt-4 text-sm text-blue-600 hover:underline" onClick={() => router.push('/dashboard')}>
            {t('accounting.returnDashboard')}
          </button>
        </div>
      </PageShell>
    );
  }

  const writeOnlyTabs: AccountingTabId[] = [
    'accounts', 'expenses', 'payroll', 'periods', 'currency', 'settings', 'valuation', 'receivables', 'payables', 'transfers',
  ];
  const effectiveTab = !canWrite && writeOnlyTabs.includes(activeTab) ? 'dashboard' : activeTab;

  const handleTabChange = (tab: AccountingTabId) => {
    setActiveTab(tab);
    const url = tab === 'dashboard' ? '/dashboard/accounting' : `/dashboard/accounting?tab=${tab}`;
    router.replace(url, { scroll: false });
  };

  return (
    <AccountingPageContent
      effectiveTab={effectiveTab}
      setActiveTab={handleTabChange}
      canWrite={canWrite}
      highlightExpenseId={expenseParam}
    />
  );
}

function AccountingPageContent({
  effectiveTab,
  setActiveTab,
  canWrite,
  highlightExpenseId,
}: {
  effectiveTab: AccountingTabId;
  setActiveTab: (tab: AccountingTabId) => void;
  canWrite: boolean;
  highlightExpenseId?: string | null;
}) {
  const { exportCsv, exportExcel, exportSummary, exporting } = useAccountingPageExport(effectiveTab);
  const { t } = useTranslation();

  return (
    <PageShell className="flex flex-col min-h-full pb-20">
      <div className="flex flex-1 min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <AccountingNavSidebar
          active={effectiveTab}
          onChange={setActiveTab}
          className="hidden md:flex w-[220px] lg:w-[240px] shrink-0"
          readOnly={!canWrite}
        />

        <div className="flex min-w-0 flex-1 flex-col bg-[#f9fafb] dark:bg-slate-950/50">
          <div className="flex items-center justify-end gap-2 border-b border-slate-100 bg-white px-4 py-2 print:hidden dark:border-slate-800 dark:bg-slate-900">
            <ReportExportActions
              showAiLink={false}
              showPrintButton
              disabled={exporting}
              onExportCsv={exportCsv}
              onExportExcel={exportExcel}
              onExportSummary={exportSummary}
              summaryLabel={t('accounting.summaryLabel')}
              onPrint={() => window.print()}
            />
          </div>

          <AccountingFinancialHeader active={effectiveTab} onChange={setActiveTab} />
          <AccountingNavMobile active={effectiveTab} onChange={setActiveTab} readOnly={!canWrite} />

          <div className="flex-1 overflow-auto p-4 md:p-5 min-h-0" id="report-print-area">
            {effectiveTab === 'dashboard' && <AccountingDashboardTab />}
            {effectiveTab === 'pnl' && <PnLTab />}
            {effectiveTab === 'balance-sheet' && <BalanceSheetTab />}
            {effectiveTab === 'cash-flow' && <CashFlowTab />}
            {effectiveTab === 'trial-balance' && <TrialBalanceTab />}
            {effectiveTab === 'ledger' && <GeneralLedgerTab />}
            {effectiveTab === 'journals' && <JournalEntriesTab />}
            {effectiveTab === 'expenses' && (
              <ExpensesTab highlightExpenseId={highlightExpenseId} linkMode="accounting" />
            )}
            {effectiveTab === 'payments'   && <PaymentAccountsTab />}
            {effectiveTab === 'transfers'  && <FundTransfersTab />}
            {effectiveTab === 'receivables' && <ReceivablesTab />}
            {effectiveTab === 'payables' && <PayablesTab />}
            {effectiveTab === 'accounts' && <ChartOfAccountsTab />}
            {effectiveTab === 'payroll' && <PayrollTab />}
            {effectiveTab === 'valuation' && <InventoryValuationTab />}
            {effectiveTab === 'currency' && <CurrencyTab />}
            {effectiveTab === 'settings' && <AccountingSettingsTab />}
            {effectiveTab === 'periods' && <PeriodCloseTab />}
            {effectiveTab === 'audit' && <AuditLogsTab />}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
