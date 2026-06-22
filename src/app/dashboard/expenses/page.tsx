'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ExpensesTab } from '@/components/accounting/ExpensesTab';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageShell, DataPanel } from '@/components/layout/PageShell';
import { Skeleton } from '@/components/ui/skeleton';
import { Receipt } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function ExpensesPage() {
  return (
    <Suspense
      fallback={
        <PageShell>
          <Skeleton className="h-24 w-full rounded-2xl mb-4" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </PageShell>
      }
    >
      <ExpensesPageInner />
    </Suspense>
  );
}

function ExpensesPageInner() {
  const expenseId = useSearchParams().get('expense');
  const { t } = useTranslation();

  return (
    <PageShell>
      <PageHeader
        title={t('expenses.title')}
        description={t('expenses.description')}
        icon={Receipt}
        variant="banner"
      />
      <DataPanel className="p-4 md:p-6">
        <ExpensesTab highlightExpenseId={expenseId} />
      </DataPanel>
    </PageShell>
  );
}
