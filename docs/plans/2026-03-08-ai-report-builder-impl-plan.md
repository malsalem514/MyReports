# AI Report Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a governed AI-powered report builder to MyReports that lets HR admins chat with existing data, generate visualizations, and save reusable reports.

**Architecture:** Thin AI Layer — LLM translates natural language to a ReportSpec JSON via Vercel AI SDK tool calling. Deterministic dataset runners build parameterized Oracle queries. No AI-generated SQL.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Vercel AI SDK v6, GPT-4.1-mini, Recharts, shadcn/ui, Oracle 23ai Free (oracledb thin mode), Zod, ExcelJS, Playwright.

**Design Doc:** `docs/plans/2026-03-08-ai-report-builder-design.md`

**Key References:**
- Oracle helpers: `lib/oracle.ts` — `query<T>()`, `execute()`, `getConnection()`, `safeExecuteDDL()`, `initializeSchema()`
- Auth: `lib/access.ts` — `AccessContext`, `isHRAdminEmail()`, `getAccessContext()`
- Existing API pattern: `app/api/admin/tabs/route.ts` — auth guard, dev bypass, `NextResponse.json()`
- Existing report data: `lib/dashboard-data.ts` — Oracle SQL patterns, view usage
- Tab config: `lib/tab-config.ts` — role-based visibility model

---

## Phase 0 — Local Environment Setup

### Task 0: Oracle 23ai Free Docker + Playwright

**Files:**
- Create: `docker-compose.yml`
- Create: `scripts/wait-for-oracle.sh`
- Create: `playwright.config.ts`
- Create: `e2e/fixtures.ts`
- Modify: `package.json`
- Modify: `.env.example`

**Step 1: Create docker-compose.yml for Oracle 23ai Free**

Create `docker-compose.yml` in project root:

```yaml
version: "3.8"
services:
  oracle:
    image: gvenzl/oracle-free:23-slim
    container_name: myreports-oracle
    ports:
      - "1521:1521"
    environment:
      ORACLE_PASSWORD: dev_password
      APP_USER: timelogs
      APP_USER_PASSWORD: timelogs
    volumes:
      - oracle-data:/opt/oracle/oradata
    healthcheck:
      test: ["CMD", "healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 30

volumes:
  oracle-data:
```

> **Why 23ai Free over 21c XE**: Native `JSON` column type (no CLOB workaround), better performance, active LTS. The `gvenzl/oracle-free:23-slim` image is ~1.5GB and community-maintained by Gerald Venzl (Oracle DevRel). Thin mode `oracledb` driver works out of the box — no Instant Client needed.

**Step 2: Create Oracle wait script**

Create `scripts/wait-for-oracle.sh`:

```bash
#!/bin/bash
echo "Waiting for Oracle to be ready..."
for i in $(seq 1 60); do
  if docker exec myreports-oracle healthcheck.sh &>/dev/null; then
    echo "Oracle is ready!"
    exit 0
  fi
  echo "Attempt $i/60 — waiting..."
  sleep 5
done
echo "Oracle failed to start within 5 minutes"
exit 1
```

```bash
chmod +x scripts/wait-for-oracle.sh
```

**Step 3: Update .env.example with local Oracle settings**

Add to `.env.example`:

```
# Local Oracle 23ai Free (docker-compose)
ORACLE_USER=timelogs
ORACLE_PASSWORD=timelogs
ORACLE_CONNECT_STRING=localhost:1521/FREEPDB1
```

Copy the same values to your `.env` file.

> **Key difference**: Local Oracle uses `FREEPDB1` as the pluggable DB name, not `suppops`. The `oracledb` thin mode driver connects directly — no `initOracleClient()` needed.

**Step 4: Start Oracle and verify connection**

```bash
docker compose up -d oracle
./scripts/wait-for-oracle.sh
```

Verify connection works:

```bash
npx tsx -e "
import oracledb from 'oracledb';
const conn = await oracledb.getConnection({
  user: 'timelogs', password: 'timelogs',
  connectString: 'localhost:1521/FREEPDB1'
});
const r = await conn.execute('SELECT 1 AS OK FROM DUAL');
console.log('Connected:', r.rows);
await conn.close();
"
```

Expected: `Connected: [ [ 1 ] ]`

**Step 5: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

> **Why Chromium only**: V1 doesn't need cross-browser testing. Chromium covers the target audience (internal HR admins on Chrome). Add `firefox` and `webkit` later if needed.

**Step 6: Create Playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

**Step 7: Create shared test fixtures**

Create `e2e/fixtures.ts`:

```typescript
import { test as base, expect } from '@playwright/test';

// Per-request auth bypass via header — allows admin/non-admin tests in same suite.
// The dev-bypass middleware reads X-Test-Bypass-Email when NODE_ENV=test.
export const test = base.extend<{ asAdmin: void; asEmployee: void }>({
  asAdmin: [async ({ page }, use) => {
    // Set admin email on all requests from this page
    await page.route('**/*', (route) => {
      route.continue({
        headers: {
          ...route.request().headers(),
          'x-test-bypass-email': 'malsalem@jestais.com',
        },
      });
    });
    await use();
  }, { auto: false }],

  asEmployee: [async ({ page }, use) => {
    await page.route('**/*', (route) => {
      route.continue({
        headers: {
          ...route.request().headers(),
          'x-test-bypass-email': 'employee@jestais.com',
        },
      });
    });
    await use();
  }, { auto: false }],
});

export { expect };
```

**Step 8: Add npm scripts**

Add to `package.json` scripts:

```json
{
  "db:up": "docker compose up -d oracle && ./scripts/wait-for-oracle.sh",
  "db:down": "docker compose down",
  "db:reset": "docker compose down -v && docker compose up -d oracle && ./scripts/wait-for-oracle.sh",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

**Step 9: Commit**

```bash
git add docker-compose.yml scripts/wait-for-oracle.sh playwright.config.ts e2e/fixtures.ts package.json package-lock.json .env.example
git commit -m "chore: add Oracle 23ai Free Docker + Playwright E2E infrastructure"
```

---

## Phase 1 — Foundations (Semantic Layer + Schema + Spec)

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install AI SDK and Recharts packages**

```bash
cd /Users/musaalsalem/Projects/MyReports
npm install ai @ai-sdk/openai @ai-sdk/react recharts
```

**Step 2: Add OpenAI API key to env**

Add to `.env`:
```
OPENAI_API_KEY=sk-...
```

Add to `.env.example`:
```
OPENAI_API_KEY=              # OpenAI API key for report builder AI
```

**Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: PASS (no new errors from installed packages).

**Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add AI SDK and Recharts dependencies"
```

---

### Task 2: Report spec schema and types

**Files:**
- Create: `lib/report-builder/report-spec.ts`
- Create: `types/report-builder.ts`

**Step 1: Create shared types**

Create `types/report-builder.ts`:

```typescript
export type ChartType = 'table' | 'bar' | 'stacked_bar' | 'line' | 'kpi';
export type Grain = 'week' | 'day';
export type FieldSensitivity = 'public' | 'hr_only';
export type FieldType = 'string' | 'date' | 'boolean' | 'number';
export type MeasureType = 'integer' | 'decimal' | 'percentage';
export type Aggregation = 'sum' | 'avg' | 'count' | 'min' | 'max';
export type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in' | 'between' | 'is_null' | 'is_not_null';
export type SortDirection = 'asc' | 'desc';
export type VisibilityScope = 'owner' | 'hr_admin' | 'directors_hr' | 'managers_hr' | 'all';
export type AccessLevel = 'self' | 'team' | 'all';

export interface DimensionDef {
  key: string;
  label: string;
  type: FieldType;
  oracleExpr: string;          // actual Oracle column/expression
  filterable: boolean;
  groupable: boolean;
  sensitivity: FieldSensitivity;
}

export interface MeasureDef {
  key: string;
  label: string;
  type: MeasureType;
  oracleExpr: string;          // actual Oracle column/expression
  aggregation: Aggregation;
  sensitivity: FieldSensitivity;
}

export interface DerivedFlagDef {
  key: string;
  label: string;
  description: string;
  oracleExpr: string;
  sensitivity: FieldSensitivity;
}

export interface ScopeKeyDef {
  field: string;
  accessLevel: AccessLevel;
  injection: 'innermost';
}

export interface DatasetContract {
  key: string;
  label: string;
  description: string;
  grains: Grain[];
  dimensions: DimensionDef[];
  measures: MeasureDef[];
  derivedFlags: DerivedFlagDef[];
  defaultGrain: Grain;
  defaultDimensions: string[];
  defaultMeasures: string[];
  supportedChartTypes: ChartType[];
  scopeKeys: ScopeKeyDef[];
  baseSql: string;             // innermost CTE SQL template
}

export interface DatasetResult {
  columns: Array<{ key: string; label: string; type: string }>;
  rows: Record<string, unknown>[];
  meta: {
    rowCount: number;
    executionMs: number;
    freshness: string | null;  // last sync timestamp
  };
}

export interface ReportDefinition {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  datasetKey: string;
  reportSpec: ReportSpec;
  visibilityScope: VisibilityScope;
  ownerEmail: string;
  isPublished: boolean;
  isOfficial: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ReportVersion {
  id: number;
  reportId: number;
  versionNo: number;
  reportSpec: ReportSpec;
  promptText: string | null;
  changeSummary: string | null;
  createdBy: string;
  createdAt: string;
}

// ReportSpec is defined by Zod schema in report-spec.ts
export type { ReportSpec } from '@/lib/report-builder/report-spec';
```

**Step 2: Create Zod schema**

Create `lib/report-builder/report-spec.ts`:

```typescript
import { z } from 'zod';

export const filterSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'not_in', 'between', 'is_null', 'is_not_null']),
  value: z.unknown(),
});

export const sortSchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']),
});

export const visualSchema = z.object({
  id: z.string(),
  type: z.enum(['table', 'bar', 'stacked_bar', 'line', 'kpi']),
  x: z.string().optional(),
  y: z.array(z.string()),
  series: z.string().nullable().optional(),
  stack: z.boolean().optional(),
  showLegend: z.boolean().optional(),
});

export const timeRangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lookback_weeks'), weeks: z.number().int().min(1).max(52) }),
  z.object({ type: z.literal('custom'), start: z.string().date(), end: z.string().date() }),
]);

export const reportSpecSchema = z.object({
  version: z.literal(1),
  dataset: z.enum(['office_attendance', 'working_hours', 'timesheet_compare', 'employee_directory']),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  timeRange: timeRangeSchema.optional(), // optional for non-temporal datasets (employee_directory)
  grain: z.enum(['week', 'day']).optional(), // optional for non-temporal datasets
  dimensions: z.array(z.string()), // min(0) — KPI visuals may have no dimensions
  measures: z.array(z.string()).min(1),
  filters: z.array(filterSchema),
  sort: z.array(sortSchema),
  visuals: z.array(visualSchema),
});

// NOTE: compileSpec() enforces conditional requirements:
// - temporal datasets (office_attendance, working_hours, timesheet_compare) REQUIRE timeRange + grain
// - employee_directory does NOT require timeRange or grain
// - KPI visuals allow 0 dimensions; other chart types require >= 1 dimension

export type ReportSpec = z.infer<typeof reportSpecSchema>;
export type Filter = z.infer<typeof filterSchema>;
export type Visual = z.infer<typeof visualSchema>;
export type TimeRange = z.infer<typeof timeRangeSchema>;
```

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add types/report-builder.ts lib/report-builder/report-spec.ts
git commit -m "feat: add ReportSpec Zod schema and report builder types"
```

---

### Task 3: Dataset registry and contracts

**Files:**
- Create: `lib/report-datasets/registry.ts`
- Create: `lib/report-datasets/office-attendance.ts`
- Create: `lib/report-datasets/working-hours.ts`
- Create: `lib/report-datasets/timesheet-compare.ts`
- Create: `lib/report-datasets/employee-directory.ts`

**Step 1: Create the registry**

Create `lib/report-datasets/registry.ts`:

```typescript
import type { DatasetContract } from '@/types/report-builder';
import { officeAttendanceContract } from './office-attendance';
import { workingHoursContract } from './working-hours';
import { timesheetCompareContract } from './timesheet-compare';
import { employeeDirectoryContract } from './employee-directory';

const DATASETS: DatasetContract[] = [
  officeAttendanceContract,
  workingHoursContract,
  timesheetCompareContract,
  employeeDirectoryContract,
];

const datasetMap = new Map(DATASETS.map((d) => [d.key, d]));

export function getDatasetKeys(): [string, ...string[]] {
  const keys = DATASETS.map((d) => d.key);
  return keys as [string, ...string[]];
}

export function listDatasets(): Array<{ key: string; label: string; description: string }> {
  return DATASETS.map((d) => ({ key: d.key, label: d.label, description: d.description }));
}

export function getDataset(key: string): DatasetContract | undefined {
  return datasetMap.get(key);
}

export function describeDataset(key: string) {
  const ds = datasetMap.get(key);
  if (!ds) return null;
  return {
    key: ds.key,
    label: ds.label,
    description: ds.description,
    grains: ds.grains,
    dimensions: ds.dimensions.map((d) => ({
      key: d.key, label: d.label, type: d.type, filterable: d.filterable, groupable: d.groupable,
    })),
    measures: ds.measures.map((m) => ({
      key: m.key, label: m.label, type: m.type, aggregation: m.aggregation,
    })),
    derivedFlags: ds.derivedFlags.map((f) => ({
      key: f.key, label: f.label, description: f.description,
    })),
    defaultGrain: ds.defaultGrain,
    defaultDimensions: ds.defaultDimensions,
    defaultMeasures: ds.defaultMeasures,
    supportedChartTypes: ds.supportedChartTypes,
  };
}
```

**Step 2: Create the 4 dataset contracts**

Each file exports a `DatasetContract` with dimensions, measures, Oracle column mappings, and the base SQL template. Start with `office-attendance.ts` as the exemplar — the others follow the same pattern.

Create `lib/report-datasets/office-attendance.ts`:

```typescript
import type { DatasetContract, DatasetResult } from '@/types/report-builder';
import type { ReportSpec } from '@/lib/report-builder/report-spec';
import type { AccessContext } from '@/lib/access';

export const officeAttendanceContract: DatasetContract = {
  key: 'office_attendance',
  label: 'Office Attendance',
  description: 'Office vs remote attendance by employee, department, and week. Includes PTO tracking and compliance scoring.',
  grains: ['week', 'day'],
  dimensions: [
    { key: 'week', label: 'Week', type: 'date', oracleExpr: 'WEEK_START', filterable: true, groupable: true, sensitivity: 'public' },
    { key: 'employee', label: 'Employee', type: 'string', oracleExpr: 'DISPLAY_NAME', filterable: true, groupable: true, sensitivity: 'public' },
    { key: 'employee_email', label: 'Employee Email', type: 'string', oracleExpr: 'EMAIL', filterable: true, groupable: true, sensitivity: 'hr_only' },
    { key: 'department', label: 'Department', type: 'string', oracleExpr: 'DEPARTMENT', filterable: true, groupable: true, sensitivity: 'public' },
    { key: 'location', label: 'Office Location', type: 'string', oracleExpr: 'OFFICE_LOCATION', filterable: true, groupable: true, sensitivity: 'public' },
    { key: 'remote_approved', label: 'Remote Work Approved', type: 'boolean', oracleExpr: 'REMOTE_WORKDAY_POLICY_ASSIGNED', filterable: true, groupable: true, sensitivity: 'public' },
  ],
  measures: [
    { key: 'office_days', label: 'Office Days', type: 'integer', oracleExpr: 'OFFICE_DAYS', aggregation: 'sum', sensitivity: 'public' },
    { key: 'remote_days', label: 'Remote Days', type: 'integer', oracleExpr: 'REMOTE_DAYS', aggregation: 'sum', sensitivity: 'public' },
    { key: 'pto_days', label: 'PTO Days', type: 'integer', oracleExpr: 'PTO_DAYS', aggregation: 'sum', sensitivity: 'public' },
    { key: 'employee_count', label: 'Employee Count', type: 'integer', oracleExpr: 'EMAIL', aggregation: 'count', sensitivity: 'public' },
    { key: 'compliance_pct', label: 'Compliance %', type: 'percentage', oracleExpr: 'COMPLIANCE_PCT', aggregation: 'avg', sensitivity: 'public' },
  ],
  derivedFlags: [
    { key: 'below_policy', label: 'Below Policy', description: 'Employee had fewer than 2 office days in a week', oracleExpr: 'CASE WHEN OFFICE_DAYS < 2 THEN 1 ELSE 0 END', sensitivity: 'public' },
  ],
  defaultGrain: 'week',
  defaultDimensions: ['department', 'week'],
  defaultMeasures: ['office_days', 'employee_count'],
  supportedChartTypes: ['table', 'bar', 'stacked_bar', 'line', 'kpi'],
  scopeKeys: [{ field: 'EMAIL', accessLevel: 'self', injection: 'innermost' }],
  baseSql: `
    SELECT
      w.EMAIL, w.DISPLAY_NAME, w.DEPARTMENT, w.OFFICE_LOCATION, w.WEEK_START,
      w.OFFICE_DAYS, w.REMOTE_DAYS,
      NVL(p.PTO_DAYS, 0) AS PTO_DAYS,
      e.REMOTE_WORKDAY_POLICY_ASSIGNED,
      ROUND(CASE WHEN (w.OFFICE_DAYS + w.REMOTE_DAYS + NVL(p.PTO_DAYS, 0)) = 0 THEN 0
        ELSE (w.OFFICE_DAYS * 100.0) / (w.OFFICE_DAYS + w.REMOTE_DAYS + NVL(p.PTO_DAYS, 0)) END, 1) AS COMPLIANCE_PCT
    FROM V_ATTENDANCE_WEEKLY w
    LEFT JOIN V_PTO_WEEKLY p ON w.EMAIL = p.EMAIL AND w.WEEK_START = p.WEEK_START
    LEFT JOIN TL_EMPLOYEES e ON LOWER(e.EMAIL) = w.EMAIL
  `,
};
```

Create similar contracts for `working-hours.ts`, `timesheet-compare.ts`, and `employee-directory.ts` following the same structure but with their respective dimensions, measures, and base SQL. Reference `lib/dashboard-data.ts` for the exact Oracle columns and SQL patterns used by each existing report.

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

**Step 4: Commit**

```bash
git add lib/report-datasets/
git commit -m "feat: add dataset registry with 4 governed contracts"
```

---

### Task 4: Spec compiler

**Files:**
- Create: `lib/report-builder/compile-spec.ts`

**Step 1: Implement compileSpec()**

Create `lib/report-builder/compile-spec.ts`:

```typescript
import type { ReportSpec } from './report-spec';
import type { DatasetContract, VisibilityScope } from '@/types/report-builder';
import { getDataset } from '@/lib/report-datasets/registry';

interface CompileResult {
  ok: true;
  spec: ReportSpec;
} | {
  ok: false;
  errors: string[];
}

export function compileSpec(
  spec: ReportSpec,
  visibilityScope?: VisibilityScope,
): CompileResult {
  const errors: string[] = [];
  const dataset = getDataset(spec.dataset);

  if (!dataset) {
    return { ok: false, errors: [`Unknown dataset: ${spec.dataset}`] };
  }

  // 0. Conditional field requirements by dataset type
  const temporalDatasets = ['office_attendance', 'working_hours', 'timesheet_compare'];
  const isTemporal = temporalDatasets.includes(spec.dataset);

  if (isTemporal) {
    if (!spec.timeRange) errors.push(`Dataset "${spec.dataset}" requires a timeRange`);
    if (!spec.grain) errors.push(`Dataset "${spec.dataset}" requires a grain`);
  }

  // KPI visuals allow 0 dimensions; other chart types require >= 1
  const hasNonKpiVisual = spec.visuals.some((v) => v.type !== 'kpi');
  if (hasNonKpiVisual && spec.dimensions.length === 0) {
    errors.push('Non-KPI chart types require at least 1 dimension');
  }

  // 1. Validate dimensions exist in contract
  const dimKeys = new Set(dataset.dimensions.map((d) => d.key));
  for (const dim of spec.dimensions) {
    if (!dimKeys.has(dim)) {
      errors.push(`Dimension "${dim}" not found in dataset "${spec.dataset}"`);
    }
  }

  // 2. Validate measures exist in contract
  const measureKeys = new Set(dataset.measures.map((m) => m.key));
  for (const measure of spec.measures) {
    if (!measureKeys.has(measure)) {
      errors.push(`Measure "${measure}" not found in dataset "${spec.dataset}"`);
    }
  }

  // 3. Validate filter fields exist (dimension or measure)
  const allFields = new Set([...dimKeys, ...measureKeys]);
  for (const filter of spec.filters) {
    if (!allFields.has(filter.field)) {
      errors.push(`Filter field "${filter.field}" not found in dataset "${spec.dataset}"`);
    }
  }

  // 4. Validate grain is supported
  if (!dataset.grains.includes(spec.grain)) {
    errors.push(`Grain "${spec.grain}" not supported by dataset "${spec.dataset}"`);
  }

  // 5. Validate chart type is supported
  for (const visual of spec.visuals) {
    if (!dataset.supportedChartTypes.includes(visual.type)) {
      errors.push(`Chart type "${visual.type}" not supported by dataset "${spec.dataset}"`);
    }
    // KPI: requires 1-4 measures, no x axis
    if (visual.type === 'kpi') {
      if (visual.y.length < 1 || visual.y.length > 4) {
        errors.push('KPI visual requires 1-4 measures');
      }
    }
    // Line: requires a date dimension on x
    if (visual.type === 'line' && visual.x) {
      const xDim = dataset.dimensions.find((d) => d.key === visual.x);
      if (xDim && xDim.type !== 'date') {
        errors.push('Line chart requires a date dimension on the X axis');
      }
    }
  }

  // 6. Validate filter operators per field type
  for (const filter of spec.filters) {
    const dim = dataset.dimensions.find((d) => d.key === filter.field);
    if (dim) {
      const stringOps = ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'];
      const numberOps = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'is_null', 'is_not_null'];
      const dateOps = ['eq', 'gt', 'lt', 'gte', 'lte', 'between', 'is_null', 'is_not_null'];
      const boolOps = ['eq', 'neq', 'is_null', 'is_not_null'];

      const allowedOps = dim.type === 'string' ? stringOps
        : dim.type === 'number' ? numberOps
        : dim.type === 'date' ? dateOps
        : boolOps;

      if (!allowedOps.includes(filter.op)) {
        errors.push(`Filter op "${filter.op}" not valid for ${dim.type} field "${filter.field}"`);
      }
    }
  }

  // 7. Max date window: 1 year
  if (spec.timeRange.type === 'lookback_weeks' && spec.timeRange.weeks > 52) {
    errors.push('Time range cannot exceed 52 weeks (1 year)');
  }
  if (spec.timeRange.type === 'custom') {
    const start = new Date(spec.timeRange.start);
    const end = new Date(spec.timeRange.end);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 366) {
      errors.push('Custom date range cannot exceed 1 year');
    }
    if (end < start) {
      errors.push('End date must be after start date');
    }
  }

  // 8. Field sensitivity vs visibility scope
  if (visibilityScope && visibilityScope !== 'owner' && visibilityScope !== 'hr_admin') {
    const hrOnlyDims = dataset.dimensions
      .filter((d) => d.sensitivity === 'hr_only')
      .map((d) => d.key);
    const hrOnlyMeasures = dataset.measures
      .filter((m) => m.sensitivity === 'hr_only')
      .map((m) => m.key);

    const usedHrDims = spec.dimensions.filter((d) => hrOnlyDims.includes(d));
    const usedHrMeasures = spec.measures.filter((m) => hrOnlyMeasures.includes(m));
    const usedHrFilters = spec.filters
      .filter((f) => hrOnlyDims.includes(f.field) || hrOnlyMeasures.includes(f.field));

    const allHrFields = [...usedHrDims, ...usedHrMeasures, ...usedHrFilters.map((f) => f.field)];
    if (allHrFields.length > 0) {
      errors.push(
        `Fields [${allHrFields.join(', ')}] are HR-only and cannot be used in reports with visibility "${visibilityScope}"`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, spec };
}
```

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add lib/report-builder/compile-spec.ts
git commit -m "feat: add spec compiler with semantic validation"
```

---

### Task 5: Oracle schema for report tables

**Files:**
- Modify: `lib/oracle.ts` — add report tables to `initializeSchema()`

**Step 1: Add report tables DDL**

Add to `initializeSchema()` in `lib/oracle.ts`, after the existing tab tables section (before `console.log('Oracle schema initialized successfully')`):

```typescript
    // ── Report Builder tables ──────────────────────────────────
    await safeExecuteDDL(conn, `
      CREATE TABLE TL_REPORT_DEFINITIONS (
        ID               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        SLUG             VARCHAR2(100)  NOT NULL,
        TITLE            VARCHAR2(500)  NOT NULL,
        DESCRIPTION      VARCHAR2(2000),
        DATASET_KEY      VARCHAR2(50)   NOT NULL,
        REPORT_SPEC      JSON           NOT NULL,
        VISIBILITY_SCOPE VARCHAR2(30)   DEFAULT 'owner' NOT NULL,
        OWNER_EMAIL      VARCHAR2(255)  NOT NULL,
        IS_PUBLISHED     NUMBER(1)      DEFAULT 0 NOT NULL,
        IS_OFFICIAL      NUMBER(1)      DEFAULT 0 NOT NULL,
        CREATED_AT       TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        UPDATED_AT       TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        ARCHIVED_AT      TIMESTAMP WITH LOCAL TIME ZONE,
        CONSTRAINT UQ_REPORT_SLUG UNIQUE (SLUG),
        CONSTRAINT CHK_VISIBILITY CHECK (VISIBILITY_SCOPE IN ('owner','hr_admin','directors_hr','managers_hr','all')),
        CONSTRAINT CHK_DATASET CHECK (DATASET_KEY IN ('office_attendance','working_hours','timesheet_compare','employee_directory'))
      )
    `);
    await safeExecuteDDL(conn, `CREATE INDEX IDX_REPORT_DEF_OWNER ON TL_REPORT_DEFINITIONS(OWNER_EMAIL, ARCHIVED_AT)`);
    await safeExecuteDDL(conn, `CREATE INDEX IDX_REPORT_DEF_PUBLISHED ON TL_REPORT_DEFINITIONS(IS_PUBLISHED, ARCHIVED_AT)`);
    await safeExecuteDDL(conn, `CREATE INDEX IDX_REPORT_DEF_DATASET ON TL_REPORT_DEFINITIONS(DATASET_KEY, ARCHIVED_AT)`);

    await safeExecuteDDL(conn, `
      CREATE TABLE TL_REPORT_VERSIONS (
        ID              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        REPORT_ID       NUMBER         NOT NULL,
        VERSION_NO      NUMBER         NOT NULL,
        REPORT_SPEC     JSON           NOT NULL,
        PROMPT_TEXT     CLOB,
        CHANGE_SUMMARY  VARCHAR2(1000),
        CREATED_BY      VARCHAR2(255)  NOT NULL,
        CREATED_AT      TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT FK_REPORT_VER_DEF FOREIGN KEY (REPORT_ID) REFERENCES TL_REPORT_DEFINITIONS(ID),
        CONSTRAINT UQ_REPORT_VERSION UNIQUE (REPORT_ID, VERSION_NO)
      )
    `);
    await safeExecuteDDL(conn, `CREATE INDEX IDX_REPORT_VER_REPORT ON TL_REPORT_VERSIONS(REPORT_ID, VERSION_NO DESC)`);

    await safeExecuteDDL(conn, `
      CREATE TABLE TL_REPORT_FAVORITES (
        REPORT_ID       NUMBER         NOT NULL,
        EMAIL           VARCHAR2(255)  NOT NULL,
        CREATED_AT      TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT PK_REPORT_FAV PRIMARY KEY (REPORT_ID, EMAIL),
        CONSTRAINT FK_REPORT_FAV_DEF FOREIGN KEY (REPORT_ID) REFERENCES TL_REPORT_DEFINITIONS(ID)
      )
    `);
```

**Step 2: Verify typecheck + test schema creation**

```bash
npm run typecheck
```

To test: start dev server (`npm run dev`), hit `/api/health?deep=1` — schema init runs on first Oracle connection.

**Step 3: Commit**

```bash
git add lib/oracle.ts
git commit -m "feat: add report builder Oracle tables to schema init"
```

---

### Task 6: Report CRUD operations

**Files:**
- Create: `lib/report-builder/report-crud.ts`

**Step 1: Implement CRUD**

Create `lib/report-builder/report-crud.ts` with these functions:

- `generateSlug(title: string): string` — slugify title + 6-char random suffix
- `saveReport(spec, title, description, datasetKey, visibility, ownerEmail, promptText?): Promise<{ id, slug }>` — INSERT into definitions + versions (version 1)
- `updateReport(id, updates, editorEmail): Promise<void>` — `SELECT FOR UPDATE` → validate → increment version → transactional write
- `loadReport(id): Promise<ReportDefinition | null>` — SELECT with `ARCHIVED_AT IS NULL`
- `loadReportBySlug(slug): Promise<ReportDefinition | null>`
- `listReports(opts: { ownerEmail?, published?, dataset?, search?, page?, limit? }): Promise<{ reports, total }>`
- `listPublishedReports(viewerRole, viewerEmail): Promise<ReportDefinition[]>` — filter by visibility scope
- `deleteReport(id): Promise<void>` — soft delete (SET ARCHIVED_AT)
- `duplicateReport(id, newTitle, ownerEmail): Promise<{ id, slug }>`
- `listVersions(reportId): Promise<ReportVersion[]>`
- `toggleFavorite(reportId, email): Promise<boolean>` — MERGE or DELETE, returns new state
- `isFavorite(reportId, email): Promise<boolean>`

Use `getConnection()` for transactional operations (update), `query<T>()` for reads. Use `RETURNING ID INTO :id` for inserts.

> **Oracle 23ai native JSON binding**: With native `JSON` columns, `oracledb` returns JSON data as JavaScript objects automatically (no `JSON.parse()` needed on read). For writes, pass a JavaScript object and bind as `{ type: oracledb.DB_TYPE_JSON }`. Example:
> ```typescript
> // Write: bind JS object as JSON
> await conn.execute(
>   'INSERT INTO TL_REPORT_DEFINITIONS (..., REPORT_SPEC) VALUES (..., :spec)',
>   { spec: { type: oracledb.DB_TYPE_JSON, val: specObject } },
> );
> // Read: oracledb returns JSON columns as JS objects automatically
> const rows = await query<{ REPORT_SPEC: ReportSpec }>('SELECT REPORT_SPEC FROM ...');
> // rows[0].REPORT_SPEC is already a JS object, no JSON.parse() needed
> ```

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add lib/report-builder/report-crud.ts
git commit -m "feat: add report CRUD operations with transactional versioning"
```

---

### Task 7: Dataset runners and report runner

**Files:**
- Create: `lib/report-datasets/shared-sql.ts`
- Modify: `lib/report-datasets/office-attendance.ts` — add `runOfficeAttendance()`
- Modify: `lib/report-datasets/working-hours.ts` — add `runWorkingHours()`
- Modify: `lib/report-datasets/timesheet-compare.ts` — add `runTimesheetCompare()`
- Modify: `lib/report-datasets/employee-directory.ts` — add `runEmployeeDirectory()`
- Create: `lib/report-builder/report-runner.ts`

**Step 1: Create shared SQL helpers**

Create `lib/report-datasets/shared-sql.ts`:

```typescript
import type { AccessContext } from '@/lib/access';
import type { ReportSpec, Filter } from '@/lib/report-builder/report-spec';
import type { DatasetContract } from '@/types/report-builder';

/**
 * Build WHERE and HAVING clauses from spec filters.
 * Dimension filters → WHERE (before aggregation).
 * Measure filters → HAVING (after aggregation).
 */
export function buildFilterClauses(
  filters: Filter[],
  dataset: DatasetContract,
  paramPrefix: string = 'f',
): {
  whereClause: string; whereParams: Record<string, unknown>;
  havingClause: string; havingParams: Record<string, unknown>;
} {
  const whereConds: string[] = [];
  const havingConds: string[] = [];
  const whereParams: Record<string, unknown> = {};
  const havingParams: Record<string, unknown> = {};

  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]!;
    const dim = dataset.dimensions.find((d) => d.key === filter.field);
    const measure = dataset.measures.find((m) => m.key === filter.field);
    const expr = dim?.oracleExpr ?? measure?.oracleExpr;
    if (!expr) continue;

    // Measures are aggregated — their filters go into HAVING, not WHERE
    const isDimensionFilter = !!dim;
    const conditions = isDimensionFilter ? whereConds : havingConds;
    const params = isDimensionFilter ? whereParams : havingParams;
    const paramKey = `${paramPrefix}${i}`;

    switch (filter.op) {
      case 'eq':
        conditions.push(`${expr} = :${paramKey}`);
        params[paramKey] = filter.value;
        break;
      case 'neq':
        conditions.push(`${expr} != :${paramKey}`);
        params[paramKey] = filter.value;
        break;
      case 'gt': case 'gte': case 'lt': case 'lte': {
        const opMap = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;
        conditions.push(`${expr} ${opMap[filter.op]} :${paramKey}`);
        params[paramKey] = filter.value;
        break;
      }
      case 'in': {
        const vals = filter.value as unknown[];
        const placeholders = vals.map((_, j) => `:${paramKey}_${j}`);
        conditions.push(`${expr} IN (${placeholders.join(',')})`);
        vals.forEach((v, j) => { params[`${paramKey}_${j}`] = v; });
        break;
      }
      case 'not_in': {
        const vals = filter.value as unknown[];
        const placeholders = vals.map((_, j) => `:${paramKey}_${j}`);
        conditions.push(`${expr} NOT IN (${placeholders.join(',')})`);
        vals.forEach((v, j) => { params[`${paramKey}_${j}`] = v; });
        break;
      }
      case 'between': {
        const [lo, hi] = filter.value as [unknown, unknown];
        conditions.push(`${expr} BETWEEN :${paramKey}_lo AND :${paramKey}_hi`);
        params[`${paramKey}_lo`] = lo;
        params[`${paramKey}_hi`] = hi;
        break;
      }
      case 'is_null':
        conditions.push(`${expr} IS NULL`);
        break;
      case 'is_not_null':
        conditions.push(`${expr} IS NOT NULL`);
        break;
    }
  }

  return {
    whereClause: whereConds.length > 0 ? whereConds.join(' AND ') : '1=1',
    whereParams,
    havingClause: havingConds.length > 0 ? havingConds.join(' AND ') : '',
    havingParams,
  };
}

/** Build access scope WHERE clause. Injected into innermost CTE. */
export function buildScopeClause(
  access: AccessContext,
): { clause: string; params: Record<string, unknown> } {
  if (access.isHRAdmin) {
    return { clause: '1=1', params: {} };
  }
  if (access.isDirector || access.isManager) {
    // Team scope: allowed emails
    if (access.allowedEmails.length === 0) {
      return { clause: 'LOWER(EMAIL) = :scope_email', params: { scope_email: access.userEmail.toLowerCase() } };
    }
    const placeholders = access.allowedEmails.map((_, i) => `:scope_em${i}`);
    const params: Record<string, unknown> = {};
    access.allowedEmails.forEach((e, i) => { params[`scope_em${i}`] = e.toLowerCase(); });
    return { clause: `LOWER(EMAIL) IN (${placeholders.join(',')})`, params };
  }
  // Self scope
  return { clause: 'LOWER(EMAIL) = :scope_email', params: { scope_email: access.userEmail.toLowerCase() } };
}

/** Compute start/end dates from TimeRange. */
export function resolveTimeRange(
  timeRange: ReportSpec['timeRange'],
): { start: Date; end: Date } {
  if (timeRange.type === 'custom') {
    return { start: new Date(timeRange.start), end: new Date(timeRange.end) };
  }
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - timeRange.weeks * 7);
  return { start, end };
}
```

**Step 2: Add runner functions to each dataset contract file**

Each dataset file gets a `run<Dataset>(spec, access)` function that:
1. Calls `resolveTimeRange()` to get start/end dates
2. Calls `buildScopeClause()` to get access predicate
3. Calls `buildFilterClause()` for user filters
4. Builds the full SQL: `WITH base AS (baseSql + scope + time + filters) SELECT dims, agg(measures) FROM base GROUP BY dims ORDER BY sort`
5. Executes via `query<T>()` with 30s timeout
6. Returns `DatasetResult`

Reference `lib/dashboard-data.ts` for the exact Oracle SQL patterns each existing report uses (view names, column names, dedup logic).

**Step 3: Create the report runner dispatcher**

Create `lib/report-builder/report-runner.ts`:

```typescript
import type { ReportSpec } from './report-spec';
import type { AccessContext } from '@/lib/access';
import type { DatasetResult } from '@/types/report-builder';
import { runOfficeAttendance } from '@/lib/report-datasets/office-attendance';
import { runWorkingHours } from '@/lib/report-datasets/working-hours';
import { runTimesheetCompare } from '@/lib/report-datasets/timesheet-compare';
import { runEmployeeDirectory } from '@/lib/report-datasets/employee-directory';

const runners: Record<string, (spec: ReportSpec, access: AccessContext) => Promise<DatasetResult>> = {
  office_attendance: runOfficeAttendance,
  working_hours: runWorkingHours,
  timesheet_compare: runTimesheetCompare,
  employee_directory: runEmployeeDirectory,
};

export async function runReport(spec: ReportSpec, access: AccessContext): Promise<DatasetResult> {
  const runner = runners[spec.dataset];
  if (!runner) {
    throw new Error(`No runner for dataset: ${spec.dataset}`);
  }
  return runner(spec, access);
}
```

**Step 4: Verify typecheck**

```bash
npm run typecheck
```

**Step 5: Commit**

```bash
git add lib/report-datasets/ lib/report-builder/report-runner.ts
git commit -m "feat: add dataset runners with access scope injection and report dispatcher"
```

---

## Phase 2 — AI Layer

### Task 8: System prompt and AI tools

**Files:**
- Create: `lib/report-builder/system-prompt.ts`
- Create: `lib/report-builder/ai-tools.ts`

**Step 1: Create system prompt builder**

Create `lib/report-builder/system-prompt.ts` with:
- Role description
- Dataset summaries from registry
- 3-5 few-shot example specs (attendance by department, working hours KPI, timesheet discrepancies)
- Constraints section ("only use governed fields, never generate SQL")

**Step 2: Create AI tool definitions**

Create `lib/report-builder/ai-tools.ts`:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { getDatasetKeys, listDatasets, describeDataset } from '@/lib/report-datasets/registry';
import { reportSpecSchema } from './report-spec';
import { compileSpec } from './compile-spec';
import { runReport } from './report-runner';
import type { AccessContext } from '@/lib/access';

export function buildReportTools(access: AccessContext) {
  return {
    list_datasets: tool({
      description: 'List all available report datasets with descriptions',
      parameters: z.object({}),
      execute: async () => listDatasets(),
    }),
    describe_dataset: tool({
      description: 'Get dimensions, measures, filters, grains, and chart types for a specific dataset',
      parameters: z.object({
        dataset: z.enum(getDatasetKeys()),
      }),
      execute: async ({ dataset }) => {
        const result = describeDataset(dataset);
        if (!result) return { error: `Dataset "${dataset}" not found` };
        return result;
      },
    }),
    generate_report_spec: tool({
      description: 'Generate and validate a report specification. Returns preview metadata if valid.',
      parameters: reportSpecSchema,
      execute: async (spec) => {
        const compiled = compileSpec(spec);
        if (!compiled.ok) return { error: compiled.errors };
        try {
          const result = await runReport(compiled.spec, access);
          return { spec: compiled.spec, preview: result.meta };
        } catch (err) {
          return { error: `Query failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    }),
  };
}
```

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

**Step 4: Commit**

```bash
git add lib/report-builder/system-prompt.ts lib/report-builder/ai-tools.ts
git commit -m "feat: add AI tools and system prompt for report builder"
```

---

### Task 9: Chat API route

**Files:**
- Create: `app/api/admin/report-builder/chat/route.ts`

**Step 1: Implement streaming chat endpoint**

Create `app/api/admin/report-builder/chat/route.ts`:

```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isHRAdminEmail, getAccessContext } from '@/lib/access';
import { getDevBypassEmail } from '@/lib/dev-bypass';
import { buildReportTools } from '@/lib/report-builder/ai-tools';
import { buildSystemPrompt } from '@/lib/report-builder/system-prompt';
import { initializeSchema } from '@/lib/oracle';

export async function POST(req: Request) {
  // Auth guard (same pattern as app/api/admin/tabs/route.ts)
  const bypassEmail = getDevBypassEmail('api-report-builder-chat');
  const session = bypassEmail ? null : await auth();
  const adminEmail = (bypassEmail ?? session?.user?.email ?? '').toLowerCase();
  if (!adminEmail || !isHRAdminEmail(adminEmail)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'HR admin access required' } },
      { status: 403 },
    );
  }

  await initializeSchema();

  const { messages } = await req.json();

  // Validate message length
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.content && typeof lastMessage.content === 'string' && lastMessage.content.length > 2000) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Message too long (max 2000 characters)' } },
      { status: 422 },
    );
  }

  const access = await getAccessContext();
  const tools = buildReportTools(access);

  const result = streamText({
    model: openai('gpt-4.1-mini'),
    system: buildSystemPrompt(),
    messages,
    tools,
    maxSteps: 5,
  });

  return result.toDataStreamResponse();
}
```

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add app/api/admin/report-builder/chat/route.ts
git commit -m "feat: add chat streaming API route for report builder"
```

---

### Task 10: Preview and report admin API routes

**Files:**
- Create: `app/api/admin/report-builder/preview/route.ts`
- Create: `app/api/admin/report-builder/reports/route.ts`
- Create: `app/api/admin/report-builder/reports/[id]/route.ts`
- Create: `app/api/admin/report-builder/reports/[id]/versions/route.ts`
- Create: `app/api/admin/report-builder/reports/[id]/duplicate/route.ts`
- Create: `app/api/admin/report-builder/reports/[id]/publish/route.ts`

**Step 1: Implement each route**

Follow the auth guard pattern from Task 9. Each route:
1. Checks `isHRAdminEmail`
2. Calls `initializeSchema()`
3. Does its work (validate, query, CRUD)
4. Returns `NextResponse.json()` with standardized error shape

Key behaviors:
- `POST /preview`: parse body as `ReportSpec` with Zod → `compileSpec()` → `runReport()` → return `DatasetResult`
- `GET /reports`: call `listReports()` with query params (page, search, dataset)
- `POST /reports`: Zod parse → `compileSpec(spec, visibility)` → `saveReport()` → return `{ id, slug }`
- `GET /reports/[id]`: `loadReport(id)` → return full report with parsed spec
- `PUT /reports/[id]`: Zod parse → `compileSpec(spec, visibility)` → `updateReport()` → return `{ ok: true }`
- `DELETE /reports/[id]`: `deleteReport(id)` → return `{ ok: true }`
- `GET /reports/[id]/versions`: `listVersions(id)` → return versions array
- `POST /reports/[id]/duplicate`: `duplicateReport(id, title, email)` → return `{ id, slug }`
- `POST /reports/[id]/publish`: set `IS_PUBLISHED = 1`, validate visibility scope doesn't leak HR-only fields → return `{ ok: true }`
- `POST /reports/[id]/unpublish`: set `IS_PUBLISHED = 0` → return `{ ok: true }`. Only the report owner or any HR admin can publish/unpublish.

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add app/api/admin/report-builder/
git commit -m "feat: add preview, reports CRUD, versions, and duplicate API routes"
```

---

### Task 11: Consumption API routes

**Files:**
- Create: `app/api/reports/route.ts`
- Create: `app/api/reports/[id]/route.ts`
- Create: `app/api/reports/[id]/run/route.ts`
- Create: `app/api/reports/[id]/favorite/route.ts`

**Step 1: Implement consumption routes**

These routes are NOT admin-only — they check visibility scope against the viewer's role:
- `GET /api/reports`: list published reports filtered by viewer's access level using `listPublishedReports()`
- `GET /api/reports/[id]`: load published report, check visibility, return 404 (not 403) for inaccessible
- `POST /api/reports/[id]/run`: load spec → `compileSpec()` → `runReport(spec, viewerAccess)` → return `DatasetResult`
- `POST/DELETE /api/reports/[id]/favorite`: `toggleFavorite()` / check `isFavorite()`

**Step 2: Verify typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add app/api/reports/
git commit -m "feat: add published reports consumption API routes with role-based access"
```

---

## Phase 3 — UI

### Task 12: DynamicChart and KPICards components

> **Playwright-friendly UI rule (applies to ALL Tasks 12-16):**
> - Use accessible HTML: `role`, `aria-label`, semantic elements (`<table>`, `<button>`, `<nav>`)
> - Prefer `getByRole()` / `getByLabel()` selectors in tests
> - Add `data-testid` on key interactive/container elements as fallback selectors
> - Every component that renders data must have a stable `data-testid` root

**Files:**
- Create: `app/dashboard/admin/report-builder/components/dynamic-chart.tsx`
- Create: `app/dashboard/admin/report-builder/components/kpi-cards.tsx`
- Create: `app/dashboard/admin/report-builder/components/data-table.tsx`

**Step 1: Build DynamicChart**

Implement the config-driven Recharts renderer from the design doc. Use `ResponsiveContainer`, `BarChart`/`LineChart`, `XAxis`, `YAxis`, `Tooltip`, `Legend`, `CartesianGrid`. Handle `bar`, `stacked_bar`, `line`, and `table` visual types.

Add `data-testid="dynamic-chart"` on the root container and `data-testid="chart-{type}"` on the active chart element.

**Step 2: Build KPICards**

Simple component: receives 1-4 measures with values, renders as large-number cards with labels. Use Tailwind for styling (match existing amber/green palette).

Add `data-testid="kpi-cards"` on root, `data-testid="kpi-card-{measure}"` on each card.

**Step 3: Build DataTable**

Sortable table component: receives `columns` and `rows` from `DatasetResult`. Click a row's dimension value → fires `onDrillThrough(field, value)` callback. Pagination (50 per page).

Use semantic `<table>` with `<thead>`/`<tbody>`, sortable `<th>` buttons. Add `data-testid="data-table"` on root, `data-testid="table-row-{index}"` on rows.

**Step 4: Verify typecheck**

```bash
npm run typecheck
```

**Step 5: Commit**

```bash
git add app/dashboard/admin/report-builder/components/
git commit -m "feat: add DynamicChart, KPICards, and DataTable components"
```

---

### Task 13: EditSidebar and FilterBuilder

**Files:**
- Create: `app/dashboard/admin/report-builder/components/edit-sidebar.tsx`
- Create: `app/dashboard/admin/report-builder/components/filter-builder.tsx`

**Step 1: Build FilterBuilder**

Component for adding/removing/editing filters. Each filter row: field selector (from dataset contract) → operator selector (filtered by field type) → value input. Use HTML `<select>` + `<input>` elements styled with Tailwind (match existing app patterns — no shadcn/ui installed in this project).

**Step 2: Build EditSidebar**

Collapsible sidebar with sections:
- Dataset selector (dropdown)
- Grain selector (week/day radio)
- Dimensions multi-select (checkboxes from contract)
- Measures multi-select (checkboxes from contract)
- Chart type selector (dropdown/radio)
- Filters (FilterBuilder component)
- Time range (lookback weeks dropdown + custom date inputs)

When any value changes → update spec state → auto-trigger preview if desired.

**Step 3: Verify typecheck**

```bash
npm run typecheck
```

**Step 4: Commit**

```bash
git add app/dashboard/admin/report-builder/components/edit-sidebar.tsx app/dashboard/admin/report-builder/components/filter-builder.tsx
git commit -m "feat: add EditSidebar and FilterBuilder components"
```

---

### Task 14: Report builder page (chat + preview)

**Files:**
- Create: `app/dashboard/admin/report-builder/page.tsx`
- Create: `app/dashboard/admin/report-builder/report-builder-client.tsx`

**Step 1: Create server page with auth gate**

Create `app/dashboard/admin/report-builder/page.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { getAccessContext } from '@/lib/access';
import ReportBuilderClient from './report-builder-client';

export default async function ReportBuilderPage() {
  const access = await getAccessContext();
  if (!access.isHRAdmin) {
    redirect('/dashboard');
  }
  return <ReportBuilderClient />;
}
```

**Step 2: Create client component**

Create `app/dashboard/admin/report-builder/report-builder-client.tsx`:

- Uses `useChat` from `@ai-sdk/react` pointing to `/api/admin/report-builder/chat`
- Split-pane layout: chat panel (35%) + preview panel (65%)
- State: `currentSpec: ReportSpec | null`, `previewData: DatasetResult | null`
- When AI streams a spec (via tool result), parse it and set `currentSpec` → trigger preview fetch
- Wire up `EditSidebar` to update `currentSpec` → re-fetch preview via `POST /api/admin/report-builder/preview`
- Action bar: Run (re-fetch preview), Save (POST to `/reports`), Save As, Publish, Duplicate
- Render `DynamicChart` or `DataTable` or `KPICards` based on `currentSpec.visuals[0].type`

**Step 3: Add to dashboard nav**

Modify `app/dashboard/dashboard-nav.tsx` to add a "Report Builder" link for HR admins under the admin section.

**Step 4: Verify typecheck + manual test**

```bash
npm run typecheck
npm run dev
```

Navigate to `/dashboard/admin/report-builder` as an HR admin. Verify the page loads with chat panel and empty preview panel.

**Step 5: Commit**

```bash
git add app/dashboard/admin/report-builder/ app/dashboard/dashboard-nav.tsx
git commit -m "feat: add report builder page with chat and preview panels"
```

---

### Task 15: Report library page

**Files:**
- Create: `app/dashboard/admin/reports/page.tsx`
- Create: `app/dashboard/admin/reports/report-library-client.tsx`

**Step 1: Build report library**

Server page with auth gate (HR admin only). Client component:
- Fetches `GET /api/admin/report-builder/reports` on mount
- Displays reports as cards or rows: title, dataset badge, owner, created date, visibility badge, published badge
- Search input, dataset filter dropdown
- Pagination
- Click a report → navigate to `/dashboard/reports/[slug]`
- Actions per report: Edit (→ builder with loaded spec), Duplicate, Delete, Publish/Unpublish

**Step 2: Add nav link**

Add "Reports" link to dashboard admin nav section.

**Step 3: Verify + commit**

```bash
npm run typecheck
git add app/dashboard/admin/reports/ app/dashboard/dashboard-nav.tsx
git commit -m "feat: add report library page for HR admins"
```

---

### Task 16: Report viewer page (published reports)

**Files:**
- Create: `app/dashboard/reports/[slug]/page.tsx`
- Create: `app/dashboard/reports/[slug]/report-viewer-client.tsx`

**Step 1: Build report viewer**

Server page: loads report by slug via `loadReportBySlug()`, checks visibility against viewer's access context. If unauthorized → `notFound()`.

Client component:
- Receives report spec + initial data
- Renders `DynamicChart` / `DataTable` / `KPICards`
- Header: title, description, dataset badge, owner, freshness label, version info
- Actions: Export to Excel (using ExcelJS — follow existing Excel export pattern from `lib/dashboard-data.ts`), Favorite toggle
- Drill-through: click dimension → re-run report with added filter via `POST /api/reports/[id]/run`

**Step 2: Verify + commit**

```bash
npm run typecheck
git add app/dashboard/reports/
git commit -m "feat: add report viewer page with role-based access"
```

---

## Phase 4 — Polish and Integration

### Task 17: Excel export for report viewer

**Files:**
- Create: `lib/report-builder/export-excel.ts`
- Modify: `app/dashboard/reports/[slug]/report-viewer-client.tsx` — wire up export button

**Step 1: Implement export function**

Create `lib/report-builder/export-excel.ts` — takes `DatasetResult` + report title, generates an Excel workbook using ExcelJS (follow the same pattern used in existing report pages). Trigger download via `Blob` + `URL.createObjectURL`.

**Step 2: Wire up export button in viewer**

**Step 3: Commit**

```bash
git add lib/report-builder/export-excel.ts app/dashboard/reports/
git commit -m "feat: add Excel export for report viewer"
```

---

### Task 18: Rate limiting middleware

**Files:**
- Create: `lib/report-builder/rate-limit.ts`
- Modify: `app/api/admin/report-builder/chat/route.ts` — add rate limit check
- Modify: `app/api/admin/report-builder/preview/route.ts` — add rate limit check

**Step 1: Implement in-memory rate limiter**

Create `lib/report-builder/rate-limit.ts`:

Simple in-memory Map-based rate limiter:
- `checkChatLimit(email)`: max 3 concurrent, sliding window
- `checkPreviewLimit(email)`: max 10/minute, sliding window
- Returns `{ allowed: boolean; retryAfter?: number }`

**Step 2: Wire into routes**

Add rate limit check at the top of chat and preview routes. Return `429` with `Retry-After` header if exceeded.

**Step 3: Commit**

```bash
git add lib/report-builder/rate-limit.ts app/api/admin/report-builder/chat/route.ts app/api/admin/report-builder/preview/route.ts
git commit -m "feat: add rate limiting for chat and preview endpoints"
```

---

### Task 19: Tab visibility integration for published reports

**Files:**
- Modify: `lib/tab-config.ts` — add `report-builder` and `reports` tab keys
- Modify: `lib/oracle.ts` — seed `report-builder` tab role defaults (hr-admin only)

**Step 1: Add new tab keys**

Add `'report-builder'` to the HR admin default tabs. Add `'reports'` to all roles (so published reports are accessible).

Seed via MERGE in `initializeSchema()`:

```typescript
// report-builder tab: HR admin only
await safeExecuteDDL(conn, `
  MERGE INTO TL_TAB_ROLES t
  USING (SELECT 'hr-admin' AS ROLE_NAME, 'report-builder' AS TAB_KEY FROM DUAL) s
  ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
  WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES ('hr-admin', 'report-builder', 1)
`);

// reports tab: all roles
for (const role of ['hr-admin', 'director', 'manager', 'employee']) {
  await safeExecuteDDL(conn, `
    MERGE INTO TL_TAB_ROLES t
    USING (SELECT '${role}' AS ROLE_NAME, 'reports' AS TAB_KEY FROM DUAL) s
    ON (t.ROLE_NAME = s.ROLE_NAME AND t.TAB_KEY = s.TAB_KEY)
    WHEN NOT MATCHED THEN INSERT (ROLE_NAME, TAB_KEY, VISIBLE) VALUES ('${role}', 'reports', 1)
  `);
}
```

**Step 2: Update dashboard nav to respect tab visibility**

Modify `app/dashboard/dashboard-nav.tsx` to check tab visibility for `'report-builder'` and `'reports'` before showing nav links.

**Step 3: Commit**

```bash
git add lib/tab-config.ts lib/oracle.ts app/dashboard/dashboard-nav.tsx
git commit -m "feat: integrate report builder tabs with existing visibility system"
```

---

### Task 20: Playwright E2E tests

**Files:**
- Create: `e2e/report-builder/page-objects/builder-page.ts`
- Create: `e2e/report-builder/page-objects/library-page.ts`
- Create: `e2e/report-builder/page-objects/viewer-page.ts`
- Create: `e2e/report-builder/builder-flow.spec.ts`
- Create: `e2e/report-builder/library.spec.ts`
- Create: `e2e/report-builder/access-control.spec.ts`

> **Prerequisites**: Oracle 23ai running (`npm run db:up`), schema initialized, dev server running.
>
> **Auth strategy**: Tests use a per-request `X-Test-Bypass-Email` header (or cookie) instead of the process-level `DEV_BYPASS_EMAIL` env var. This allows admin vs non-admin tests to run in the same dev server process. The test middleware reads this header when `NODE_ENV === 'test'` and overrides the auth context. Add a small middleware check in `lib/dev-bypass.ts` or the existing dev bypass mechanism.

**Step 1: Create Page Object Models**

Create `e2e/report-builder/page-objects/builder-page.ts`:

```typescript
import { type Page, type Locator, expect } from '@playwright/test';

export class BuilderPage {
  readonly page: Page;
  readonly chatInput: Locator;
  readonly sendButton: Locator;
  readonly previewPanel: Locator;
  readonly saveButton: Locator;
  readonly chart: Locator;
  readonly dataTable: Locator;
  readonly editSidebar: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chatInput = page.getByRole('textbox', { name: /message/i });
    this.sendButton = page.getByRole('button', { name: /send/i });
    this.previewPanel = page.getByTestId('report-preview');
    this.saveButton = page.getByRole('button', { name: /save/i });
    this.chart = page.getByTestId('dynamic-chart');
    this.dataTable = page.getByTestId('data-table');
    this.editSidebar = page.getByTestId('edit-sidebar');
  }

  async goto() {
    await this.page.goto('/dashboard/admin/report-builder');
  }

  async sendPrompt(text: string) {
    await this.chatInput.fill(text);
    await this.sendButton.click();
  }

  async waitForPreview() {
    await expect(this.previewPanel).toBeVisible({ timeout: 30_000 });
  }

  async saveReport(title: string) {
    await this.saveButton.click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /title/i }).fill(title);
    await dialog.getByRole('button', { name: /save/i }).click();
  }
}
```

Create `e2e/report-builder/page-objects/library-page.ts`:

```typescript
import { type Page, type Locator, expect } from '@playwright/test';

export class LibraryPage {
  readonly page: Page;
  readonly reportList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.reportList = page.getByTestId('report-list');
  }

  async goto() {
    await this.page.goto('/dashboard/admin/reports');
  }

  async openReport(title: string) {
    await this.reportList.getByRole('link', { name: title }).click();
  }

  async expectReportVisible(title: string) {
    await expect(this.reportList.getByRole('link', { name: title })).toBeVisible();
  }
}
```

Create `e2e/report-builder/page-objects/viewer-page.ts`:

```typescript
import { type Page, type Locator, expect } from '@playwright/test';

export class ViewerPage {
  readonly page: Page;
  readonly chart: Locator;
  readonly exportButton: Locator;
  readonly title: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chart = page.getByTestId('dynamic-chart');
    this.exportButton = page.getByRole('button', { name: /export/i });
    this.title = page.getByRole('heading', { level: 1 });
  }

  async expectLoaded(reportTitle: string) {
    await expect(this.title).toHaveText(reportTitle);
    await expect(this.chart).toBeVisible();
  }
}
```

**Step 2: Write builder flow E2E test**

Create `e2e/report-builder/builder-flow.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { BuilderPage } from './page-objects/builder-page';
import { LibraryPage } from './page-objects/library-page';

test.describe('Report Builder — full flow', () => {
  test('admin can create, preview, and save a report via chat', async ({ page }) => {
    // Mock the SSE chat response to avoid needing a real LLM
    await page.route('**/api/admin/report-builder/chat', async (route) => {
      const encoder = new TextEncoder();
      const body = encoder.encode(
        'data: {"type":"tool_result","tool":"generate_report_spec","result":{"spec":{"version":1,"dataset":"office_attendance","title":"Test Report","timeRange":{"type":"lookback_weeks","weeks":4},"grain":"week","dimensions":["department"],"measures":["office_days"],"filters":[],"sort":[],"visuals":[{"id":"main","type":"bar","x":"department","y":["office_days"]}]}}}\n\n'
      );
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: Buffer.from(body),
      });
    });

    const builder = new BuilderPage(page);
    await builder.goto();
    await builder.sendPrompt('Show office attendance by department');
    await builder.waitForPreview();
    await expect(builder.chart).toBeVisible();
  });

  test('admin can save and find report in library', async ({ page }) => {
    const builder = new BuilderPage(page);
    const library = new LibraryPage(page);

    // ... setup mock, create report ...
    await builder.goto();
    // After creating a report, save it
    await builder.saveReport('My Saved Report');

    // Navigate to library and verify
    await library.goto();
    await library.expectReportVisible('My Saved Report');
  });
});
```

**Step 3: Write access control E2E test**

Create `e2e/report-builder/access-control.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Report Builder — access control', () => {
  test('non-admin users cannot access builder page', async ({ page }) => {
    // Set non-admin bypass email
    await page.goto('/dashboard/admin/report-builder');
    // Should redirect or show 403
    await expect(page).not.toHaveURL(/report-builder/);
  });

  test('builder page loads for HR admin', async ({ page }) => {
    await page.goto('/dashboard/admin/report-builder');
    await expect(page.getByTestId('report-builder')).toBeVisible();
  });
});
```

**Step 4: Write report library E2E test**

Create `e2e/report-builder/library.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { LibraryPage } from './page-objects/library-page';

test.describe('Report Library', () => {
  test('shows empty state when no reports exist', async ({ page }) => {
    const library = new LibraryPage(page);
    await library.goto();
    await expect(page.getByText(/no reports/i)).toBeVisible();
  });

  test('export downloads Excel file', async ({ page }) => {
    // Navigate to a saved report viewer
    await page.goto('/dashboard/reports/test-slug');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });
});
```

**Step 5: Run E2E tests**

```bash
npm run test:e2e
```

Expected: All tests pass (with SSE mocks for AI chat).

**Step 6: Typecheck**

```bash
npm run typecheck
```

**Step 7: Commit**

```bash
git add e2e/ playwright.config.ts
git commit -m "test: add Playwright E2E tests for report builder, library, and access control"
```

---

## Task Dependency Graph

```
Phase 0 (Environment):
  Task 0 (Oracle Docker + Playwright)

Phase 1 (Foundations):
  Task 0 → Task 1 (deps) → Task 2 (types+spec) → Task 3 (registry) → Task 4 (compiler) → Task 5 (oracle) → Task 6 (CRUD) → Task 7 (runners)

Phase 2 (AI Layer):
  Task 7 → Task 8 (AI tools) → Task 9 (chat route) → Task 10 (admin API) → Task 11 (consumption API)

Phase 3 (UI):
  Task 11 → Task 12 (charts) → Task 13 (sidebar) → Task 14 (builder page) → Task 15 (library) → Task 16 (viewer)

Phase 4 (Polish):
  Task 16 → Task 17 (export) → Task 18 (rate limit) → Task 19 (tabs) → Task 20 (Playwright E2E)
```

## Summary

- **21 tasks** (Task 0-20), strictly sequential with clear dependencies
- **Phase 0** (Task 0): Environment — Oracle 23ai Free Docker, Playwright infrastructure
- **Phase 1** (Tasks 1-7): Foundation — types, contracts, compiler, schema (native JSON columns), CRUD, runners
- **Phase 2** (Tasks 8-11): AI Layer — tools, system prompt, chat API, CRUD routes, consumption routes
- **Phase 3** (Tasks 12-16): UI — charts, sidebar, builder page, library, viewer (all Playwright-friendly with data-testid + accessible selectors)
- **Phase 4** (Tasks 17-20): Polish — export, rate limiting, tab integration, Playwright E2E tests
- Each task ends with `npm run typecheck` + commit
- **WebMCP**: Evaluated and skipped — premature (W3C draft, Chrome Canary only). Not related to Anthropic MCP. Future option: `@ai-sdk/mcp` or `@vercel/mcp-handler` for MCP integration if needed.
