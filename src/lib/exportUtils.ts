import * as XLSX from 'xlsx';
import type { CashFlow } from '../types';

/** A single exportable table: one CSV block / one Excel sheet. */
export type ExportSection = {
  /** Excel sheet name + CSV section title (when multiple sections). */
  sheetName: string;
  /** Used in the filename when only this section is exported. */
  slug: string;
  /** Column order; also the keys looked up on each row. */
  headers: string[];
  rows: Record<string, string | number | null | undefined>[];
};

/** Today's date as YYYY-MM-DD for filenames. */
export function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Build the download filename: trading-pms-<desk>-<slug|all>-<date>.<ext>
 * Single section → that section's slug; multiple → "all".
 */
export function buildFilename(desk: string, sections: ExportSection[], ext: 'csv' | 'xlsx'): string {
  const slug = sections.length === 1 ? sections[0].slug : 'all';
  return `trading-pms-${desk}-${slug}-${today()}.${ext}`;
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Combine sections into one CSV string. Multiple sections get a title line + blank-line separators. */
export function buildCSV(sections: ExportSection[]): string {
  const multi = sections.length > 1;
  return sections
    .map(sec => {
      const headerLine = sec.headers.map(csvEscape).join(',');
      const dataLines = sec.rows.map(r => sec.headers.map(h => csvEscape(r[h])).join(','));
      const body = [headerLine, ...dataLines].join('\n');
      return multi ? `${sec.sheetName}\n${body}` : body;
    })
    .join('\n\n');
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportCSV(desk: string, sections: ExportSection[]): void {
  const blob = new Blob([buildCSV(sections)], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(buildFilename(desk, sections, 'csv'), blob);
}

/** Excel sheet names: max 31 chars, none of [ ] : * ? / \ */
function sanitizeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
}

export function exportXLSX(desk: string, sections: ExportSection[]): void {
  const wb = XLSX.utils.book_new();
  sections.forEach(sec => {
    // Array-of-arrays keeps column order deterministic and keeps headers even when empty.
    const aoa = [sec.headers, ...sec.rows.map(r => sec.headers.map(h => r[h] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sec.sheetName));
  });
  XLSX.writeFile(wb, buildFilename(desk, sections, 'xlsx'));
}

/** Cash Flows section — identical columns across all three desks. Filters by desk defensively. */
export function cashFlowSection(cashFlows: CashFlow[], desk: string): ExportSection {
  const rows = cashFlows
    .filter(cf => cf.desk === desk)
    .map(cf => ({
      Date: cf.tanggal,
      Type: cf.tipe,
      Amount: cf.jumlah,
      Currency: cf.currency,
      'Account Type': cf.account_type,
      'Desk Tujuan': cf.desk_tujuan ?? '',
      Notes: cf.catatan ?? '',
    }));
  return {
    sheetName: 'Cash Flows',
    slug: 'cash-flows',
    headers: ['Date', 'Type', 'Amount', 'Currency', 'Account Type', 'Desk Tujuan', 'Notes'],
    rows,
  };
}
