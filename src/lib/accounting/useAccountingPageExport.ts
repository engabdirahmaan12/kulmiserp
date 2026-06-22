'use client';

import { useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import type { AccountingTabId } from '@/components/accounting/AccountingNavSidebar';
import {
  exportAccountingTabCsv,
  exportAccountingTabExcel,
  exportFullAccountingWorkbook,
  fetchAccountingExportData,
} from '@/lib/accounting/accounting-export';
import { toast } from 'sonner';

export function useAccountingPageExport(activeTab: AccountingTabId) {
  const { currentStore, user } = useAuthStore();
  const [exporting, setExporting] = useState(false);

  const runExport = useCallback(
    async (mode: 'csv' | 'excel' | 'summary') => {
      if (!currentStore || !user) {
        toast.error('Store or user not loaded');
        return;
      }
      setExporting(true);
      try {
        const supabase = createClient();
        const data = await fetchAccountingExportData(supabase, currentStore, user.id);
        if (mode === 'csv') exportAccountingTabCsv(activeTab, data);
        else if (mode === 'excel') await exportAccountingTabExcel(activeTab, data);
        else await exportFullAccountingWorkbook(data);
        toast.success(
          mode === 'summary' ? 'Full accounting workbook downloaded' : 'Export downloaded',
        );
      } catch (err) {
        console.error(err);
        toast.error('Export failed — please try again');
      } finally {
        setExporting(false);
      }
    },
    [activeTab, currentStore, user],
  );

  return {
    exporting,
    exportCsv: () => runExport('csv'),
    exportExcel: () => runExport('excel'),
    exportSummary: () => runExport('summary'),
  };
}
