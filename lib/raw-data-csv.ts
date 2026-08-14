import type { RawDataColumn, RawDataRow } from './raw-data-types';

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildRawDataCsvContent(columns: RawDataColumn[], rows: RawDataRow[]): string {
  const header = columns.map((column) => escapeCsvValue(column.label)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row[column.key])).join(','),
  );
  return [header, ...body].join('\n');
}
