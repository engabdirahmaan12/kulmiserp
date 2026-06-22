import type { JournalEntry } from '@/types';

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildJournalEntriesCsv(entries: JournalEntry[]): string {
  const header = [
    'Entry Number',
    'Date',
    'Description',
    'Reference Type',
    'Account Code',
    'Account Name',
    'Debit',
    'Credit',
  ];
  const rows: string[] = [header.map(escapeCsv).join(',')];

  for (const entry of entries) {
    for (const line of entry.lines ?? []) {
      const acct = line.account as { code?: string; name?: string } | undefined;
      rows.push(
        [
          entry.entry_number,
          entry.entry_date,
          entry.description ?? line.description ?? '',
          entry.reference_type ?? '',
          acct?.code ?? '',
          acct?.name ?? '',
          line.debit_amount > 0 ? line.debit_amount : '',
          line.credit_amount > 0 ? line.credit_amount : '',
        ]
          .map(escapeCsv)
          .join(','),
      );
    }
  }

  return rows.join('\n');
}

export function exportJournalEntriesCsv(entries: JournalEntry[], filename = 'ledger-activity.csv') {
  if (!entries.length) return;
  downloadBlob(buildJournalEntriesCsv(entries), filename, 'text/csv;charset=utf-8');
}

export async function exportJournalEntriesExcel(entries: JournalEntry[], filename = 'ledger-activity.xlsx') {
  if (!entries.length) return;
  const { utils, writeFileXLSX } = await import('xlsx');
  const sheetRows: (string | number)[][] = [
    ['Entry Number', 'Date', 'Description', 'Reference Type', 'Account Code', 'Account Name', 'Debit', 'Credit'],
  ];

  for (const entry of entries) {
    for (const line of entry.lines ?? []) {
      const acct = line.account as { code?: string; name?: string } | undefined;
      sheetRows.push([
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

  const ws = utils.aoa_to_sheet(sheetRows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Ledger Activity');
  writeFileXLSX(wb, filename);
}
