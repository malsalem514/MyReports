'use client';

import { useState, useCallback } from 'react';

interface AdminClientProps {
  roles: string[];
  tabs: string[];
  roleMap: Record<string, Record<string, boolean>>;
}

export function AdminClient({ roles, tabs, roleMap: initialRoleMap }: AdminClientProps) {
  const [roleMap, setRoleMap] = useState(initialRoleMap);
  const [searchEmail, setSearchEmail] = useState('');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [overridesLoaded, setOverridesLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const callApi = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleRole = async (role: string, tab: string) => {
    const newVal = !roleMap[role][tab];
    setRoleMap((prev) => ({
      ...prev,
      [role]: { ...prev[role], [tab]: newVal },
    }));
    await callApi({ action: 'set-role', role, tabKey: tab, visible: newVal });
  };

  const loadOverrides = async () => {
    if (!searchEmail.trim()) return;
    const res = await fetch(
      `/api/admin/tabs?email=${encodeURIComponent(searchEmail.trim().toLowerCase())}`,
    );
    if (res.ok) {
      const data = await res.json();
      setOverrides(data.overrides || {});
    } else {
      setOverrides({});
    }
    setOverridesLoaded(true);
  };

  const toggleOverride = async (tab: string) => {
    const email = searchEmail.trim().toLowerCase();
    if (!email) return;

    if (tab in overrides) {
      // Toggle existing override
      const newVal = !overrides[tab];
      setOverrides((prev) => ({ ...prev, [tab]: newVal }));
      await callApi({ action: 'set-override', email, tabKey: tab, visible: newVal });
    } else {
      // Create new override (default: force-show)
      setOverrides((prev) => ({ ...prev, [tab]: true }));
      await callApi({ action: 'set-override', email, tabKey: tab, visible: true });
    }
  };

  const removeOverrideForTab = async (tab: string) => {
    const email = searchEmail.trim().toLowerCase();
    if (!email) return;
    const next = { ...overrides };
    delete next[tab];
    setOverrides(next);
    await callApi({ action: 'remove-override', email, tabKey: tab });
  };

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Tab Visibility Admin</h2>
        <p className="text-sm text-gray-500 mb-6">
          Configure which dashboard tabs are visible per role. Per-email overrides take priority.
        </p>
      </div>

      {/* Section 1: Role Defaults */}
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
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabs.map((tab) => (
                <tr key={tab} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-gray-700">{tab}</td>
                  {roles.map((role) => (
                    <td key={role} className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => toggleRole(role, tab)}
                        disabled={saving}
                        className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          roleMap[role]?.[tab]
                            ? 'bg-blue-500'
                            : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            roleMap[role]?.[tab] ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: User Overrides */}
      <section>
        <h3 className="text-[15px] font-semibold text-gray-800 mb-4">User Overrides</h3>
        <div className="flex items-center gap-3 mb-4">
          <input
            type="email"
            value={searchEmail}
            onChange={(e) => {
              setSearchEmail(e.target.value);
              setOverridesLoaded(false);
            }}
            placeholder="Employee email..."
            className="w-80 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={loadOverrides}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Load
          </button>
        </div>

        {overridesLoaded && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                    Tab
                  </th>
                  <th className="px-4 py-3 text-center text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                    Override
                  </th>
                  <th className="px-4 py-3 text-center text-[12px] font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {tabs.map((tab) => {
                  const hasOverride = tab in overrides;
                  return (
                    <tr key={tab} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-gray-700">{tab}</td>
                      <td className="px-4 py-2.5 text-center">
                        {hasOverride ? (
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              overrides[tab]
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {overrides[tab] ? 'Force Show' : 'Force Hide'}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Using role default</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center space-x-2">
                        <button
                          onClick={() => toggleOverride(tab)}
                          disabled={saving}
                          className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                        >
                          {hasOverride ? 'Toggle' : 'Add Override'}
                        </button>
                        {hasOverride && (
                          <button
                            onClick={() => removeOverrideForTab(tab)}
                            disabled={saving}
                            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
