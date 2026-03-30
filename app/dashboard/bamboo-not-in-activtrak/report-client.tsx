'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BambooNotInActivTrakEmployee } from '@/lib/dashboard-data';
import { parseEnumParam, sanitizeParam } from '@/lib/search-params';
import { useUrlStateSync, type UrlStateField } from '@/lib/use-url-state-sync';

interface ReportClientProps {
  rows: BambooNotInActivTrakEmployee[];
}

type MappingFilter = 'all' | 'mapped' | 'unmapped';
type SortKey =
  | 'employeeId'
  | 'displayName'
  | 'email'
  | 'department'
  | 'location'
  | 'status'
  | 'tbsEmployeeNo'
  | 'tbsEmployeeName'
  | 'lastTbsEntry'
  | 'actrkId'
  | 'activTrakUser'
  | 'lastActivTrakActivity';
type SortDir = 'asc' | 'desc';

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

function formatDateTime(value: Date | null): string {
  if (!value) return '—';
  return value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function compareNullableText(a: string | null | undefined, b: string | null | undefined, dir: number): number {
  const left = (a || '').trim();
  const right = (b || '').trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return dir * left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined, dir: number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir * (a - b);
}

function compareNullableDate(a: Date | null | undefined, b: Date | null | undefined, dir: number): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir * (a.getTime() - b.getTime());
}

function mappingBadgeClass(isMapped: boolean): string {
  return isMapped
    ? 'bg-emerald-50 text-emerald-700'
    : 'bg-gray-100 text-gray-500';
}

function activTrakBadgeClass(row: Pick<BambooNotInActivTrakEmployee, 'hasActivTrakMapping' | 'hasActivTrakUser'>): string {
  if (row.hasActivTrakMapping) return 'bg-emerald-50 text-emerald-700';
  if (row.hasActivTrakUser) return 'bg-sky-50 text-sky-700';
  return 'bg-gray-100 text-gray-500';
}

function activTrakBadgeLabel(row: Pick<BambooNotInActivTrakEmployee, 'hasActivTrakMapping' | 'hasActivTrakUser'>): string {
  if (row.hasActivTrakMapping) return 'Mapped';
  if (row.hasActivTrakUser) return 'User only';
  return 'Missing';
}

function statusBadgeClass(status: string | null | undefined): string {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'active') return 'bg-emerald-50 text-emerald-700';
  if (normalized === 'inactive' || normalized === 'terminated') return 'bg-rose-50 text-rose-700';
  return 'bg-gray-100 text-gray-600';
}

function SortHeader({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  colKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      className="cursor-pointer whitespace-nowrap px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900"
      onClick={() => onSort(colKey)}
    >
      {label} {sortKey === colKey ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

export function BambooNotInActivTrakClient({ rows }: ReportClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bambooDepartments = useMemo(() => Array.from(
    new Set(
      rows
        .map((row) => row.department || 'Unknown')
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b)), [rows]);

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [bambooDepartmentFilter, setBambooDepartmentFilter] = useState(() =>
    sanitizeParam(searchParams.get('department'), bambooDepartments),
  );
  const [tbsMappingFilter, setTbsMappingFilter] = useState<MappingFilter>(() => {
    return parseEnumParam(searchParams.get('tbs'), ['all', 'mapped', 'unmapped'] as const, 'all');
  });
  const [activTrakMappingFilter, setActivTrakMappingFilter] = useState<MappingFilter>(() => {
    return parseEnumParam(searchParams.get('activtrak'), ['all', 'mapped', 'unmapped'] as const, 'all');
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    return parseEnumParam(
      searchParams.get('sortKey'),
      [
        'employeeId',
        'displayName',
        'email',
        'department',
        'location',
        'status',
        'tbsEmployeeNo',
        'tbsEmployeeName',
        'lastTbsEntry',
        'actrkId',
        'activTrakUser',
        'lastActivTrakActivity',
      ] as const,
      'displayName',
    );
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    return parseEnumParam(searchParams.get('sortDir'), ['asc', 'desc'] as const, 'asc');
  });

  const syncedFields = useMemo<UrlStateField[]>(() => ([
    {
      current: search,
      read: (params) => params.get('q') || '',
      sync: (nextValue) => {
        const nextSearch = nextValue as string;
        setSearch((previous) => (previous === nextSearch ? previous : nextSearch));
      },
      write: (params) => {
        if (search) params.set('q', search);
        else params.delete('q');
      },
    },
    {
      current: bambooDepartmentFilter,
      read: (params) => sanitizeParam(params.get('department'), bambooDepartments),
      sync: (nextValue) => {
        const nextDepartment = nextValue as string;
        setBambooDepartmentFilter((previous) => (
          previous === nextDepartment ? previous : nextDepartment
        ));
      },
      write: (params) => {
        if (bambooDepartmentFilter !== 'all') params.set('department', bambooDepartmentFilter);
        else params.delete('department');
      },
    },
    {
      current: tbsMappingFilter,
      read: (params) => parseEnumParam(params.get('tbs'), ['all', 'mapped', 'unmapped'] as const, 'all'),
      sync: (nextValue) => {
        const nextTbsFilter = nextValue as MappingFilter;
        setTbsMappingFilter((previous) => (previous === nextTbsFilter ? previous : nextTbsFilter));
      },
      write: (params) => {
        if (tbsMappingFilter !== 'all') params.set('tbs', tbsMappingFilter);
        else params.delete('tbs');
      },
    },
    {
      current: activTrakMappingFilter,
      read: (params) => parseEnumParam(params.get('activtrak'), ['all', 'mapped', 'unmapped'] as const, 'all'),
      sync: (nextValue) => {
        const nextActivTrakFilter = nextValue as MappingFilter;
        setActivTrakMappingFilter((previous) => (
          previous === nextActivTrakFilter ? previous : nextActivTrakFilter
        ));
      },
      write: (params) => {
        if (activTrakMappingFilter !== 'all') params.set('activtrak', activTrakMappingFilter);
        else params.delete('activtrak');
      },
    },
    {
      current: sortKey,
      read: (params) => parseEnumParam(
        params.get('sortKey'),
        [
          'employeeId',
          'displayName',
          'email',
          'department',
          'location',
          'status',
          'tbsEmployeeNo',
          'tbsEmployeeName',
          'lastTbsEntry',
          'actrkId',
          'activTrakUser',
          'lastActivTrakActivity',
        ] as const,
        'displayName',
      ),
      sync: (nextValue) => {
        const nextSortKey = nextValue as SortKey;
        setSortKey((previous) => (previous === nextSortKey ? previous : nextSortKey));
      },
      write: (params) => {
        if (sortKey !== 'displayName') params.set('sortKey', sortKey);
        else params.delete('sortKey');
      },
    },
    {
      current: sortDir,
      read: (params) => parseEnumParam(params.get('sortDir'), ['asc', 'desc'] as const, 'asc'),
      sync: (nextValue) => {
        const nextSortDir = nextValue as SortDir;
        setSortDir((previous) => (previous === nextSortDir ? previous : nextSortDir));
      },
      write: (params) => {
        if (sortDir !== 'asc') params.set('sortDir', sortDir);
        else params.delete('sortDir');
      },
    },
  ]), [
    activTrakMappingFilter,
    bambooDepartmentFilter,
    bambooDepartments,
    search,
    sortDir,
    sortKey,
    tbsMappingFilter,
  ]);

  useUrlStateSync({
    pathname: '/dashboard/bamboo-not-in-activtrak',
    router,
    searchParams,
    fields: syncedFields,
  });

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesDepartment =
        bambooDepartmentFilter === 'all'
          ? true
          : (row.department || 'Unknown') === bambooDepartmentFilter;
      const matchesTbsMapping =
        tbsMappingFilter === 'all'
          ? true
          : tbsMappingFilter === 'mapped'
            ? !!row.tbsEmployeeNo
            : !row.tbsEmployeeNo;
      const matchesActivTrakMapping =
        activTrakMappingFilter === 'all'
          ? true
          : activTrakMappingFilter === 'mapped'
            ? row.hasActivTrakMapping
            : !row.hasActivTrakMapping;

      if (!(matchesDepartment && matchesTbsMapping && matchesActivTrakMapping)) return false;
      if (!query) return true;

      return [
        row.employeeId,
        row.email,
        row.displayName,
        row.department,
        row.location,
        row.status,
        row.tbsEmployeeName,
        row.activTrakUser,
        row.tbsEmployeeNo != null ? String(row.tbsEmployeeNo) : '',
        row.actrkId != null ? String(row.actrkId) : '',
      ].some((value) => (value || '').toLowerCase().includes(query));
    });
  }, [activTrakMappingFilter, bambooDepartmentFilter, rows, search, tbsMappingFilter]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      if (sortKey === 'employeeId') return compareNullableText(a.employeeId, b.employeeId, dir);
      if (sortKey === 'displayName') return compareNullableText(a.displayName || a.email, b.displayName || b.email, dir);
      if (sortKey === 'email') return compareNullableText(a.email, b.email, dir);
      if (sortKey === 'department') return compareNullableText(a.department, b.department, dir);
      if (sortKey === 'location') return compareNullableText(a.location, b.location, dir);
      if (sortKey === 'status') return compareNullableText(a.status, b.status, dir);
      if (sortKey === 'tbsEmployeeNo') return compareNullableNumber(a.tbsEmployeeNo, b.tbsEmployeeNo, dir);
      if (sortKey === 'tbsEmployeeName') return compareNullableText(a.tbsEmployeeName, b.tbsEmployeeName, dir);
      if (sortKey === 'lastTbsEntry') return compareNullableDate(a.lastTbsEntry, b.lastTbsEntry, dir);
      if (sortKey === 'actrkId') return compareNullableNumber(a.actrkId, b.actrkId, dir);
      if (sortKey === 'activTrakUser') return compareNullableText(a.activTrakUser, b.activTrakUser, dir);
      if (sortKey === 'lastActivTrakActivity') {
        return compareNullableDate(a.lastActivTrakActivity, b.lastActivTrakActivity, dir);
      }
      return 0;
    });
  }, [filteredRows, sortDir, sortKey]);

  const mappedCount = filteredRows.filter((row) => !!row.tbsEmployeeNo).length;
  const activTrakMappedCount = filteredRows.filter((row) => row.hasActivTrakMapping).length;
  const activTrakUnmappedCount = filteredRows.length - activTrakMappedCount;

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
      'Employee ID',
      'Employee',
      'Email',
      'Department',
      'Location',
      'Status',
      'TBS Employee No',
      'TBS Employee Name',
      'Last TBS Entry',
      'ActivTrak ID',
      'ActivTrak User',
      'Last ActivTrak Activity',
      'Has TBS Mapping',
      'Has ActivTrak Mapping',
      'Has ActivTrak User',
    ];

    const csvRows = sortedRows.map((row) => [
      row.employeeId,
      row.displayName || row.email,
      row.email,
      row.department,
      row.location,
      row.status,
      row.tbsEmployeeNo,
      row.tbsEmployeeName,
      row.lastTbsEntry ? formatDate(row.lastTbsEntry) : '',
      row.actrkId,
      row.activTrakUser,
      row.lastActivTrakActivity ? formatDateTime(row.lastActivTrakActivity) : '',
      row.tbsEmployeeNo ? 'Yes' : 'No',
      row.hasActivTrakMapping ? 'Yes' : 'No',
      row.hasActivTrakUser ? 'Yes' : 'No',
    ]);

    const csv = [
      headers.map((cell) => escapeCsvCell(cell)).join(','),
      ...csvRows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
    ].join('\n');

    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      'users-mappings.csv',
    );
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    if (key === 'tbsEmployeeNo' || key === 'actrkId' || key === 'lastTbsEntry' || key === 'lastActivTrakActivity') {
      setSortDir('desc');
      return;
    }
    setSortDir('asc');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Users Mappings</h2>
          <p className="mt-1 text-sm text-gray-500">
            Active Bamboo employees in Oracle with one row per record, grouped like the other audit tables and enriched with timelog-backed last-seen data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-700">
            {sortedRows.length}
            {sortedRows.length !== rows.length ? ` of ${rows.length}` : ''} employees
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
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Mapped To TBS</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{mappedCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Mapped To ActivTrak</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{activTrakMappedCount}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Unmapped In ActivTrak</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{activTrakUnmappedCount}</div>
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
            placeholder="Employee, email, department, TBS, or ActivTrak"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
            Bamboo Department
          </span>
          <select
            value={bambooDepartmentFilter}
            onChange={(event) => setBambooDepartmentFilter(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All departments</option>
            {bambooDepartments.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
            TBS Mapping
          </span>
          <select
            value={tbsMappingFilter}
            onChange={(event) => setTbsMappingFilter(event.target.value as MappingFilter)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All</option>
            <option value="mapped">Mapped to TBS</option>
            <option value="unmapped">Unmapped</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">
            ActivTrak Mapping
          </span>
          <select
            value={activTrakMappingFilter}
            onChange={(event) => setActivTrakMappingFilter(event.target.value as MappingFilter)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All</option>
            <option value="mapped">Mapped</option>
            <option value="unmapped">Unmapped</option>
          </select>
        </label>
        {(search || bambooDepartmentFilter !== 'all' || tbsMappingFilter !== 'all' || activTrakMappingFilter !== 'all') ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setBambooDepartmentFilter('all');
              setTbsMappingFilter('all');
              setActivTrakMappingFilter('all');
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
              <SortHeader label="Employee" colKey="displayName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="Organization" colKey="department" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="TBS Mapping" colKey="tbsEmployeeNo" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="Last TBS Entry" colKey="lastTbsEntry" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="ActivTrak Mapping" colKey="actrkId" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="Last ActivTrak Activity" colKey="lastActivTrakActivity" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.employeeId || row.email} className="border-b border-gray-50 align-top last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{row.displayName || row.email}</div>
                  <div className="text-[12px] text-gray-500">{row.email}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                    <span>ID {row.employeeId}</span>
                    <span className={`rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(row.status)}`}>
                      {row.status || 'Unknown'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <div className="font-medium text-gray-800">{row.department || '—'}</div>
                  <div className="text-[12px] text-gray-500">{row.location || 'Unknown location'}</div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {row.division || 'Unknown division'}
                    {row.jobTitle ? ` · ${row.jobTitle}` : ''}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <div className="font-medium text-gray-800">{row.tbsEmployeeName || '—'}</div>
                  <div className="text-[12px] text-gray-500">TBS #{row.tbsEmployeeNo ?? '—'}</div>
                  <div className="mt-1">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${mappingBadgeClass(!!row.tbsEmployeeNo)}`}>
                      {row.tbsEmployeeNo ? 'Mapped' : 'Missing'}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDate(row.lastTbsEntry)}</td>
                <td className="px-4 py-3 text-gray-600">
                  <div className="font-medium text-gray-800">{row.activTrakUser || '—'}</div>
                  <div className="text-[12px] text-gray-500">ACTRK #{row.actrkId ?? '—'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${activTrakBadgeClass(row)}`}>
                      {activTrakBadgeLabel(row)}
                    </span>
                    {row.hasActivTrakUser && !row.hasActivTrakMapping ? (
                      <span className="text-[11px] text-gray-500">User activity exists without a TBS-linked ID.</span>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDateTime(row.lastActivTrakActivity)}</td>
              </tr>
            ))}
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-gray-500">
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
