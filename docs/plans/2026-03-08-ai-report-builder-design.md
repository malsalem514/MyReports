# AI Report Builder — Technical Design

Date: 2026-03-08
Status: Approved
Spec: `docs/AI-REPORT-BUILDER-SPEC.md`

## 1. Architecture Overview

**Pattern: Thin AI Layer** — the LLM translates natural language to a governed `ReportSpec` JSON. No AI-generated SQL. Deterministic dataset runners build parameterized Oracle queries from the spec.

```
Chat UI → Vercel AI SDK (stream) → GPT-4.1-mini with read-only tools
  → tools call semantic layer metadata (list datasets, describe fields)
  → model outputs ReportSpec JSON
  → server validates with Zod + compileSpec()
  → dataset runner executes parameterized Oracle query
  → Recharts renders preview
  → Save → Oracle TL_REPORT_DEFINITIONS
```

**The spec is the contract boundary.** Everything above it (chat, manual edits) produces a spec. Everything below it (runners, Oracle) consumes a spec. The AI is completely replaceable — an admin can build a report purely through the side panel controls without ever chatting.

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Report logic reuse | Parallel layer (fresh dataset runners) | Don't touch existing reports; share Oracle views + SQL fragments; add parity tests |
| LLM provider | Vercel AI SDK with swappable providers | Provider abstraction via env var, no gateway service needed |
| Default model | GPT-4.1-mini (OpenAI) | Constrained task (slot-filling), fast, cheap, keys available |
| Chart library | Recharts + shadcn/ui chart primitives | React-idiomatic, covers V1 chart types, composable |
| Chat UI | Fork Vercel chatbot template | Already has chat + artifacts panel layout, shadcn/ui + Tailwind |
| AI response style | Stream progressively | Feels responsive; Vercel AI SDK handles SSE natively |
| Page layout | Within dashboard shell (split-pane) | Consistent navigation, builder feels part of the app |
| Draft persistence | Explicit save only | No auto-draft in V1; forces intentional saving |
| Time range | Lookback weeks + custom start/end date | Matches existing dashboard UX |
| Published reports | Library page only (no dashboard home cards) | Simpler V1, one place to find reports |
| Access to published reports | Same tab/visibility system as existing reports | No new access model |
| Official report approval | Single HR admin (no second approval) | Simple for V1 |
| Drill-through | Basic (click dimension filters same report) | No cross-report navigation |
| Exports | Download current view as Excel | No saved export templates |
| MCP Apps | Skip | Not a fit — users are in the browser, not Claude Desktop |

## 2. Semantic Layer

Each dataset is defined as a typed contract that serves three masters: the AI (menu to pick from), the Zod validator (reject invalid specs), and the query builder (map field keys to Oracle columns).

### Dataset Contract Interface

```typescript
// lib/report-datasets/registry.ts

interface DatasetContract {
  key: string;                         // "office_attendance"
  label: string;                       // "Office Attendance"
  description: string;                 // For AI context
  grains: string[];                    // ["week", "day"]
  dimensions: DimensionDef[];
  measures: MeasureDef[];
  derivedFlags: DerivedFlagDef[];
  defaultGrain: string;
  defaultDimensions: string[];
  defaultMeasures: string[];
  supportedChartTypes: ChartType[];
  scopeKeys: ScopeKeyDef[];           // access scope injection points
}

interface DimensionDef {
  key: string;
  label: string;
  type: "string" | "date" | "boolean" | "number";
  filterable: boolean;
  groupable: boolean;
  sensitivity: "public" | "hr_only";   // field-level access control
}

interface MeasureDef {
  key: string;
  label: string;
  type: "integer" | "decimal" | "percentage";
  aggregation: "sum" | "avg" | "count" | "min" | "max";
  sensitivity: "public" | "hr_only";
}

interface ScopeKeyDef {
  field: string;           // "email" or "department"
  accessLevel: "self" | "team" | "all";
  injection: "innermost";  // always inject before aggregation
}
```

### Dataset Contracts

| Dataset | Grains | Key Dimensions | Key Measures | Scope Key |
|---|---|---|---|---|
| `office_attendance` | week, day | department, employee, location, remote_approved | office_days, remote_days, pto_days, compliance_pct | email |
| `working_hours` | week, day | department, employee, location, utilization_level | active_hours, productive_time, focus_hours, productivity_score | email |
| `timesheet_compare` | week, day | department, employee, leave_type | bamboo_pto_hours, tbs_pto_hours, discrepancy_hours | email |
| `employee_directory` | (none) | department, division, location, status, manager | employee_count | email |

### Dataset Runner Interface

```typescript
// lib/report-datasets/office-attendance.ts

export async function runOfficeAttendance(
  spec: CompiledReportSpec,
  accessScope: AccessScope
): Promise<DatasetResult> {
  // 1. Build parameterized Oracle SQL from spec dimensions/measures/filters
  // 2. Inject access scope predicate into innermost CTE (before GROUP BY)
  // 3. Execute via oracle.query()
  // 4. Return { columns, rows, meta: { rowCount, executionMs, freshness } }
}
```

### Access Scope Injection

Each dataset contract declares its `scopeKeys`. The runner injects the access predicate into the **innermost base-row CTE** before any aggregation:

- `self` scope: `WHERE LOWER(email) = :viewer_email`
- `team` scope: `WHERE LOWER(email) IN (:allowed_emails)` (from `AccessContext.allowedEmails` — actual reporting tree, NOT department membership)
- `all` scope: no additional filter (HR admins)

> **Why `allowedEmails` not `department`**: The existing access model (`lib/access.ts`) builds `allowedEmails` from `fetchReportingStructure()` — the actual org tree. Department-based filtering would expose same-department employees outside the viewer's reporting chain.

Contract tests verify identical enforcement across datasets for `self`, `team`, and `all` contexts.

### Shared SQL Fragments

To avoid drift between builder results and existing dashboard numbers:

- **Reuse existing Oracle views**: `V_ATTENDANCE_WEEKLY`, `V_PTO_WEEKLY`
- **Extract common SQL fragments**: `lib/report-datasets/shared-sql.ts` — PTO decomposition, dedup logic, weekday filtering
- **Parity tests**: Compare builder output vs existing `dashboard-data.ts` output for the same date range

### Spec Compiler

`compileSpec()` validates beyond Zod schema — checks semantic compatibility:

- Grain ↔ measure compatibility (e.g., daily grain can't use weekly-aggregated measures)
- Filter operator validity per field type (string: eq/neq/in/not_in; number: eq/gt/lt/between; date: eq/before/after/between)
- Chart encoding validity (KPI requires exactly 1-4 measures, no dimensions; line requires a date dimension on X)
- Max date window (1 year)
- Row cap estimate (warn if estimated rows > 10,000)
- Field sensitivity vs visibility scope (hr_only fields blocked for non-HR visibility)

## 3. Report Spec Model

```typescript
// lib/report-spec.ts

const reportSpecSchema = z.object({
  version: z.literal(1),
  dataset: z.enum(["office_attendance", "working_hours", "timesheet_compare", "employee_directory"]),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  timeRange: z.discriminatedUnion("type", [
    z.object({ type: z.literal("lookback_weeks"), weeks: z.number().int().min(1).max(52) }),
    z.object({ type: z.literal("custom"), start: z.string().date(), end: z.string().date() }),
  ]),
  grain: z.enum(["week", "day"]),
  dimensions: z.array(z.string()).min(1),     // validated against dataset contract
  measures: z.array(z.string()).min(1),        // validated against dataset contract
  filters: z.array(z.object({
    field: z.string(),
    op: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "in", "not_in", "between", "is_null", "is_not_null"]),
    value: z.unknown(),
  })),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]),
  })),
  visuals: z.array(z.object({
    id: z.string(),
    type: z.enum(["table", "bar", "stacked_bar", "line", "kpi"]),
    x: z.string().optional(),
    y: z.array(z.string()),
    series: z.string().nullable().optional(),
    stack: z.boolean().optional(),
    showLegend: z.boolean().optional(),
  })),
});

type ReportSpec = z.infer<typeof reportSpecSchema>;
```

## 4. AI Layer

### Tools (all read-only)

```typescript
const tools = {
  list_datasets: tool({
    description: 'List available report datasets with descriptions',
    parameters: z.object({}),
    execute: async () => registry.listDatasets(),
  }),
  describe_dataset: tool({
    description: 'Get full dimensions, measures, filters, and chart types for a dataset',
    parameters: z.object({
      dataset: z.enum(registry.getDatasetKeys()),  // dynamic enum
    }),
    execute: async ({ dataset }) => registry.describeDataset(dataset),
  }),
  generate_report_spec: tool({
    description: 'Generate a validated report specification from user requirements',
    parameters: buildReportSpecSchema(registry),     // dynamic Zod with field enums
    execute: async (spec) => {
      const compiled = compileSpec(spec, registry);
      if (!compiled.ok) return { error: compiled.errors };
      const preview = await runReport(compiled.spec, accessScope);
      return { spec: compiled.spec, preview: preview.meta };
    },
  }),
};
```

Save, publish, delete, and restore are **NOT** AI tools — they are user-initiated server actions only.

### System Prompt Strategy

- Role: "You are a report builder assistant for an HR analytics platform"
- Dataset summaries (name + description only — full schema loaded via `describe_dataset`)
- 3-5 few-shot example specs covering common patterns
- Constraints: "Only use dimensions, measures, and filters from the dataset contract. Never generate SQL."

### Streaming

```typescript
const result = streamText({
  model: openai('gpt-4.1-mini'),
  system: buildSystemPrompt(registry),
  messages,
  tools,
  maxSteps: 5,
});
return result.toDataStreamResponse();
```

Client uses `useChat` from `@ai-sdk/react`.

## 5. Oracle Persistence

### Tables

```sql
-- ═══════════════════════════════════════════════════════
--  TL_REPORT_DEFINITIONS — canonical saved report
-- ═══════════════════════════════════════════════════════
CREATE TABLE TL_REPORT_DEFINITIONS (
    ID               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    SLUG             VARCHAR2(100)  NOT NULL,
    TITLE            VARCHAR2(500)  NOT NULL,
    DESCRIPTION      VARCHAR2(2000),
    DATASET_KEY      VARCHAR2(50)   NOT NULL,
    REPORT_SPEC      CLOB           NOT NULL,
    VISIBILITY_SCOPE VARCHAR2(30)   DEFAULT 'owner' NOT NULL,
    OWNER_EMAIL      VARCHAR2(255)  NOT NULL,
    IS_PUBLISHED     NUMBER(1)      DEFAULT 0 NOT NULL,
    IS_OFFICIAL      NUMBER(1)      DEFAULT 0 NOT NULL,
    CREATED_AT       TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    UPDATED_AT       TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    ARCHIVED_AT      TIMESTAMP WITH LOCAL TIME ZONE,

    CONSTRAINT UQ_REPORT_SLUG UNIQUE (SLUG),
    CONSTRAINT CHK_REPORT_SPEC_JSON CHECK (REPORT_SPEC IS JSON),
    CONSTRAINT CHK_VISIBILITY CHECK (
        VISIBILITY_SCOPE IN ('owner', 'hr_admin', 'directors_hr', 'managers_hr', 'all')
    ),
    CONSTRAINT CHK_DATASET CHECK (
        DATASET_KEY IN ('office_attendance', 'working_hours', 'timesheet_compare', 'employee_directory')
    )
);

CREATE INDEX IDX_REPORT_DEF_OWNER     ON TL_REPORT_DEFINITIONS (OWNER_EMAIL, ARCHIVED_AT);
CREATE INDEX IDX_REPORT_DEF_PUBLISHED ON TL_REPORT_DEFINITIONS (IS_PUBLISHED, ARCHIVED_AT);
CREATE INDEX IDX_REPORT_DEF_DATASET   ON TL_REPORT_DEFINITIONS (DATASET_KEY, ARCHIVED_AT);

-- ═══════════════════════════════════════════════════════
--  TL_REPORT_VERSIONS — version history + rollback
-- ═══════════════════════════════════════════════════════
CREATE TABLE TL_REPORT_VERSIONS (
    ID              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    REPORT_ID       NUMBER         NOT NULL,
    VERSION_NO      NUMBER         NOT NULL,
    REPORT_SPEC     CLOB           NOT NULL,
    PROMPT_TEXT     CLOB,
    CHANGE_SUMMARY  VARCHAR2(1000),
    CREATED_BY      VARCHAR2(255)  NOT NULL,
    CREATED_AT      TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT FK_REPORT_VER_DEF FOREIGN KEY (REPORT_ID)
        REFERENCES TL_REPORT_DEFINITIONS (ID),
    CONSTRAINT UQ_REPORT_VERSION UNIQUE (REPORT_ID, VERSION_NO),
    CONSTRAINT CHK_REPORT_VER_SPEC_JSON CHECK (REPORT_SPEC IS JSON)
);

CREATE INDEX IDX_REPORT_VER_REPORT ON TL_REPORT_VERSIONS (REPORT_ID, VERSION_NO DESC);

-- ═══════════════════════════════════════════════════════
--  TL_REPORT_FAVORITES — user pinning / quick access
-- ═══════════════════════════════════════════════════════
CREATE TABLE TL_REPORT_FAVORITES (
    REPORT_ID       NUMBER         NOT NULL,
    EMAIL           VARCHAR2(255)  NOT NULL,
    CREATED_AT      TIMESTAMP WITH LOCAL TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,

    CONSTRAINT PK_REPORT_FAV PRIMARY KEY (REPORT_ID, EMAIL),
    CONSTRAINT FK_REPORT_FAV_DEF FOREIGN KEY (REPORT_ID)
        REFERENCES TL_REPORT_DEFINITIONS (ID)
);
```

### Design Rationale

- `TIMESTAMP WITH LOCAL TIME ZONE`: stores UTC, returns in session timezone (Oracle best practice)
- `SYSTIMESTAMP` default: sub-second precision
- `CLOB` + `IS JSON` constraint: safe fallback; upgrade to native `JSON` type if Oracle 21c+ confirmed
- `ARCHIVED_AT` soft delete: `NULL = active`, provides deletion timestamp, indexable
- Named constraints with `CHK_`/`UQ_`/`FK_`/`PK_` prefixes: debuggable constraint violations
- `VISIBILITY_SCOPE` and `DATASET_KEY` as CHECK constraints: DB-level governance
- `TL_REPORT_EXECUTIONS` deferred to V2: preview logging is noisy, track published-report usage later

### Idempotent DDL

Follow existing `initializeSchema()` pattern with `safeExecuteDDL()`:

```typescript
await safeExecuteDDL(conn, `CREATE TABLE TL_REPORT_DEFINITIONS (...)`);
await safeExecuteDDL(conn, `CREATE INDEX IDX_REPORT_DEF_OWNER ON ...`);
```

### Transactional Versioning

```typescript
// CRITICAL: All operations on ONE connection with autoCommit OFF to prevent race conditions.
// The global oracledb.autoCommit = true is overridden per-statement here.
const conn = await getConnection();
try {
  // Lock the report row — prevents concurrent version writes
  await conn.execute(
    'SELECT ID FROM TL_REPORT_DEFINITIONS WHERE ID = :id FOR UPDATE',
    { id },
    { autoCommit: false },
  );
  // Read max version on the SAME connection (not via query() which gets a new conn)
  const result = await conn.execute<{ MAX_VER: number }>(
    'SELECT NVL(MAX(VERSION_NO), 0) AS MAX_VER FROM TL_REPORT_VERSIONS WHERE REPORT_ID = :id',
    { id },
    { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: false },
  );
  const maxVer = result.rows?.[0]?.MAX_VER ?? 0;
  const nextVer = maxVer + 1;
  // Insert new version on same connection
  await conn.execute(
    'INSERT INTO TL_REPORT_VERSIONS (...) VALUES (...)',
    { reportId: id, versionNo: nextVer, /* ... */ },
    { autoCommit: false },
  );
  // Update the definition
  await conn.execute(
    'UPDATE TL_REPORT_DEFINITIONS SET REPORT_SPEC = :spec, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id',
    { spec, id },
    { autoCommit: false },
  );
  await conn.execute('COMMIT');
} catch (e) {
  await conn.execute('ROLLBACK');
  throw e;
} finally {
  await conn.close();
}
```

## 6. API Routes

### Builder Routes (HR-admin only)

```
/api/admin/report-builder/
├── chat/route.ts           POST — Vercel AI SDK streamText SSE endpoint
├── preview/route.ts        POST — validate spec + run dataset query + return rows
├── reports/route.ts        GET  — list all reports (paginated, search, filter)
│                           POST — save new report (compileSpec + field-sensitivity check)
├── reports/[id]/route.ts   GET  — load report + spec
│                           PUT  — update (full validation pipeline, transactional versioning)
│                           DELETE — soft-delete (set ARCHIVED_AT)
├── reports/[id]/versions/route.ts   GET — list version history
└── reports/[id]/duplicate/route.ts  POST — clone with new slug (re-validate)
```

### Consumption Routes (role-based)

```
/api/reports/
├── route.ts                GET  — list published reports (filtered by viewer's access level)
├── [id]/route.ts           GET  — load published report (visibility check)
├── [id]/run/route.ts       POST — execute report with viewer's access scope
└── [id]/favorite/route.ts  POST/DELETE — toggle favorite
```

### Authorization Matrix

| Route | Owner | HR Admin | Director | Manager | Employee |
|---|---|---|---|---|---|
| Builder (chat/preview/save) | — | full | — | — | — |
| Admin report list | — | all reports | — | — | — |
| Published report list | — | all | scope-filtered | scope-filtered | scope-filtered |
| Published report view/run | — | all | if `visibility ∈ {directors_hr, all}` | if `visibility ∈ {managers_hr, all}` | if `visibility = all` |
| Favorites | own | own | own | own | own |
| Archived reports | — | visible (filtered) | hidden | hidden | hidden |

Non-HR users receive `404` (not `403`) for inaccessible reports to prevent enumeration.

### Validation Pipeline (every mutation)

All mutating endpoints (`POST /reports`, `PUT /reports/[id]`, `POST /duplicate`) run the full pipeline:

1. Parse with Zod schema
2. `compileSpec()` — grain/measure compat, filter ops, chart encodings, date window, row cap
3. Field sensitivity check — `hr_only` fields blocked for non-HR visibility scopes
4. Write to Oracle (transactional for updates)

### Rate Limiting

- Chat: max 3 concurrent sessions per user, max 2000 chars per prompt
- Preview: max 10 queries/minute per user
- Query timeout: 30 seconds per dataset query
- Response: `429` with `Retry-After` header

### Error Contract

```typescript
// Standardized error response
{ error: { code: string, message: string, requestId: string } }

// Status codes
// 401 — unauthenticated
// 403 — forbidden (HR-admin routes only, hidden as 404 for consumption routes)
// 404 — not found or inaccessible
// 409 — slug or version conflict
// 422 — invalid spec (compileSpec failures)
// 429 — rate limited
// 500 — internal error

// SSE error events (chat endpoint)
{ type: "error", code: string, message: string }
```

## 7. UI Components

### Page Layout (within dashboard shell)

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard Header (existing nav bar)                        │
├──────────────────────┬──────────────────────────────────────┤
│  Chat Panel (35%)    │  Preview Panel (65%)                 │
│                      │  ┌──────────────────────────────────┐│
│  ┌────────────────┐  │  │  Title + Actions Bar             ││
│  │ Message list   │  │  │  [Run] [Save] [Save as] [Publish]││
│  │ (scrollable)   │  │  └──────────────────────────────────┘│
│  │                │  │  ┌──────────────────────────────────┐│
│  │ AI streaming   │  │  │  Chart/Table Render              ││
│  │ responses +    │  │  │  (Recharts DynamicChart or       ││
│  │ spec proposals │  │  │   data table)                    ││
│  │                │  │  │                                  ││
│  └────────────────┘  │  └──────────────────────────────────┘│
│  ┌────────────────┐  │  ┌──────────────────────────────────┐│
│  │ Prompt input   │  │  │  Edit Sidebar (collapsible)      ││
│  │ [Send]         │  │  │  Dataset | Dims | Measures |     ││
│  └────────────────┘  │  │  Filters | Chart type | Grain    ││
│                      │  └──────────────────────────────────┘│
└──────────────────────┴──────────────────────────────────────┘
```

### Components

| Component | Source | Description |
|---|---|---|
| `ReportBuilderPage` | Fork Vercel chatbot template | Split-pane layout, route: `/dashboard/admin/report-builder` |
| `ChatPanel` | Vercel chatbot template + `useChat` | Message list, prompt input, streaming responses |
| `PreviewPanel` | New | Hosts chart, table, action bar, edit sidebar |
| `DynamicChart` | New (~150 LOC) | Config-driven Recharts renderer — component map + spec object |
| `DataTable` | New | Sortable table from result rows |
| `EditSidebar` | New | Dataset/dims/measures/filters/chart pickers (shadcn/ui) |
| `FilterBuilder` | New (~200 LOC) | shadcn/ui Select + DatePicker + Input |
| `KPICards` | New | Summary metric cards (1-4 measures) |
| `ReportLibraryPage` | New | List saved reports, search, favorites. Route: `/dashboard/admin/reports` |
| `ReportViewerPage` | New | Load + render saved report, export. Route: `/dashboard/reports/[slug]` |

### Interaction Flows

1. **AI-driven:** User types prompt → AI streams response + proposes spec → PreviewPanel auto-renders → EditSidebar populates with spec values
2. **Manual-driven:** User changes control in EditSidebar → spec updates locally → triggers re-run via `/preview` → preview updates
3. **Hybrid:** AI proposes spec → user tweaks one filter → re-runs → saves
4. **Drill-through:** User clicks a dimension value in chart/table → same report re-runs with that value as an additional filter

### DynamicChart Renderer

```typescript
const CHART_MAP = {
  bar:         { Container: BarChart, Series: Bar },
  stacked_bar: { Container: BarChart, Series: Bar },
  line:        { Container: LineChart, Series: Line },
} as const;

function DynamicChart({ spec, data }: { spec: VisualSpec; data: Record<string, unknown>[] }) {
  const { Container, Series } = CHART_MAP[spec.type];
  return (
    <ResponsiveContainer width="100%" height={400}>
      <Container data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={spec.x} />
        <YAxis />
        <Tooltip />
        <Legend />
        {spec.y.map((key, i) => (
          <Series key={key} dataKey={key} fill={COLORS[i]} stackId={spec.stack ? "stack" : undefined} />
        ))}
      </Container>
    </ResponsiveContainer>
  );
}
```

## 8. File Structure

```
lib/
├── report-datasets/
│   ├── registry.ts              — dataset contracts + registry functions
│   ├── shared-sql.ts            — reusable Oracle SQL fragments (PTO decomp, dedup, weekday filter)
│   ├── office-attendance.ts     — query builder + runner
│   ├── working-hours.ts         — query builder + runner
│   ├── timesheet-compare.ts     — query builder + runner
│   └── employee-directory.ts    — query builder + runner
├── report-builder/
│   ├── report-spec.ts           — Zod schema + ReportSpec type
│   ├── compile-spec.ts          — semantic validation (grain/measure compat, field sensitivity, caps)
│   ├── report-runner.ts         — spec → dataset runner → rows
│   ├── ai-tools.ts              — tool definitions for Vercel AI SDK
│   ├── system-prompt.ts         — prompt builder with catalog + few-shot examples
│   └── report-crud.ts           — Oracle CRUD operations (save, update, delete, list, load)

app/
├── dashboard/admin/
│   ├── report-builder/
│   │   ├── page.tsx             — builder page (server component, auth gate)
│   │   └── report-builder-client.tsx — client component (chat + preview)
│   └── reports/
│       └── page.tsx             — report library (admin view, all reports)
├── dashboard/reports/
│   └── [slug]/
│       └── page.tsx             — report viewer (published reports, role-based)
├── api/admin/report-builder/
│   ├── chat/route.ts
│   ├── preview/route.ts
│   ├── reports/route.ts
│   ├── reports/[id]/route.ts
│   ├── reports/[id]/versions/route.ts
│   └── reports/[id]/duplicate/route.ts
└── api/reports/
    ├── route.ts
    ├── [id]/route.ts
    ├── [id]/run/route.ts
    └── [id]/favorite/route.ts
```

## 9. New Dependencies

```json
{
  "ai": "^6.x",
  "@ai-sdk/openai": "^1.x",
  "@ai-sdk/react": "^1.x",
  "recharts": "^2.x"
}
```

shadcn/ui chart components are copy-pasted (not a package dependency).

## 10. Security Summary

| Layer | Mechanism |
|---|---|
| Page access | HR-admin only for builder; role-based for published reports |
| AI governance | Read-only tools; dynamic Zod enums from dataset contracts; no SQL generation |
| Spec validation | Zod schema + `compileSpec()` semantic checks on every mutation |
| Field sensitivity | `hr_only` flag on dimensions/measures; publish validation blocks leakage |
| Access scope | Injected into innermost CTE before aggregation; contract tests per dataset |
| Data exposure | Parameterized queries; no raw SQL to client; no table names in API responses |
| Rate limiting | Per-user concurrency + query rate caps; 30s query timeout |
| Error masking | 404 for inaccessible resources (non-HR); no internal details in client errors |
| Versioning | Transactional with `SELECT FOR UPDATE`; `UQ_REPORT_VERSION` constraint |

## 11. V1 Scope

### In scope

- Admin-only report builder with chat + manual controls
- Semantic layer for 4 datasets (attendance, hours, timesheet, directory)
- Table / bar / stacked bar / line / KPI visuals
- Save / load / edit / duplicate / publish
- Report library page (admin) + report viewer (role-based)
- Version history
- Favorites
- Source freshness label
- Excel export (current view)
- Basic drill-through (click dimension → filter same report)

### Out of scope (V2+)

- Execution logging / usage analytics
- Drag-and-drop dashboard layouts (`react-grid-layout`)
- Scheduled email distribution
- Area / heatmap / combo / scatter charts
- Multi-visual dashboards
- Clone + edit via chat
- Official / verified / deprecated badges with approval workflow
- Director / manager scoped builder access
- Prompt templates gallery
- Dashboard home pinned cards

## 12. Open Items

1. Confirm Oracle version (21c+ enables native `JSON` type; otherwise `CLOB` + `IS JSON`)
2. Generate slug strategy (slugify title + short random suffix for uniqueness)
3. Define exact few-shot example specs for system prompt
4. Determine max concurrent dataset queries per Oracle pool (current pool: min 2, max 10)
