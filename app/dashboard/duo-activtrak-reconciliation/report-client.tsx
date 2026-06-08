'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  DuoActivTrakReconciliationRow,
  DuoDeviceWithoutActivTrakRow,
} from '@/lib/dashboard-data';
import { parseEnumParam } from '@/lib/search-params';
import { useUrlStateSync, type UrlStateField } from '@/lib/use-url-state-sync';

interface ReportClientProps {
  rows: DuoActivTrakReconciliationRow[];
  deviceRows: DuoDeviceWithoutActivTrakRow[];
  startDate: string;
  endDate: string;
  lastSyncedAt: Date | null;
}

type ViewMode = 'daily' | 'devices';
type StatusFilter = 'all' | 'needs-review' | 'matched' | 'duo-only' | 'activtrak-only' | 'location-conflict';

const VIEW_MODES: ViewMode[] = ['daily', 'devices'];
const STATUS_FILTERS: StatusFilter[] = ['all', 'needs-review', 'matched', 'duo-only', 'activtrak-only', 'location-conflict'];

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const normalized = value == null ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function formatDate(value: Date | null): string {
  if (!value) return '-';
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: Date | null): string {
  if (!value) return '-';
  return value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatHours(seconds: number): string {
  return `${(Math.max(0, seconds) / 3600).toFixed(1)}h`;
}

function statusTone(status: string, needsReview = false): string {
  if (needsReview || status === 'Duo Only') return 'bg-amber-50 text-amber-700';
  if (status === 'Matched') return 'bg-emerald-50 text-emerald-700';
  if (status === 'ActivTrak Only') return 'bg-sky-50 text-sky-700';
  return 'bg-gray-100 text-gray-600';
}

function matchesStatus(row: DuoActivTrakReconciliationRow, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs-review') return row.needsReview;
  if (filter === 'matched') return row.evidenceStatus === 'Matched';
  if (filter === 'duo-only') return row.evidenceStatus === 'Duo Only';
  if (filter === 'activtrak-only') return row.evidenceStatus === 'ActivTrak Only';
  return row.duoOfficeIpMatch !== row.activTrakOfficeIpMatch && (row.duoLoginCount > 0 || row.hasActivTrakDay);
}

export function DuoActivTrakReconciliationClient({
  rows,
  deviceRows,
  startDate,
  endDate,
  lastSyncedAt,
}: ReportClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>(() => parseEnumParam(searchParams.get('view'), VIEW_MODES, 'daily'));
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => (
    parseEnumParam(searchParams.get('status'), STATUS_FILTERS, 'needs-review')
  ));
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);

  useEffect(() => {
    setStart(startDate);
    setEnd(endDate);
  }, [endDate, startDate]);

  const syncedFields = useMemo<UrlStateField[]>(() => ([
    {
      current: viewMode,
      read: (params) => parseEnumParam(params.get('view'), VIEW_MODES, 'daily'),
      sync: (nextValue) => setViewMode((previous) => previous === nextValue ? previous : nextValue as ViewMode),
      write: (params) => {
        if (viewMode !== 'daily') params.set('view', viewMode);
        else params.delete('view');
      },
    },
    {
      current: search,
      read: (params) => params.get('q') || '',
      sync: (nextValue) => setSearch((previous) => previous === nextValue ? previous : nextValue as string),
      write: (params) => {
        if (search) params.set('q', search);
        else params.delete('q');
      },
    },
    {
      current: statusFilter,
      read: (params) => parseEnumParam(params.get('status'), STATUS_FILTERS, 'needs-review'),
      sync: (nextValue) => setStatusFilter((previous) => previous === nextValue ? previous : nextValue as StatusFilter),
      write: (params) => {
        if (statusFilter !== 'needs-review') params.set('status', statusFilter);
        else params.delete('status');
      },
    },
  ]), [search, statusFilter, viewMode]);

  useUrlStateSync({
    pathname: '/dashboard/duo-activtrak-reconciliation',
    router,
    searchParams,
    fields: syncedFields,
  });

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesStatus(row, statusFilter)) return false;
      if (!query) return true;
      return (
        (row.displayName || '').toLowerCase().includes(query) ||
        row.email.toLowerCase().includes(query) ||
        (row.department || '').toLowerCase().includes(query) ||
        (row.duoIps || '').toLowerCase().includes(query) ||
        (row.activTrakIps || '').toLowerCase().includes(query) ||
        (row.duoApplications || '').toLowerCase().includes(query)
      );
    });
  }, [rows, search, statusFilter]);

  const filteredDeviceRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return deviceRows.filter((row) => {
      if (!query) return true;
      return (
        (row.displayName || '').toLowerCase().includes(query) ||
        row.email.toLowerCase().includes(query) ||
        (row.department || '').toLowerCase().includes(query) ||
        (row.accessDeviceHostname || '').toLowerCase().includes(query) ||
        (row.accessDeviceIp || '').toLowerCase().includes(query) ||
        row.issueReason.toLowerCase().includes(query)
      );
    });
  }, [deviceRows, search]);

  const summary = {
    needsReview: rows.filter((row) => row.needsReview).length,
    duoOnly: rows.filter((row) => row.evidenceStatus === 'Duo Only').length,
    matched: rows.filter((row) => row.evidenceStatus === 'Matched').length,
    deviceGaps: deviceRows.length,
  };

  const applyDateRange = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('startDate', start);
    params.set('endDate', end);
    router.push(`/dashboard/duo-activtrak-reconciliation?${params.toString()}`);
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
    const dailyHeaders = [
      'Date', 'Employee', 'Email', 'Department', 'Status', 'Location Confidence',
      'Duo Logins', 'First Duo Login', 'Last Duo Login', 'Duo Apps', 'Duo IPs',
      'ActivTrak Hours', 'ActivTrak First Activity', 'ActivTrak Last Activity', 'ActivTrak IPs',
      'Needs Review',
    ];
    const deviceHeaders = [
      'Login Time', 'Employee', 'Email', 'Department', 'Application', 'IP', 'Hostname',
      'OS', 'Browser', 'Location', 'Trusted Endpoint', 'Issue',
    ];

    const csvRows = viewMode === 'daily'
      ? filteredRows.map((row) => [
          formatDate(row.date), row.displayName || row.email, row.email, row.department,
          row.evidenceStatus, row.locationConfidence, row.duoLoginCount,
          formatDateTime(row.firstDuoLoginAt), formatDateTime(row.lastDuoLoginAt),
          row.duoApplications, row.duoIps, formatHours(row.activTrakTotalSeconds),
          formatDateTime(row.activTrakFirstActivityAt), formatDateTime(row.activTrakLastActivityAt),
          row.activTrakIps, row.needsReview,
        ])
      : filteredDeviceRows.map((row) => [
          formatDateTime(row.eventTs), row.displayName || row.email, row.email, row.department,
          row.applicationName || row.destinationName, row.accessDeviceIp, row.accessDeviceHostname,
          [row.accessDeviceOs, row.accessDeviceOsVersion].filter(Boolean).join(' '),
          [row.accessDeviceBrowser, row.accessDeviceBrowserVersion].filter(Boolean).join(' '),
          [row.accessDeviceCity, row.accessDeviceState, row.accessDeviceCountry].filter(Boolean).join(', '),
          row.trustedEndpointStatus, row.issueReason,
        ]);

    const headers = viewMode === 'daily' ? dailyHeaders : deviceHeaders;
    const csv = [
      headers.map((cell) => escapeCsvCell(cell)).join(','),
      ...csvRows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
    ].join('\n');

    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `duo-activtrak-${viewMode}-${startDate}-${endDate}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Duo Reconciliation</h2>
          <p className="mt-1 text-sm text-gray-500">
            Cross-reference Duo login evidence with ActivTrak activity, IPs, and office signals.
          </p>
          {lastSyncedAt ? (
            <p className="mt-1 text-[12px] text-gray-400">Last sync {formatDateTime(lastSyncedAt)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-700">
            {viewMode === 'daily' ? filteredRows.length : filteredDeviceRows.length} rows
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
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Needs Review</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.needsReview}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Duo Only</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.duoOnly}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Matched</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.matched}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Device Gaps</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{summary.deviceGaps}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">View</span>
          <select
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value as ViewMode)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="daily">Daily Evidence</option>
            <option value="devices">Device Gaps</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Employee, IP, app, or hostname"
            className="w-64 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
        {viewMode === 'daily' ? (
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="all">All</option>
              <option value="needs-review">Needs review</option>
              <option value="matched">Matched</option>
              <option value="duo-only">Duo only</option>
              <option value="activtrak-only">ActivTrak only</option>
              <option value="location-conflict">Location conflict</option>
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Start date</span>
          <input
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">End date</span>
          <input
            type="date"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
        <button
          type="button"
          onClick={applyDateRange}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Apply
        </button>
      </div>

      {viewMode === 'daily' ? (
        <DailyEvidenceTable rows={filteredRows} />
      ) : (
        <DeviceGapTable rows={filteredDeviceRows} />
      )}
    </div>
  );
}

function DailyEvidenceTable({ rows }: { rows: DuoActivTrakReconciliationRow[] }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-gray-50/95 [&_th]:backdrop-blur">
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Evidence</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Duo</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">ActivTrak</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Location</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.email}-${row.date.toISOString()}`} className="border-b border-gray-50 align-top last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-800">{row.displayName || row.email}</div>
                <div className="text-[12px] text-gray-500">{row.email}</div>
                <div className="text-[12px] text-gray-500">{formatDate(row.date)} · {row.department || '-'}</div>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${statusTone(row.evidenceStatus, row.needsReview)}`}>
                  {row.evidenceStatus}
                </span>
                <div className="mt-2 text-[12px] text-gray-500">{row.needsReview ? 'Review' : 'OK'}</div>
              </td>
              <td className="max-w-[320px] px-4 py-3 text-gray-600">
                <div className="font-medium text-gray-800">{row.duoLoginCount} login{row.duoLoginCount === 1 ? '' : 's'}</div>
                <div className="text-[12px] text-gray-500">First {formatDateTime(row.firstDuoLoginAt)}</div>
                <div className="text-[12px] text-gray-500">Last {formatDateTime(row.lastDuoLoginAt)}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-[12px]">{row.duoApplications || '-'}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-[12px] text-gray-500">{row.duoIps || '-'}</div>
              </td>
              <td className="max-w-[320px] px-4 py-3 text-gray-600">
                <div className="font-medium text-gray-800">{formatHours(row.activTrakTotalSeconds)}</div>
                <div className="text-[12px] text-gray-500">First {formatDateTime(row.activTrakFirstActivityAt)}</div>
                <div className="text-[12px] text-gray-500">Last {formatDateTime(row.activTrakLastActivityAt)}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-[12px] text-gray-500">{row.activTrakIps || '-'}</div>
              </td>
              <td className="px-4 py-3 text-gray-600">
                <div className="font-medium text-gray-800">{row.locationConfidence}</div>
                <div className="text-[12px] text-gray-500">Duo office IP: {row.duoOfficeIpMatch ? 'Yes' : 'No'}</div>
                <div className="text-[12px] text-gray-500">ActivTrak office IP: {row.activTrakOfficeIpMatch ? 'Yes' : 'No'}</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-[12px]">{row.duoLocations || row.activTrakLocation || '-'}</div>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-gray-500">
                No rows match the current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function DeviceGapTable({ rows }: { rows: DuoDeviceWithoutActivTrakRow[] }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-gray-50/95 [&_th]:backdrop-blur">
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Duo Login</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Device</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">ActivTrak Evidence</th>
            <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Issue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.email}-${row.eventTs.toISOString()}-${row.accessDeviceIp || 'no-ip'}`} className="border-b border-gray-50 align-top last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-800">{row.displayName || row.email}</div>
                <div className="text-[12px] text-gray-500">{row.email}</div>
                <div className="text-[12px] text-gray-500">{row.department || '-'}</div>
              </td>
              <td className="px-4 py-3 text-gray-600">
                <div className="font-medium text-gray-800">{formatDateTime(row.eventTs)}</div>
                <div className="text-[12px] text-gray-500">{row.applicationName || row.destinationName || '-'}</div>
                <div className="text-[12px] text-gray-500">{row.accessDeviceIp || '-'}</div>
              </td>
              <td className="max-w-[300px] px-4 py-3 text-gray-600">
                <div className="font-medium text-gray-800">{row.accessDeviceHostname || '-'}</div>
                <div className="text-[12px] text-gray-500">{[row.accessDeviceOs, row.accessDeviceOsVersion].filter(Boolean).join(' ') || '-'}</div>
                <div className="text-[12px] text-gray-500">{[row.accessDeviceBrowser, row.accessDeviceBrowserVersion].filter(Boolean).join(' ') || '-'}</div>
                <div className="text-[12px] text-gray-500">{[row.accessDeviceCity, row.accessDeviceState, row.accessDeviceCountry].filter(Boolean).join(', ') || '-'}</div>
              </td>
              <td className="px-4 py-3 text-gray-600">
                <div className="text-[12px] text-gray-500">Identity: {row.hasActivTrakIdentifier ? 'Yes' : 'No'}</div>
                <div className="text-[12px] text-gray-500">Same day: {row.hasActivTrakDay ? 'Yes' : 'No'}</div>
                <div className="text-[12px] text-gray-500">Same IP: {row.hasActivTrakSameIp ? 'Yes' : 'No'}</div>
                <div className="text-[12px] text-gray-500">Last {formatDate(row.lastActivTrakActivity)}</div>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                  {row.issueReason}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-gray-500">
                No device gaps match the current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
