'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SuspiciousActivTrakIdentity } from '@/lib/dashboard-data';

interface ReportClientProps {
  rows: SuspiciousActivTrakIdentity[];
}

type FlagFilter =
  | 'all'
  | 'device-style'
  | 'identifier-mismatch'
  | 'non-email'
  | 'non-corporate'
  | 'no-identifier'
  | 'no-activity';

const FLAG_FILTERS: FlagFilter[] = [
  'all',
  'device-style',
  'identifier-mismatch',
  'non-email',
  'non-corporate',
  'no-identifier',
  'no-activity',
];

function escapeCsvCell(value: string | number | null | undefined): string {
  const normalized = value == null ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function formatDate(value: Date | null): string {
  if (!value) return '—';
  return value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getRowFlags(row: SuspiciousActivTrakIdentity): string[] {
  const flags: string[] = [];
  if (row.hasDeviceStyleIdentifier) flags.push('Device-style identifier');
  if (row.hasIdentifierMismatch) flags.push('Identifier mismatch');
  if (row.hasNonEmailIdentifier) flags.push('Non-email identifier');
  if (row.hasNonCorporateDomain) flags.push('Non-corporate domain');
  if (row.hasNoIdentifier) flags.push('No identifier');
  if (row.hasNoActivity) flags.push('No activity');
  return flags;
}

function matchesFlag(row: SuspiciousActivTrakIdentity, filter: FlagFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'device-style') return row.hasDeviceStyleIdentifier;
  if (filter === 'identifier-mismatch') return row.hasIdentifierMismatch;
  if (filter === 'non-email') return row.hasNonEmailIdentifier;
  if (filter === 'non-corporate') return row.hasNonCorporateDomain;
  if (filter === 'no-identifier') return row.hasNoIdentifier;
  return row.hasNoActivity;
}

export function SuspiciousActivTrakIdentitiesClient({ rows }: ReportClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [flagFilter, setFlagFilter] = useState<FlagFilter>(() => {
    const value = searchParams.get('flag');
    return FLAG_FILTERS.includes(value as FlagFilter) ? (value as FlagFilter) : 'all';
  });

  useEffect(() => {
    const nextSearch = searchParams.get('q') || '';
    const nextFlag = FLAG_FILTERS.includes(searchParams.get('flag') as FlagFilter)
      ? (searchParams.get('flag') as FlagFilter)
      : 'all';

    setSearch((previous) => (previous === nextSearch ? previous : nextSearch));
    setFlagFilter((previous) => (previous === nextFlag ? previous : nextFlag));
  }, [searchParams]);

  const buildStateParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (search) params.set('q', search);
    else params.delete('q');

    if (flagFilter !== 'all') params.set('flag', flagFilter);
    else params.delete('flag');

    return params;
  }, [flagFilter, search, searchParams]);

  useEffect(() => {
    const next = buildStateParams.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `/dashboard/activtrak-identities?${next}` : '/dashboard/activtrak-identities', { scroll: false });
    }
  }, [buildStateParams, router, searchParams]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesFlag(row, flagFilter)) return false;
      if (!query) return true;
      return (
        (row.displayName || '').toLowerCase().includes(query) ||
        row.email.toLowerCase().includes(query) ||
        (row.department || '').toLowerCase().includes(query) ||
        (row.identifiers || '').toLowerCase().includes(query)
      );
    });
  }, [flagFilter, rows, search]);

  const summary = {
    deviceStyle: filteredRows.filter((row) => row.hasDeviceStyleIdentifier).length,
    mismatch: filteredRows.filter((row) => row.hasIdentifierMismatch).length,
    noIdentifier: filteredRows.filter((row) => row.hasNoIdentifier).length,
    noActivity: filteredRows.filter((row) => row.hasNoActivity).length,
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const headers = [
      'Employee',
      'Email',
      'Department',
      'TBS Employee No',
      'ActivTrak ID',
      'ActivTrak User Name',
      'Identifiers',
      'Identifier Count',
      'Activity Rows',
      'First Seen',
      'Last Seen',
      'Flags',
    ];

    const csvRows = filteredRows.map((row) => [
      row.displayName,
      row.email,
      row.department,
      row.tbsEmployeeNo,
      row.actrkId,
      row.activTrakUserName || row.actrkEmployeeName,
      row.identifiers,
      row.identifierCount,
      row.activityRowCount,
      row.firstSeen ? formatDate(row.firstSeen) : '',
      row.lastSeen ? formatDate(row.lastSeen) : '',
      getRowFlags(row).join(' | '),
    ]);

    const csv = [
      headers.map((cell) => escapeCsvCell(cell)).join(','),
      ...csvRows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
    ].join('\n');

    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      'activtrak-identities.csv',
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">ActivTrak Identities</h2>
          <p className="mt-1 text-sm text-gray-500">
            Oracle-backed review of suspicious ActivTrak identity mappings and activity gaps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-700">
            {filteredRows.length}
            {filteredRows.length !== rows.length ? ` of ${rows.length}` : ''} suspicious users
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Filtered Rows</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{filteredRows.length}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Device-style</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.deviceStyle}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Identifier Mismatch</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.mismatch}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">No Activity</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.noActivity}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
            Search
          </span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Employee, email, department, or identifier"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
            Flag
          </span>
          <select
            value={flagFilter}
            onChange={(event) => setFlagFilter(event.target.value as FlagFilter)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All</option>
            <option value="device-style">Device-style identifier</option>
            <option value="identifier-mismatch">Identifier mismatch</option>
            <option value="non-email">Non-email identifier</option>
            <option value="non-corporate">Non-corporate domain</option>
            <option value="no-identifier">No identifier</option>
            <option value="no-activity">No activity</option>
          </select>
        </label>
        {(search || flagFilter !== 'all') ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setFlagFilter('all');
            }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Clear Filters
          </button>
        ) : null}
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-gray-50/95 [&_th]:backdrop-blur">
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">TBS / ActivTrak</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Identifiers</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Activity</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Flags</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={`${row.email}-${row.actrkId || 'none'}`} className="border-b border-gray-50 align-top last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{row.displayName || row.email}</div>
                  <div className="text-[12px] text-gray-500">{row.email}</div>
                  <div className="text-[12px] text-gray-500">{row.department || '—'} · {row.location || '—'}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <div className="font-medium text-gray-800">{row.actrkEmployeeName || row.activTrakUserName || '—'}</div>
                  <div className="text-[12px] text-gray-500">
                    TBS #{row.tbsEmployeeNo ?? '—'} · ACTRK #{row.actrkId ?? '—'}
                  </div>
                </td>
                <td className="max-w-[340px] px-4 py-3 text-gray-600">
                  <div className="whitespace-pre-wrap break-words text-[12px]">
                    {row.identifiers || '—'}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {row.identifierCount} identifier{row.identifierCount === 1 ? '' : 's'}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <div className="font-medium text-gray-800">{row.activityRowCount} rows</div>
                  <div className="text-[12px] text-gray-500">First {formatDate(row.firstSeen)}</div>
                  <div className="text-[12px] text-gray-500">Last {formatDate(row.lastSeen)}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {getRowFlags(row).map((flag) => (
                      <span
                        key={flag}
                        className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700"
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-gray-500">
                  No rows match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
