'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface AdminClientProps {
  roles: string[];
  tabs: string[];
  tabMetadata: Record<string, TabMetadata>;
  roleMap: Record<string, Record<string, boolean>>;
  directorUsers: Array<{
    name: string;
    email: string;
    department: string;
    jobTitle: string;
    reason: string;
  }>;
}

interface TabMetadata {
  label: string;
  path: string;
  adminOnly: boolean;
}

interface EmployeeResult {
  email: string;
  name: string;
  department: string;
  jobTitle: string;
}

interface EmployeeTabState {
  role: string;
  name: string;
  roleDefaults: Record<string, boolean>;
  overrides: Record<string, boolean>; // only keys with active overrides
}

type OverrideState = 'inherit' | 'show' | 'hide';

function formatRoleLabel(role: string): string {
  if (role === 'root-admin') return 'Root Admin';
  if (role === 'hr-admin') return 'HR Admin';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function isAdminRole(role: string): boolean {
  return role === 'root-admin' || role === 'hr-admin';
}

function formatTabLabel(tab: string, metadata?: TabMetadata): string {
  return metadata?.label || tab;
}

export function AdminClient({
  roles,
  tabs,
  tabMetadata,
  roleMap: initialRoleMap,
  directorUsers,
}: AdminClientProps) {
  const router = useRouter();
  const [roleMap, setRoleMap] = useState(initialRoleMap);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Employee override state
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<EmployeeResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeTabState | null>(null);
  const [loadingEmployee, setLoadingEmployee] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const callApi = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/admin/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Save failed');
      }
      setSaveMessage('Saved');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }, [router]);

  // ── Role default toggles ──────────────────────────────────────────────

  const toggleRole = async (role: string, tab: string) => {
    if (role === 'root-admin') return;
    const metadata = tabMetadata[tab];
    const newVal = !(roleMap[role]?.[tab] ?? false);
    if (newVal && metadata?.adminOnly && !isAdminRole(role)) {
      setSaveMessage(null);
      setSaveError(`${formatTabLabel(tab, metadata)} is admin-only and can only be shown to Root Admin or HR Admin.`);
      return;
    }
    const previousRow = roleMap[role];
    setRoleMap((prev) => ({
      ...prev,
      [role]: { ...prev[role], [tab]: newVal },
    }));
    try {
      await callApi({ action: 'set-role', role, tabKey: tab, visible: newVal });
    } catch (error) {
      setRoleMap((prev) => ({
        ...prev,
        [role]: previousRow,
      }));
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    }
  };

  // ── Employee search ───────────────────────────────────────────────────

  const searchEmployees = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    try {
      const res = await fetch(`/api/admin/tabs?search=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.employees || []);
        setShowSuggestions(true);
      }
    } catch { /* ignore */ }
  }, []);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchEmployees(value), 250);
  };

  const selectEmployee = async (emp: EmployeeResult) => {
    setSearchQuery(emp.email);
    setShowSuggestions(false);
    setLoadingEmployee(true);
    try {
      const res = await fetch(`/api/admin/tabs?email=${encodeURIComponent(emp.email)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedEmployee({
          role: data.role,
          name: data.name || emp.name,
          roleDefaults: data.roleDefaults,
          overrides: data.overrides,
        });
      }
    } finally {
      setLoadingEmployee(false);
    }
  };

  // ── Three-state override logic ────────────────────────────────────────

  const getOverrideState = (tab: string): OverrideState => {
    if (!selectedEmployee) return 'inherit';
    if (!(tab in selectedEmployee.overrides)) return 'inherit';
    return selectedEmployee.overrides[tab] ? 'show' : 'hide';
  };

  const getEffectiveVisibility = (tab: string): boolean => {
    if (!selectedEmployee) return false;
    if (tabMetadata[tab]?.adminOnly && !isAdminRole(selectedEmployee.role)) return false;
    const state = getOverrideState(tab);
    if (state === 'show') return true;
    if (state === 'hide') return false;
    return selectedEmployee.roleDefaults[tab] ?? false;
  };

  const setOverrideState = async (tab: string, state: OverrideState) => {
    if (!selectedEmployee) return;
    const metadata = tabMetadata[tab];
    if (state === 'show' && metadata?.adminOnly && !isAdminRole(selectedEmployee.role)) {
      setSaveMessage(null);
      setSaveError(`${formatTabLabel(tab, metadata)} is admin-only and can only be shown to Root Admin or HR Admin.`);
      return;
    }
    const email = searchQuery.trim().toLowerCase();
    const previousOverrides = selectedEmployee.overrides;

    if (state === 'inherit') {
      // Remove override
      const next = { ...selectedEmployee.overrides };
      delete next[tab];
      setSelectedEmployee({ ...selectedEmployee, overrides: next });
      try {
        await callApi({ action: 'remove-override', email, tabKey: tab });
      } catch (error) {
        setSelectedEmployee((current) => (
          current ? { ...current, overrides: previousOverrides } : current
        ));
        setSaveError(error instanceof Error ? error.message : 'Save failed');
      }
    } else {
      const visible = state === 'show';
      setSelectedEmployee({
        ...selectedEmployee,
        overrides: { ...selectedEmployee.overrides, [tab]: visible },
      });
      try {
        await callApi({ action: 'set-override', email, tabKey: tab, visible });
      } catch (error) {
        setSelectedEmployee((current) => (
          current ? { ...current, overrides: previousOverrides } : current
        ));
        setSaveError(error instanceof Error ? error.message : 'Save failed');
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Tab Visibility Admin</h2>
        <p className="text-sm text-gray-500">
          Configure report-tab visibility per role, with per-employee overrides. Root admin always sees every report.
        </p>
      </div>

      {saveError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
          {saveError}
        </div>
      ) : null}
      {saveMessage ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-[12px] text-green-700">
          {saveMessage}
        </div>
      ) : null}

      {/* ── Section 1: Role Defaults ─────────────────────────────────── */}
      <section>
        <h3 className="text-[15px] font-semibold text-gray-800 mb-4">Role Defaults</h3>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                  Tab
                </th>
                {roles.map((role) => (
                  <th
                    key={role}
                    className="px-4 py-3 text-center text-[12px] font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {formatRoleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabs.map((tab) => {
                const metadata = tabMetadata[tab];
                return (
                  <tr key={tab} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-gray-700">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span>{formatTabLabel(tab, metadata)}</span>
                          {metadata?.adminOnly ? (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                              Admin only
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[11px] font-normal text-gray-400">
                          {metadata?.path || tab}
                        </span>
                      </div>
                    </td>
                    {roles.map((role) => {
                      const isVisible = roleMap[role]?.[tab] ?? false;
                      const cannotEnableAdminOnly = Boolean(metadata?.adminOnly && !isAdminRole(role) && !isVisible);
                      const isDisabled = saving || role === 'root-admin' || cannotEnableAdminOnly;
                      return (
                        <td key={role} className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => toggleRole(role, tab)}
                            disabled={isDisabled}
                            role="switch"
                            aria-checked={isVisible}
                            title={cannotEnableAdminOnly ? 'Admin-only reports can only be shown to Root Admin or HR Admin.' : undefined}
                            className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              isVisible ? 'bg-blue-500' : 'bg-gray-200'
                            } ${isDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
                            aria-label={`${formatRoleLabel(role)} ${formatTabLabel(tab, metadata)} visibility`}
                          >
                            <span
                              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                isVisible ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-800">Resolved Directors</h3>
            <p className="mt-1 text-[12px] text-gray-500">
              Live BambooHR classification for users who currently resolve to the `director` role.
            </p>
          </div>
          <div className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-medium text-blue-700">
            {directorUsers.length} directors
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Email</th>
                <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Department</th>
                <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Job Title</th>
                <th className="px-4 py-3 text-left text-[12px] font-medium uppercase tracking-wider text-gray-500">Reason</th>
              </tr>
            </thead>
            <tbody>
              {directorUsers.map((user) => (
                <tr key={user.email} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-800">{user.name}</td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3 text-gray-600">{user.department || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{user.jobTitle || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      {user.reason}
                    </span>
                  </td>
                </tr>
              ))}
              {directorUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-gray-500">
                    No users currently resolve to the director role.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Section 2: Employee Overrides ─────────────────────────────── */}
      <section>
        <h3 className="text-[15px] font-semibold text-gray-800 mb-4">Employee Overrides</h3>

        {/* Search with autocomplete */}
        <div ref={searchRef} className="relative mb-6 max-w-lg">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Search by name or email..."
            className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
              {suggestions.map((emp) => (
                <button
                  key={emp.email || emp.name}
                  onClick={() => selectEmployee(emp)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">
                    {(emp.name || emp.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 truncate">{emp.name || emp.email}</div>
                    <div className="text-[12px] text-gray-500 truncate">
                      {emp.email}{emp.department ? ` · ${emp.department}` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {loadingEmployee && (
          <div className="text-sm text-gray-500 animate-pulse">Loading employee config...</div>
        )}

        {/* Three-state override grid */}
        {selectedEmployee && !loadingEmployee && (
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-600">
                {selectedEmployee.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">{selectedEmployee.name}</div>
                <div className="text-[12px] text-gray-500">
                  Role: <span className="font-medium text-gray-700">{formatRoleLabel(selectedEmployee.role)}</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                      Tab
                    </th>
                    <th className="px-4 py-3 text-center text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                      Role Default
                    </th>
                    <th className="px-4 py-3 text-center text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                      Override
                    </th>
                    <th className="px-4 py-3 text-center text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                      Effective
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tabs.map((tab) => {
                    const metadata = tabMetadata[tab];
                    const state = getOverrideState(tab);
                    const effective = getEffectiveVisibility(tab);
                    const isAdminOnlyForEmployee = Boolean(metadata?.adminOnly && !isAdminRole(selectedEmployee.role));
                    const roleDefault = isAdminOnlyForEmployee ? false : selectedEmployee.roleDefaults[tab];

                    return (
                      <tr key={tab} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3 font-medium text-gray-700">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span>{formatTabLabel(tab, metadata)}</span>
                              {metadata?.adminOnly ? (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  Admin only
                                </span>
                              ) : null}
                            </div>
                            <span className="text-[11px] font-normal text-gray-400">
                              {metadata?.path || tab}
                            </span>
                          </div>
                        </td>

                        {/* Role default indicator */}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              roleDefault
                                ? 'bg-green-50 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {roleDefault ? 'Visible' : 'Hidden'}
                          </span>
                        </td>

                        {/* Three-state toggle */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setOverrideState(tab, 'inherit')}
                              disabled={saving}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                state === 'inherit'
                                  ? 'bg-gray-800 text-white'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              Inherit
                            </button>
                            <button
                              onClick={() => setOverrideState(tab, 'show')}
                              disabled={saving || isAdminOnlyForEmployee}
                              title={isAdminOnlyForEmployee ? 'Admin-only reports can only be shown to Root Admin or HR Admin.' : undefined}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                state === 'show'
                                  ? 'bg-green-600 text-white'
                                  : 'bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-700'
                              } ${isAdminOnlyForEmployee ? 'cursor-not-allowed opacity-50 hover:bg-gray-100 hover:text-gray-500' : ''
                              }`}
                            >
                              Show
                            </button>
                            <button
                              onClick={() => setOverrideState(tab, 'hide')}
                              disabled={saving}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                state === 'hide'
                                  ? 'bg-red-600 text-white'
                                  : 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-700'
                              }`}
                            >
                              Hide
                            </button>
                          </div>
                        </td>

                        {/* Effective result */}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              effective
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${effective ? 'bg-green-500' : 'bg-red-400'}`} />
                            {effective ? 'Visible' : 'Hidden'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
