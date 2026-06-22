'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/lib/stores/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ReportTableShell, reportTableHead, reportTableHeadRight } from '@/components/reports/ReportLayout';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Plus, Users, DollarSign } from 'lucide-react';
import type { Employee, PayrollRun } from '@/types';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function PayrollTab() {
  const { currentStore, user } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showEmployee, setShowEmployee] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empSalary, setEmpSalary] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const currency = currentStore?.currency || 'USD';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

  const { data: employees = [], isLoading: loadingEmp } = useQuery({
    queryKey: ['employees', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('employees')
        .select('*')
        .eq('store_id', currentStore!.id)
        .eq('is_active', true)
        .order('full_name');
      return data as Employee[];
    },
    enabled: !!currentStore,
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['payroll-runs', currentStore?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('payroll_runs')
        .select('*')
        .eq('store_id', currentStore!.id)
        .order('created_at', { ascending: false })
        .limit(20);
      return data as PayrollRun[];
    },
    enabled: !!currentStore,
  });

  const { mutate: addEmployee, isPending: addingEmp } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.from('employees').insert({
        store_id: currentStore!.id,
        full_name: empName,
        base_salary: parseFloat(empSalary) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', currentStore?.id] });
      toast.success(t('payroll.employeeAdded'));
      setShowEmployee(false);
      setEmpName('');
      setEmpSalary('');
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: createRun, isPending: creatingRun } = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const items = employees.map((e) => ({
        employee_id: e.id,
        gross_pay: e.base_salary,
        deductions: 0,
        notes: null,
      }));
      const { data, error } = await supabase.rpc('create_payroll_run', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_items: items,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs', currentStore?.id] });
      toast.success(t('payroll.runCreated'));
      setShowRun(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const { mutate: processRun } = useMutation({
    mutationFn: async (runId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('process_payroll_run', {
        p_store_id: currentStore!.id,
        p_user_id: user!.id,
        p_payroll_run_id: runId,
        p_payment_method: 'cash',
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || 'Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-runs', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', currentStore?.id] });
      toast.success(t('payroll.runPosted'));
    },
    onError: (e) => toast.error(e.message),
  });

  if (loadingEmp || loadingRuns) return <Skeleton className="h-48 rounded-2xl" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('payroll.title')}</h3>
          <p className="text-xs text-slate-500">{t('payroll.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowEmployee(true)} className="gap-1">
            <Users className="h-4 w-4" /> {t('payroll.addEmployee')}
          </Button>
          <Button size="sm" onClick={() => setShowRun(true)} disabled={employees.length === 0} className="gap-1 bg-gradient-to-r from-blue-600 to-indigo-600">
            <DollarSign className="h-4 w-4" /> {t('payroll.runPayroll')}
          </Button>
        </div>
      </div>

      <ReportTableShell>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className={reportTableHead}>{t('payroll.colEmployee')}</th>
              <th className={reportTableHead}>{t('payroll.colRole')}</th>
              <th className={reportTableHeadRight}>{t('payroll.colBaseSalary')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {employees.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 font-medium">{e.full_name}</td>
                <td className="px-4 py-3 text-slate-500">{e.role_title || '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(e.base_salary)}</td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">{t('payroll.noEmployees')}</td></tr>
            )}
          </tbody>
        </table>
      </ReportTableShell>

      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t('payroll.runsTitle')}</h4>
        <ReportTableShell>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className={reportTableHead}>{t('payroll.colPeriod')}</th>
                <th className={reportTableHeadRight}>{t('payroll.colTotal')}</th>
                <th className={reportTableHead}>{t('payroll.colStatus')}</th>
                <th className={reportTableHead}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    {format(new Date(r.period_start), 'MMM d')} – {format(new Date(r.period_end), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{fmt(r.total_amount)}</td>
                  <td className="px-4 py-3">
                    <Badge className={r.status === 'paid' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => processRun(r.id)}>{t('payroll.payPost')}</Button>
                    )}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">{t('payroll.noRuns')}</td></tr>
              )}
            </tbody>
          </table>
        </ReportTableShell>
      </div>

      <Dialog open={showEmployee} onOpenChange={setShowEmployee}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('payroll.addEmployeeTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t('payroll.labelName')}</Label><Input value={empName} onChange={(e) => setEmpName(e.target.value)} /></div>
            <div><Label>{t('payroll.labelBaseSalary')}</Label><Input type="number" value={empSalary} onChange={(e) => setEmpSalary(e.target.value)} /></div>
            <Button onClick={() => addEmployee()} disabled={addingEmp || !empName}>
              {addingEmp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('payroll.saveButton')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRun} onOpenChange={setShowRun}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('payroll.createRunTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t('payroll.labelPeriodStart')}</Label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
            <div><Label>{t('payroll.labelPeriodEnd')}</Label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
            <p className="text-xs text-slate-500">{t('payroll.runSummary', { count: String(employees.length), total: fmt(employees.reduce((s, e) => s + e.base_salary, 0)) })}</p>
            <Button onClick={() => createRun()} disabled={creatingRun || !periodStart || !periodEnd}>
              {creatingRun && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('payroll.createDraft')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
