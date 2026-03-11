'use client';

import { useState } from 'react';

interface ReportClientProps {
  rows: Array<{
    employeeId: string;
    email: string;
    displayName: string | null;
    department: string | null;
    location: string | null;
    status: string | null;
    tbsEmployeeNo: number | null;
    tbsEmployeeName: string | null;
    activTrakUser: string | null;
    actrkId: number | null;
    hasActivTrakMapping: boolean;
    hasActivTrakUser: boolean;
  }>;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const normalized = value == null ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function BambooNotInActivTrakClient({ rows }: ReportClientProps) {
  const [bambooDepartmentFilter, setBambooDepartmentFilter] = useState('all');
  const [tbsMappingFilter, setTbsMappingFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [activTrakMappingFilter, setActivTrakMappingFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');

  const bambooDepartments = Array.from(
    new Set(
      rows
        .map((row) => row.department || 'Unknown')
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const filteredRows = rows.filter((row) => {
    const matchesDepartment =
      bambooDepartmentFilter === 'all'
        ? true
        : (row.department || 'Unknown') === bambooDepartmentFilter;
    const matchesMapping =
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

    return matchesDepartment && matchesMapping && matchesActivTrakMapping;
  });

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
      'Email',
      'Display Name',
      'Bamboo Department',
      'Status',
      'TBS Employee No',
      'TBS Employee Name',
      'ActivTrak User',
      'ActivTrak ID',
    ];

    const csvRows = filteredRows.map((row) => [
      row.employeeId,
      row.email,
      row.displayName,
      row.department,
      row.status,
      row.tbsEmployeeNo,
      row.tbsEmployeeName,
      row.activTrakUser,
      row.actrkId,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Users Mappings</h2>
          <p className="mt-1 text-sm text-gray-500">
            Active Bamboo employees in Oracle with their TBS and ActivTrak mappings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-700">
            {filteredRows.length}
            {filteredRows.length !== rows.length ? ` of ${rows.length}` : ''} employees
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
            Bamboo Department
          </span>
          <select
            value={bambooDepartmentFilter}
            onChange={(e) => setBambooDepartmentFilter(e.target.value)}
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
            onChange={(e) => setTbsMappingFilter(e.target.value as 'all' | 'mapped' | 'unmapped')}
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
            onChange={(e) => setActivTrakMappingFilter(e.target.value as 'all' | 'mapped' | 'unmapped')}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">All</option>
            <option value="mapped">Mapped to ActivTrak</option>
            <option value="unmapped">Unmapped in ActivTrak</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setBambooDepartmentFilter('all');
            setTbsMappingFilter('all');
            setActivTrakMappingFilter('all');
          }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Reset Filters
        </button>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-gray-50/95 [&_th]:backdrop-blur">
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Email</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Bamboo Department</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">TBS User</th>
              <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">ActivTrak User</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.email} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{row.displayName || row.email}</div>
                  <div className="text-[12px] text-gray-500">
                    ID {row.employeeId}
                    {row.status ? ` · ${row.status}` : ''}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{row.email}</td>
                <td className="px-4 py-3 text-gray-600">{row.department || '—'}</td>
                <td className="px-4 py-3 text-gray-600">
                  {row.tbsEmployeeNo ? (
                    <div>
                      <div className="font-medium text-gray-800">{row.tbsEmployeeName || row.tbsEmployeeNo}</div>
                      <div className="text-[12px] text-gray-500">#{row.tbsEmployeeNo}</div>
                    </div>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {row.actrkId ? (
                    <div>
                      <div className="font-medium text-gray-800">{row.activTrakUser || '—'}</div>
                      <div className="text-[12px] text-gray-500">#{row.actrkId}</div>
                    </div>
                  ) : (
                    row.activTrakUser || '—'
                  )}
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
