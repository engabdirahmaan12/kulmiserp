export function escapeCsvCell(value: string | number | null | undefined): string {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

export function downloadCsv(content: string, filename: string) {
  downloadBlob(content, filename, 'text/csv;charset=utf-8');
}

export function downloadBlob(content: string, filename: string, mimeType: string) {
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

export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\n');
}

export async function writeExcelWorkbook(
  sheets: { name: string; rows: (string | number | null | undefined)[][] }[],
  filename: string,
) {
  const { utils, writeFileXLSX } = await import('xlsx');
  const wb = utils.book_new();
  for (const sheet of sheets) {
    const safeName = sheet.name.slice(0, 31).replace(/[\\/?*[\]]/g, '-');
    utils.book_append_sheet(wb, utils.aoa_to_sheet(sheet.rows), safeName);
  }
  writeFileXLSX(wb, filename);
}

export async function writeExcelSheet(
  rows: (string | number | null | undefined)[][],
  sheetName: string,
  filename: string,
) {
  await writeExcelWorkbook([{ name: sheetName, rows }], filename);
}

export function stampFilename(base: string, ext: string) {
  const date = new Date().toISOString().split('T')[0];
  return `${base}-${date}.${ext}`;
}
