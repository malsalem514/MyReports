import assert from 'node:assert/strict';
import test from 'node:test';
import * as tabConfig from '../lib/tab-config.ts';
import * as dashboardNavConfig from '../lib/dashboard-nav-config.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T; 'module.exports'?: T }).default
    ?? (mod as T & { default?: T; 'module.exports'?: T })['module.exports']
    ?? mod);
}

const {
  ADMIN_ONLY_TAB_KEYS,
  TAB_KEYS,
  getFallbackRoleDefaults,
} = getModuleExports(tabConfig);
const {
  DASHBOARD_TAB_LABELS,
  DASHBOARD_TAB_ROUTES,
  buildDashboardNavItems,
} = getModuleExports(dashboardNavConfig);

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function fallbackVisibleTabs(role: string): Set<string> {
  return new Set(
    getFallbackRoleDefaults()
      .filter((row) => row.ROLE_NAME === role && row.VISIBLE === 1)
      .map((row) => row.TAB_KEY),
  );
}

test('tab registry includes metadata for every controlled report', () => {
  assert.deepEqual(sorted(Object.keys(DASHBOARD_TAB_ROUTES)), sorted(TAB_KEYS));
  assert.deepEqual(sorted(Object.keys(DASHBOARD_TAB_LABELS)), sorted(TAB_KEYS));

  assert.ok(TAB_KEYS.includes('activtrak-identities'));
  assert.equal(DASHBOARD_TAB_LABELS['activtrak-identities'], 'ActivTrak Identities');
  assert.equal(DASHBOARD_TAB_ROUTES['activtrak-identities'], '/dashboard/activtrak-identities');
  assert.ok(TAB_KEYS.includes('duo-activtrak-reconciliation'));
  assert.equal(DASHBOARD_TAB_LABELS['duo-activtrak-reconciliation'], 'Duo Reconciliation');
  assert.equal(DASHBOARD_TAB_ROUTES['duo-activtrak-reconciliation'], '/dashboard/duo-activtrak-reconciliation');
  assert.ok(TAB_KEYS.includes('raw-data'));
  assert.equal(DASHBOARD_TAB_LABELS['raw-data'], 'Raw Data');
  assert.equal(DASHBOARD_TAB_ROUTES['raw-data'], '/dashboard/raw-data');
});

test('fallback role defaults keep admin-only reports limited to root and HR', () => {
  for (const role of ['root-admin', 'hr-admin']) {
    const visibleTabs = fallbackVisibleTabs(role);
    for (const tab of ADMIN_ONLY_TAB_KEYS) {
      assert.equal(visibleTabs.has(tab), true, `${role} should see ${tab}`);
    }
  }

  for (const role of ['director', 'manager', 'employee']) {
    const visibleTabs = fallbackVisibleTabs(role);
    for (const tab of ADMIN_ONLY_TAB_KEYS) {
      assert.equal(visibleTabs.has(tab), false, `${role} should not see ${tab}`);
    }
  }
});

test('dashboard nav exposes admin report tabs through tab visibility once', () => {
  const navItems = buildDashboardNavItems([...TAB_KEYS], { isHRAdmin: true });
  const activtrakItems = navItems.filter((item) => item.key === 'activtrak-identities');
  const duoItems = navItems.filter((item) => item.key === 'duo-activtrak-reconciliation');
  const rawDataItems = navItems.filter((item) => item.key === 'raw-data');

  assert.equal(activtrakItems.length, 1);
  assert.equal(activtrakItems[0]?.label, 'ActivTrak Identities');
  assert.equal(activtrakItems[0]?.path, '/dashboard/activtrak-identities');
  assert.equal(activtrakItems[0]?.section, 'admin');
  assert.equal(duoItems.length, 1);
  assert.equal(duoItems[0]?.label, 'Duo Reconciliation');
  assert.equal(duoItems[0]?.path, '/dashboard/duo-activtrak-reconciliation');
  assert.equal(duoItems[0]?.section, 'admin');
  assert.equal(rawDataItems.length, 1);
  assert.equal(rawDataItems[0]?.label, 'Raw Data');
  assert.equal(rawDataItems[0]?.path, '/dashboard/raw-data');
  assert.equal(rawDataItems[0]?.section, 'admin');
});
