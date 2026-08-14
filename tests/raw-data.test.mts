import assert from 'node:assert/strict';
import test from 'node:test';
import * as rawData from '../lib/raw-data.ts';
import * as rawDataCsv from '../lib/raw-data-csv.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T; 'module.exports'?: T }).default
    ?? (mod as T & { default?: T; 'module.exports'?: T })['module.exports']
    ?? mod);
}

const {
  DEFAULT_RAW_DATA_DATASET_KEY,
  RAW_DATA_DATASETS,
  getEmptyRawDataResult,
  getRawDataCatalog,
  normalizeRawDataDatasetKey,
} = getModuleExports(rawData);
const { buildRawDataCsvContent } = getModuleExports(rawDataCsv);

test('raw data catalog exposes approved datasets with stable metadata', () => {
  const catalog = getRawDataCatalog();
  const keys = catalog.map((dataset) => dataset.key);

  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('attendance-daily'));
  assert.ok(keys.includes('tbs-time-entries'));
  assert.ok(keys.includes('remote-work-requests'));
  assert.ok(keys.includes('duo-auth-logs'));
  assert.ok(keys.includes('sync-log'));

  for (const dataset of catalog) {
    assert.ok(dataset.label);
    assert.ok(dataset.description);
    assert.ok(dataset.sourceLabel);
    assert.ok(dataset.audience);
    assert.ok(dataset.columns.length > 0, `${dataset.key} should expose columns`);
    assert.equal(new Set(dataset.columns.map((column) => column.key)).size, dataset.columns.length);
  }
});

test('raw data registry does not expose arbitrary dataset keys', () => {
  assert.equal(normalizeRawDataDatasetKey('tbs-time-entries'), 'tbs-time-entries');
  assert.equal(normalizeRawDataDatasetKey('TL_EMPLOYEES'), DEFAULT_RAW_DATA_DATASET_KEY);
  assert.equal(normalizeRawDataDatasetKey('duo-auth-logs;DROP TABLE TL_EMPLOYEES'), DEFAULT_RAW_DATA_DATASET_KEY);
  assert.ok(RAW_DATA_DATASETS.every((dataset) => dataset.fromSql && dataset.defaultOrderSql));
});

test('empty raw data result preserves selected dataset and date labels', () => {
  const result = getEmptyRawDataResult({
    datasetKey: 'remote-work-requests',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    search: '  House ',
    page: 2,
    pageSize: 50,
  });

  assert.equal(result.dataset.key, 'remote-work-requests');
  assert.equal(result.startDate, '2026-06-01');
  assert.equal(result.endDate, '2026-06-30');
  assert.equal(result.search, 'house');
  assert.equal(result.page, 2);
  assert.equal(result.columns.length, result.dataset.columns.length);
});

test('raw data CSV export escapes spreadsheet-sensitive text', () => {
  const csv = buildRawDataCsvContent(
    [
      { key: 'employee', label: 'Employee' },
      { key: 'remark', label: 'Remark' },
      { key: 'hours', label: 'Hours' },
    ],
    [
      { employee: 'Tav Tej', remark: 'Needs "review", please', hours: 7.5 },
      { employee: 'Line Break', remark: 'first\nsecond', hours: null },
    ],
  );

  assert.equal(
    csv,
    'Employee,Remark,Hours\nTav Tej,"Needs ""review"", please",7.5\nLine Break,"first\nsecond",',
  );
});
