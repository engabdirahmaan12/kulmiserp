import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Account,
  JournalEntry,
  Expense,
  Customer,
  AccountingAuditLog,
  Employee,
  PayrollRun,
  ExchangeRate,
  AccountingPeriod,
  Store,
  InventoryCostLayer,
} from '@/types';
import type { AccountingTabId } from '@/components/accounting/AccountingNavSidebar';
import { buildCsv, downloadCsv, stampFilename, writeExcelWorkbook } from '@/lib/export/spreadsheet';
import { buildJournalEntriesCsv } from '@/lib/accounting/ledger-export';
import {
  normalBalance,
  trialBalanceAmounts,
  sumAccountsByType,
  PAYMENT_ACCOUNT_CODES,
  getAccountByCode,
} from '@/lib/accounting/utils';

interface LedgerLine {
  id: string;
  debit_amount: number;
  credit_amount: number;
  line_description?: string;
  entry_number: string;
  entry_date: string;
  entry_description?: string;
  reference_type?: string;
  account_code: string;
  account_name: string;
}

type ValuationProduct = {
  id: string;
  name: string;
  sku?: string | null;
  stock_quantity: number;
  cost_price: number;
  brand?: string | null;
  category?: { name: string } | null;
};

type CostLayerRow = InventoryCostLayer & {
  product?: {
    name: string;
    sku?: string;
    brand?: string | null;
    category?: { name: string } | null;
  };
};

type SupplierRow = { id: string; name: string; phone?: string; balance: number };

export interface AccountingExportData {
  storeName: string;
  currency: string;
  inventoryCostMethod: string;
  secondaryCurrency?: string;
  generatedAt: string;
  accounts: Account[];
  journalEntries: JournalEntry[];
  expenses: Expense[];
  customers: Customer[];
  suppliers: SupplierRow[];
  auditLogs: AccountingAuditLog[];
  valuationProducts: ValuationProduct[];
  costLayers: CostLayerRow[];
  employees: Employee[];
  payrollRuns: PayrollRun[];
  exchangeRates: ExchangeRate[];
  periods: AccountingPeriod[];
  ledgerLines: LedgerLine[];
}

const PAYMENT_LABELS: Record<string, string> = {
  '1110': 'Cash',
  '1120': 'WAAFI',
  '1130': 'EVC Plus',
  '1140': 'SAHAL',
  '1150': 'ZAAD',
  '1160': 'Salaam Bank',
  '1165': 'Premier Bank',
  '1170': 'Dahabshiil Bank',
};

function computeMetrics(accounts: Account[]) {
  return {
    cashBalance: PAYMENT_ACCOUNT_CODES.reduce(
      (s, code) => s + normalBalance(getAccountByCode(accounts, code) ?? { balance: 0, account_type: 'asset' }),
      0,
    ),
    bankBalance: normalBalance(getAccountByCode(accounts, '1120') ?? { balance: 0, account_type: 'asset' }),
    accountsReceivable: normalBalance(getAccountByCode(accounts, '1200') ?? { balance: 0, account_type: 'asset' }),
    accountsPayable: normalBalance(getAccountByCode(accounts, '2100') ?? { balance: 0, account_type: 'liability' }),
    inventoryValue: normalBalance(getAccountByCode(accounts, '1300') ?? { balance: 0, account_type: 'asset' }),
    totalRevenue: sumAccountsByType(accounts, ['revenue']),
    totalExpenses: sumAccountsByType(accounts, ['expense', 'cogs']),
    netProfit: sumAccountsByType(accounts, ['revenue']) - sumAccountsByType(accounts, ['expense', 'cogs']),
    totalAssets: sumAccountsByType(accounts, ['asset']),
    totalLiabilities: sumAccountsByType(accounts, ['liability']),
    totalEquity: sumAccountsByType(accounts, ['equity']),
  };
}

function headerRow(title: string, storeName: string, currency: string): (string | number)[][] {
  return [
    [title],
    ['Store', storeName],
    ['Currency', currency],
    ['Generated', new Date().toISOString().split('T')[0]],
    [],
  ];
}

function buildDashboardSheet(data: AccountingExportData): (string | number)[][] {
  const m = computeMetrics(data.accounts);
  return [
    ...headerRow('Accounting Overview', data.storeName, data.currency),
    ['Metric', 'Amount'],
    ['Cash & Payment Accounts', m.cashBalance],
    ['Bank (WAAFI)', m.bankBalance],
    ['Accounts Receivable', m.accountsReceivable],
    ['Accounts Payable', m.accountsPayable],
    ['Inventory (GL)', m.inventoryValue],
    ['Total Revenue', m.totalRevenue],
    ['Total Expenses & COGS', m.totalExpenses],
    ['Net Profit', m.netProfit],
    ['Total Assets', m.totalAssets],
    ['Total Liabilities', m.totalLiabilities],
    ['Total Equity', m.totalEquity],
  ];
}

function buildPnLSheet(data: AccountingExportData): (string | number)[][] {
  const revenue = data.accounts.filter((a) => a.account_type === 'revenue');
  const cogs = data.accounts.filter((a) => a.account_type === 'cogs');
  const expenses = data.accounts.filter((a) => a.account_type === 'expense');
  const rows: (string | number)[][] = [
    ...headerRow('Profit & Loss', data.storeName, data.currency),
    ['Section', 'Code', 'Account', 'Amount'],
  ];
  rows.push(['REVENUE', '', '', '']);
  for (const a of revenue) rows.push(['', a.code, a.name, normalBalance(a)]);
  rows.push(['', '', 'Total Revenue', sumAccountsByType(data.accounts, ['revenue'])]);
  rows.push([]);
  rows.push(['COST OF GOODS SOLD', '', '', '']);
  for (const a of cogs) rows.push(['', a.code, a.name, normalBalance(a)]);
  rows.push(['', '', 'Total COGS', sumAccountsByType(data.accounts, ['cogs'])]);
  rows.push([]);
  rows.push(['OPERATING EXPENSES', '', '', '']);
  for (const a of expenses) rows.push(['', a.code, a.name, normalBalance(a)]);
  rows.push(['', '', 'Total Expenses', sumAccountsByType(data.accounts, ['expense'])]);
  rows.push([]);
  rows.push(['', '', 'Net Profit', computeMetrics(data.accounts).netProfit]);
  return rows;
}

function buildBalanceSheet(data: AccountingExportData): (string | number)[][] {
  const sections = [
    { label: 'ASSETS', types: ['asset'] as const },
    { label: 'LIABILITIES', types: ['liability'] as const },
    { label: 'EQUITY', types: ['equity'] as const },
  ];
  const rows: (string | number)[][] = [
    ...headerRow('Balance Sheet', data.storeName, data.currency),
    ['Section', 'Code', 'Account', 'Balance'],
  ];
  for (const sec of sections) {
    rows.push([sec.label, '', '', '']);
    const items = data.accounts.filter((a) => (sec.types as readonly string[]).includes(a.account_type));
    for (const a of items) rows.push(['', a.code, a.name, normalBalance(a)]);
    rows.push(['', '', `Total ${sec.label}`, sumAccountsByType(data.accounts, [...sec.types])]);
    rows.push([]);
  }
  return rows;
}

function buildCashFlowSheet(data: AccountingExportData): (string | number)[][] {
  let operating = 0;
  let investing = 0;
  let financing = 0;
  for (const line of data.ledgerLines) {
    const net = (line.debit_amount || 0) - (line.credit_amount || 0);
    if (['1110', '1120', '1130', '1140', '1150'].includes(line.account_code)) operating += net;
    else if (line.account_code === '1300') investing += net;
    else if (line.account_code === '2100') financing += net;
  }
  const m = computeMetrics(data.accounts);
  return [
    ...headerRow('Cash Flow Summary', data.storeName, data.currency),
    ['Category', 'Amount'],
    ['Operating (payment accounts activity)', operating],
    ['Investing (inventory)', investing],
    ['Financing (payables/equity)', financing],
    [],
    ['Cash & Payment Balance', m.cashBalance],
    ['Accounts Receivable', m.accountsReceivable],
    ['Accounts Payable', m.accountsPayable],
  ];
}

function buildTrialBalanceSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Trial Balance', data.storeName, data.currency),
    ['Code', 'Account', 'Type', 'Debit', 'Credit'],
  ];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const a of data.accounts) {
    const { debit, credit } = trialBalanceAmounts(a);
    totalDebit += debit;
    totalCredit += credit;
    rows.push([a.code, a.name, a.account_type, debit || '', credit || '']);
  }
  rows.push(['', 'TOTAL', '', totalDebit, totalCredit]);
  return rows;
}

function buildAccountsSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Chart of Accounts', data.storeName, data.currency),
    ['Code', 'Name', 'Type', 'Balance', 'Active', 'Description'],
  ];
  for (const a of data.accounts) {
    rows.push([a.code, a.name, a.account_type, a.balance, a.is_active ? 'Yes' : 'No', a.description ?? '']);
  }
  return rows;
}

function buildJournalSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Ledger Activity', data.storeName, data.currency),
    ['Entry Number', 'Date', 'Description', 'Reference', 'Account Code', 'Account Name', 'Debit', 'Credit'],
  ];
  for (const entry of data.journalEntries) {
    for (const line of entry.lines ?? []) {
      const acct = line.account as { code?: string; name?: string } | undefined;
      rows.push([
        entry.entry_number,
        entry.entry_date,
        entry.description ?? line.description ?? '',
        entry.reference_type ?? '',
        acct?.code ?? '',
        acct?.name ?? '',
        line.debit_amount > 0 ? line.debit_amount : '',
        line.credit_amount > 0 ? line.credit_amount : '',
      ]);
    }
  }
  return rows;
}

function buildGeneralLedgerSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('General Ledger', data.storeName, data.currency),
    ['Date', 'Entry #', 'Account', 'Description', 'Reference', 'Debit', 'Credit'],
  ];
  for (const line of data.ledgerLines) {
    rows.push([
      line.entry_date,
      line.entry_number,
      `${line.account_code} — ${line.account_name}`,
      line.line_description ?? line.entry_description ?? '',
      line.reference_type ?? '',
      line.debit_amount > 0 ? line.debit_amount : '',
      line.credit_amount > 0 ? line.credit_amount : '',
    ]);
  }
  return rows;
}

function buildExpensesSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Expenses', data.storeName, data.currency),
    ['Date', 'Description', 'Category', 'Amount', 'Payment', 'Status', 'Reference'],
  ];
  for (const e of data.expenses) {
    rows.push([
      e.expense_date,
      e.description,
      e.category ?? '',
      e.amount,
      e.payment_method ?? '',
      e.status ?? '',
      e.reference ?? '',
    ]);
  }
  return rows;
}

function buildPaymentsSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Payment Accounts', data.storeName, data.currency),
    ['Code', 'Method', 'Account Name', 'Balance'],
  ];
  for (const code of PAYMENT_ACCOUNT_CODES) {
    const a = getAccountByCode(data.accounts, code);
    if (!a) continue;
    rows.push([code, PAYMENT_LABELS[code] ?? code, a.name, normalBalance(a)]);
  }
  rows.push(['', '', 'Total', computeMetrics(data.accounts).cashBalance]);
  return rows;
}

function buildReceivablesSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Accounts Receivable', data.storeName, data.currency),
    ['Customer', 'Phone', 'Balance', 'Total Purchases'],
  ];
  for (const c of data.customers) {
    rows.push([c.full_name, c.phone ?? '', c.balance, c.total_purchases ?? 0]);
  }
  rows.push(['TOTAL', '', data.customers.reduce((s, c) => s + c.balance, 0), '']);
  return rows;
}

function buildPayablesSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Accounts Payable', data.storeName, data.currency),
    ['Supplier', 'Phone', 'Balance'],
  ];
  for (const s of data.suppliers) {
    rows.push([s.name, s.phone ?? '', s.balance]);
  }
  rows.push(['TOTAL', '', data.suppliers.reduce((s, c) => s + c.balance, 0)]);
  return rows;
}

function buildValuationProductsSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Inventory Valuation (Products)', data.storeName, data.currency),
    ['Product', 'SKU', 'Brand', 'Category', 'Qty', 'Unit Cost', 'Total Value'],
  ];
  for (const p of data.valuationProducts) {
    rows.push([
      p.name,
      p.sku ?? '',
      p.brand ?? '',
      p.category?.name ?? '',
      p.stock_quantity,
      p.cost_price,
      p.stock_quantity * p.cost_price,
    ]);
  }
  return rows;
}

function buildValuationLayersSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('FIFO Cost Layers', data.storeName, data.currency),
    ['Product', 'SKU', 'Received', 'Qty Remaining', 'Unit Cost', 'Layer Value', 'Source'],
  ];
  for (const l of data.costLayers) {
    rows.push([
      l.product?.name ?? '',
      l.product?.sku ?? '',
      l.received_at?.split('T')[0] ?? '',
      l.quantity_remaining,
      l.unit_cost,
      l.quantity_remaining * l.unit_cost,
      l.source_type ?? '',
    ]);
  }
  return rows;
}

function buildPayrollSheet(data: AccountingExportData): (string | number)[][] {
  const empRows: (string | number)[][] = [
    ...headerRow('Payroll', data.storeName, data.currency),
    ['Employees'],
    ['Name', 'Role', 'Salary', 'Phone'],
  ];
  for (const e of data.employees) {
    empRows.push([e.full_name, e.role_title ?? '', e.base_salary ?? 0, e.phone ?? '']);
  }
  empRows.push([]);
  empRows.push(['Payroll Runs']);
  empRows.push(['Period Start', 'Period End', 'Total Amount', 'Status', 'Created']);
  for (const r of data.payrollRuns) {
    empRows.push([
      r.period_start,
      r.period_end,
      r.total_amount,
      r.status,
      r.created_at?.split('T')[0] ?? '',
    ]);
  }
  return empRows;
}

function buildCurrencySheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Currency Settings', data.storeName, data.currency),
    ['Base Currency', data.currency],
    ['Secondary Currency', data.secondaryCurrency ?? '—'],
    ['Inventory Cost Method', data.inventoryCostMethod],
    [],
    ['Exchange Rates'],
    ['From', 'To', 'Rate', 'Effective Date'],
  ];
  for (const r of data.exchangeRates) {
    rows.push([r.from_currency, r.to_currency, r.rate, r.effective_date]);
  }
  return rows;
}

function buildPeriodsSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Accounting Periods', data.storeName, data.currency),
    ['Name', 'Start', 'End', 'Status', 'Closed At'],
  ];
  for (const p of data.periods) {
    rows.push([
      p.name ?? '',
      p.period_start,
      p.period_end,
      p.status,
      p.closed_at?.split('T')[0] ?? '',
    ]);
  }
  return rows;
}

function buildAuditSheet(data: AccountingExportData): (string | number)[][] {
  const rows: (string | number)[][] = [
    ...headerRow('Audit Log', data.storeName, data.currency),
    ['When', 'Entity', 'Action', 'Details'],
  ];
  for (const log of data.auditLogs) {
    rows.push([
      log.created_at,
      log.entity_type,
      log.action,
      log.new_values ? JSON.stringify(log.new_values) : '',
    ]);
  }
  return rows;
}

const TAB_SHEET_BUILDERS: Record<
  AccountingTabId,
  (data: AccountingExportData) => { name: string; rows: (string | number)[][] }[]
> = {
  dashboard: (d) => [{ name: 'Overview', rows: buildDashboardSheet(d) }],
  pnl: (d) => [{ name: 'P&L', rows: buildPnLSheet(d) }],
  'balance-sheet': (d) => [{ name: 'Balance Sheet', rows: buildBalanceSheet(d) }],
  'cash-flow': (d) => [{ name: 'Cash Flow', rows: buildCashFlowSheet(d) }],
  'trial-balance': (d) => [{ name: 'Trial Balance', rows: buildTrialBalanceSheet(d) }],
  ledger: (d) => [{ name: 'General Ledger', rows: buildGeneralLedgerSheet(d) }],
  journals: (d) => [{ name: 'Ledger Activity', rows: buildJournalSheet(d) }],
  expenses: (d) => [{ name: 'Expenses', rows: buildExpensesSheet(d) }],
  payments: (d) => [{ name: 'Payment Accounts', rows: buildPaymentsSheet(d) }],
  receivables: (d) => [{ name: 'Receivables', rows: buildReceivablesSheet(d) }],
  payables: (d) => [{ name: 'Payables', rows: buildPayablesSheet(d) }],
  accounts: (d) => [{ name: 'Chart of Accounts', rows: buildAccountsSheet(d) }],
  payroll: (d) => [{ name: 'Payroll', rows: buildPayrollSheet(d) }],
  valuation: (d) => [
    { name: 'By Product', rows: buildValuationProductsSheet(d) },
    { name: 'FIFO Layers', rows: buildValuationLayersSheet(d) },
  ],
  currency: (d) => [{ name: 'Currency', rows: buildCurrencySheet(d) }],
  periods: (d) => [{ name: 'Periods', rows: buildPeriodsSheet(d) }],
  audit: (d) => [{ name: 'Audit Log', rows: buildAuditSheet(d) }],
  settings: () => [],
};

export async function fetchAccountingExportData(
  supabase: SupabaseClient,
  store: Store,
  userId: string,
): Promise<AccountingExportData> {
  const storeId = store.id;

  const [
    accountsRes,
    journalRes,
    expensesRes,
    customersRes,
    suppliersRes,
    auditRes,
    productsValRes,
    layersRes,
    employeesRes,
    payrollRes,
    ratesRes,
    periodsRes,
    ledgerRes,
  ] = await Promise.all([
    supabase.from('chart_of_accounts').select('*').eq('store_id', storeId).order('code'),
    supabase
      .from('journal_entries')
      .select('*, lines:journal_lines(*, account:chart_of_accounts(code, name))')
      .eq('store_id', storeId)
      .order('entry_date', { ascending: false })
      .limit(500),
    supabase.from('expenses').select('*').eq('store_id', storeId).order('expense_date', { ascending: false }).limit(500),
    supabase.from('customers').select('*').eq('store_id', storeId).gt('balance', 0).order('balance', { ascending: false }),
    supabase
      .from('suppliers')
      .select('id, name, phone, balance')
      .eq('store_id', storeId)
      .gt('balance', 0)
      .order('balance', { ascending: false }),
    supabase
      .from('accounting_audit_logs')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('products')
      .select('id, name, sku, stock_quantity, cost_price, brand, category:product_categories(name)')
      .eq('store_id', storeId)
      .eq('track_inventory', true)
      .gt('stock_quantity', 0)
      .order('name'),
    supabase
      .from('inventory_cost_layers')
      .select('*, product:products(name, sku, brand, category:product_categories(name))')
      .eq('store_id', storeId)
      .order('received_at', { ascending: true }),
    supabase.from('employees').select('*').eq('store_id', storeId).eq('is_active', true).order('full_name'),
    supabase
      .from('payroll_runs')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('exchange_rates')
      .select('*')
      .eq('store_id', storeId)
      .order('effective_date', { ascending: false })
      .limit(50),
    supabase.from('accounting_periods').select('*').eq('store_id', storeId).order('period_start', { ascending: false }),
    supabase.rpc('get_general_ledger', {
      p_store_id: storeId,
      p_user_id: userId,
      p_account_id: null,
      p_date_from: null,
      p_date_to: null,
      p_limit: 2000,
      p_offset: 0,
    }),
  ]);

  const ledgerResult = ledgerRes.data as {
    success?: boolean;
    lines?: LedgerLine[];
  } | null;

  return {
    storeName: store.name,
    currency: store.currency || 'USD',
    inventoryCostMethod: store.inventory_cost_method || 'average',
    secondaryCurrency: store.secondary_currency ?? undefined,
    generatedAt: new Date().toISOString(),
    accounts: (accountsRes.data ?? []) as Account[],
    journalEntries: (journalRes.data ?? []) as JournalEntry[],
    expenses: (expensesRes.data ?? []) as Expense[],
    customers: (customersRes.data ?? []) as Customer[],
    suppliers: (suppliersRes.data ?? []) as SupplierRow[],
    auditLogs: (auditRes.data ?? []) as AccountingAuditLog[],
    valuationProducts: (productsValRes.data ?? []) as unknown as ValuationProduct[],
    costLayers: (layersRes.data ?? []) as unknown as CostLayerRow[],
    employees: (employeesRes.data ?? []) as Employee[],
    payrollRuns: (payrollRes.data ?? []) as PayrollRun[],
    exchangeRates: (ratesRes.data ?? []) as ExchangeRate[],
    periods: (periodsRes.data ?? []) as AccountingPeriod[],
    ledgerLines: ledgerResult?.lines ?? [],
  };
}

function tabFilename(tab: AccountingTabId, ext: string) {
  const slug = tab.replace(/-/g, '_');
  return stampFilename(`accounting-${slug}`, ext);
}

export function exportAccountingTabCsv(tab: AccountingTabId, data: AccountingExportData) {
  const sheets = TAB_SHEET_BUILDERS[tab](data);
  const primary = sheets[0];
  if (!primary?.rows.length) return;

  if (tab === 'journals') {
    downloadCsv(buildJournalEntriesCsv(data.journalEntries), tabFilename(tab, 'csv'));
    return;
  }

  const dataStart = primary.rows.findIndex(
    (r) =>
      r[0] === 'Metric' ||
      r[0] === 'Section' ||
      r[0] === 'Code' ||
      r[0] === 'Date' ||
      r[0] === 'When' ||
      r[0] === 'Product' ||
      r[0] === 'Customer' ||
      r[0] === 'Supplier' ||
      r[0] === 'Name' ||
      r[0] === 'Base Currency' ||
      r[0] === 'Employees',
  );
  const headerRow = dataStart >= 0 ? (primary.rows[dataStart] as string[]) : primary.rows[0].map(String);
  const body = dataStart >= 0 ? primary.rows.slice(dataStart + 1) : primary.rows.slice(1);
  downloadCsv(buildCsv(headerRow, body), tabFilename(tab, 'csv'));
}

export async function exportAccountingTabExcel(tab: AccountingTabId, data: AccountingExportData) {
  const sheets = TAB_SHEET_BUILDERS[tab](data);
  await writeExcelWorkbook(sheets, tabFilename(tab, 'xlsx'));
}

export async function exportFullAccountingWorkbook(data: AccountingExportData) {
  const sheets = [
    { name: 'Summary', rows: buildDashboardSheet(data) },
    { name: 'P&L', rows: buildPnLSheet(data) },
    { name: 'Balance Sheet', rows: buildBalanceSheet(data) },
    { name: 'Trial Balance', rows: buildTrialBalanceSheet(data) },
    { name: 'Chart of Accounts', rows: buildAccountsSheet(data) },
    { name: 'Ledger Activity', rows: buildJournalSheet(data) },
    { name: 'General Ledger', rows: buildGeneralLedgerSheet(data) },
    { name: 'Expenses', rows: buildExpensesSheet(data) },
    { name: 'Payment Accounts', rows: buildPaymentsSheet(data) },
    { name: 'Receivables', rows: buildReceivablesSheet(data) },
    { name: 'Payables', rows: buildPayablesSheet(data) },
    { name: 'Inventory Valuation', rows: buildValuationProductsSheet(data) },
    { name: 'FIFO Layers', rows: buildValuationLayersSheet(data) },
    { name: 'Cash Flow', rows: buildCashFlowSheet(data) },
    { name: 'Payroll', rows: buildPayrollSheet(data) },
    { name: 'Currency', rows: buildCurrencySheet(data) },
    { name: 'Periods', rows: buildPeriodsSheet(data) },
    { name: 'Audit Log', rows: buildAuditSheet(data) },
  ];
  await writeExcelWorkbook(sheets, stampFilename('accounting-full-summary', 'xlsx'));
}
