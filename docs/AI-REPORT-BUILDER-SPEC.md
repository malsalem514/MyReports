# MyReports AI Report Builder Spec

Last updated: 2026-03-08
Owner: MyReports Engineering
Status: Draft

## 1) Goal

Add an admin-only report builder that lets authorized users:

- chat with existing MyReports data using natural language,
- generate tables and visualizations from governed datasets,
- preview and refine the result interactively,
- save reports to the dashboard as normal app content,
- reopen and use saved reports later without requiring an LLM call.

The core product model is:

`chat -> structured report spec -> preview -> save/publish -> normal rendering`

## 2) Why This Direction

This is the strongest pattern for MyReports because:

- the app already has trusted report datasets and role-scoped access rules,
- HR/admin users need repeatable, auditable output rather than one-off chatbot answers,
- LLMs are best used for intent-to-spec translation, not as the permanent query engine,
- saved reports reduce cost, improve trust, and make dashboards reusable.

## 3) Product Principles

1. Governed first.
   - The LLM can only compose reports from approved datasets, dimensions, measures, and filters.

2. Save definitions, not just answers.
   - Every durable artifact is a validated report spec stored in Oracle.

3. No arbitrary SQL from the model.
   - Query generation stays server-side through known dataset builders.

4. Preview before publish.
   - AI can draft a report, but admins confirm what gets saved or shared.

5. Role rules are never bypassed.
   - Saved reports still resolve access at runtime using the current user and current scope.

6. LLM is optional at read time.
   - Opening a saved report should not require the model unless the user explicitly enters chat mode again.

## 4) Primary Use Cases

### V1 use cases

- "Show office attendance by department for the last 30 days."
- "Create a weekly working-hours variance report for managers in Operations."
- "Compare approved remote-work employees vs everyone else by month."
- "Build a table of employees with low compliance and approved leave."
- "Create a bar chart of office days by department and save it."

### V2 use cases

- multi-visual dashboards with layout editing,
- cloning and editing previously saved reports via chat,
- scheduled emailed exports,
- anomaly and exception templates,
- "official" curated admin report gallery.

## 5) Non-Goals

- Free-form SQL editor for admins
- General-purpose BI replacement for all enterprise reporting
- Allowing employees/managers to discover data outside their normal access scope
- Auto-publishing AI-generated reports without validation
- Supporting arbitrary external data sources beyond current integrations in V1

## 6) Users and Permissions

### Roles

- `hr-admin`
  - full access to builder, drafts, shared reports, publish controls
- `director`
  - optional future access to curated or limited builder flows
- `manager`
  - optional future access to scoped personal/team report creation
- `employee`
  - no builder access in V1

### V1 policy

- only `hr-admin` can access `/dashboard/admin/report-builder`
- saved reports may be visible to:
  - owner only,
  - HR admins,
  - directors+HR,
  - managers+HR,
  - all users with scoped runtime filtering

### Runtime access rule

Saved reports never store pre-expanded unrestricted data. They store:

- dataset,
- filters,
- dimensions,
- measures,
- chart config,
- visibility metadata.

At render time, the report executes through the same access pipeline already used by:

- Office Attendance
- Working Hours
- Timesheet Compare

## 7) Source Inventory and Expansion Strategy

The data model should expand as much as possible within current source systems, but only through the governed reporting layer.

### Existing source systems

1. Oracle reporting store
   - `TL_EMPLOYEES`
   - `TL_ATTENDANCE`
   - `TL_PRODUCTIVITY`
   - `TL_TIME_OFF`
   - `TL_TBS_EMPLOYEE_MAP`
   - `TL_SYNC_LOG`
   - current report views / helper SQL

2. TBS via Oracle DB link
   - `TBS_ALL_TIME_ENTRIES_V@TBS_LINK`

3. ActivTrak source export
   - exported into Oracle and read from Oracle for app reporting

4. BambooHR
   - synced into Oracle for app reporting and access metadata

### Expansion rule

For this feature, "expand the data model" means:

- expose more approved fields from the current synced sources,
- define more derived measures and dimensions,
- create reusable dataset builders over those fields,
- avoid introducing new external dependencies until the governed layer is stable.

## 8) Proposed Semantic Layer

The semantic layer is the approved contract between AI, saved report specs, and query execution.

### Core datasets

#### A. `office_attendance`

Grain:
- employee x week
- employee x day (detail mode)
- department x week (aggregated mode)

Base sources:
- `TL_ATTENDANCE`
- `TL_TIME_OFF`
- `TL_EMPLOYEES`

Dimensions:
- week
- date
- employee
- employee email
- department
- division
- office location
- manager
- remote work approved flag
- employment status

Measures:
- office days
- remote days
- unknown days
- PTO days
- compliance score
- compliance percentage
- employee count
- zero-office-week count
- excused-week count

Derived flags:
- below policy
- approved remote worker
- PTO-only week
- no-attendance week

#### B. `working_hours`

Grain:
- employee x week
- employee x day
- TBS entry line x day

Base sources:
- `TL_PRODUCTIVITY`
- `TL_TIME_OFF`
- `TL_EMPLOYEES`
- `TL_TBS_EMPLOYEE_MAP`
- `TBS_ALL_TIME_ENTRIES_V@TBS_LINK`

Dimensions:
- week
- date
- employee
- employee number
- department
- division
- manager
- location
- utilization level
- leave type
- TBS work code
- TBS entry type
- CRF / defect case

Measures:
- active hours
- total tracked hours
- focus hours
- collaboration hours
- break / idle hours
- productive active
- productive passive
- undefined active
- undefined passive
- unproductive active
- TBS reported hours
- TBS absence hours
- variance vs TBS
- productivity score
- first activity time
- last activity time

Derived flags:
- under-reported
- over-reported
- no TBS but high activity
- approved leave with activity
- unmapped TBS employee

#### C. `timesheet_compare`

Grain:
- employee x week
- employee x day

Base sources:
- Oracle synced Bamboo leave data
- TBS entries
- employee map

Dimensions:
- employee
- department
- week
- leave type
- entry type

Measures:
- bamboo PTO hours/days
- TBS PTO hours/days
- discrepancy count
- discrepancy hours

#### D. `employee_directory`

Grain:
- employee

Base sources:
- `TL_EMPLOYEES`

Dimensions:
- employee
- department
- division
- location
- manager
- title
- status
- hire date
- tenure
- remote-work policy assigned

Measures:
- employee count

### V1 chart types

- table
- KPI cards
- bar chart
- stacked bar chart
- line chart

### V2 chart types

- area chart
- heatmap
- combo chart
- scatter plot

## 9) Report Spec Model

The report builder should save a strict JSON report definition validated server-side.

### Report spec shape

```json
{
  "version": 1,
  "dataset": "office_attendance",
  "title": "Office Attendance by Department",
  "description": "Last 30 days, grouped by department",
  "timeRange": {
    "type": "relative",
    "preset": "last_30_days"
  },
  "grain": "week",
  "dimensions": ["department", "week"],
  "measures": ["office_days", "employee_count", "compliance_percentage"],
  "filters": [
    { "field": "employment_status", "op": "eq", "value": "active" },
    { "field": "department", "op": "not_in", "value": ["Executive", "Administration"] }
  ],
  "sort": [
    { "field": "week", "direction": "asc" },
    { "field": "office_days", "direction": "desc" }
  ],
  "visuals": [
    {
      "id": "main",
      "type": "stacked_bar",
      "x": "week",
      "y": ["office_days", "remote_days", "pto_days"],
      "series": "department"
    }
  ],
  "layout": {
    "type": "single"
  },
  "defaultDrill": {
    "target": "employee_day_detail"
  }
}
```

### Validation rules

- `dataset` must be one of the approved datasets
- `dimensions`, `measures`, and `filters.field` must exist in that dataset contract
- `grain` must be compatible with dataset and chart
- unsupported field combinations are rejected server-side
- filters are normalized to canonical operators and values
- runtime access filters are appended separately and not editable by the user

## 10) Oracle Persistence Model

Saved reports should be first-class application objects.

### Proposed tables

#### `TL_REPORT_DEFINITIONS`

- `ID`
- `SLUG`
- `TITLE`
- `DESCRIPTION`
- `DATASET_KEY`
- `REPORT_SPEC_JSON` (CLOB)
- `VISIBILITY_SCOPE`
- `OWNER_EMAIL`
- `IS_PUBLISHED`
- `IS_OFFICIAL`
- `CREATED_AT`
- `UPDATED_AT`
- `ARCHIVED_AT`

Purpose:
- canonical saved report definition

#### `TL_REPORT_VERSIONS`

- `ID`
- `REPORT_ID`
- `VERSION_NO`
- `REPORT_SPEC_JSON` (CLOB)
- `PROMPT_TEXT` (CLOB, optional)
- `CHANGE_SUMMARY`
- `CREATED_BY`
- `CREATED_AT`

Purpose:
- version history and rollback

#### `TL_REPORT_FAVORITES`

- `REPORT_ID`
- `EMAIL`
- `CREATED_AT`

Purpose:
- user pinning / quick access

#### `TL_REPORT_EXECUTIONS`

- `ID`
- `REPORT_ID`
- `EXECUTED_BY`
- `STARTED_AT`
- `COMPLETED_AT`
- `STATUS`
- `ROW_COUNT`
- `ERROR_MESSAGE`
- `FILTER_CONTEXT_JSON`

Purpose:
- audit, debugging, usage insights

#### Optional `TL_REPORT_SHARES`

- `REPORT_ID`
- `ROLE_KEY`
- `EMAIL`
- `ACCESS_LEVEL`
- `CREATED_AT`

Purpose:
- more granular visibility if needed beyond a simple scope enum

## 11) UI / UX

### Entry point

- new admin-only page under dashboard admin area:
  - `/dashboard/admin/report-builder`

### V1 layout

- left panel: chat + prompt history
- center/right panel: live report preview
- top actions:
  - `Run`
  - `Save`
  - `Save as new`
  - `Publish`
  - `Duplicate`
- side panel:
  - dataset
  - dimensions
  - measures
  - filters
  - chart type
  - visibility

### Interaction model

1. Admin enters prompt
2. LLM proposes a structured report spec
3. Server validates and normalizes it
4. UI shows preview and editable controls
5. Admin tweaks fields without chat if desired
6. Admin saves or publishes
7. Saved report appears in dashboard report library

### V1 dashboard consumption

Saved reports should appear in one of two ways:

1. `My Saved Reports`
   - private to the creator

2. `Published Reports`
   - shared according to visibility rules

Do not create a brand-new top nav tab for every saved report in V1. That will not scale.

Better V1 pattern:

- one `Reports` library page
- pinned reports on dashboard home
- optional favorites / recent section

## 12) AI Layer

### Recommended implementation

- chat UI in existing Next.js app
- Vercel AI SDK for streaming and tool orchestration
- model gateway via LiteLLM
- one initial hosted model for production quality
- optional Ollama support for local/dev only

### Model responsibilities

The model may:

- interpret user intent
- choose dataset
- choose dimensions/measures/filters from the semantic layer
- propose chart types
- explain assumptions
- revise an existing saved report spec

The model may not:

- generate arbitrary SQL for production execution
- bypass visibility and role access
- access raw tables not present in the semantic layer
- publish reports directly without server-side validation

### Tooling pattern

Use tools such as:

- `list_datasets`
- `describe_dataset`
- `generate_report_spec`
- `validate_report_spec`
- `preview_report`
- `save_report_definition`
- `list_saved_reports`
- `load_saved_report`

The model should operate on structured JSON and dataset metadata, not on schema dumps.

## 13) Query Execution Architecture

### Execution path

1. Load saved spec
2. Validate spec version
3. Resolve runtime user access scope
4. Convert spec into dataset query options
5. Call dataset-specific query builder
6. Return normalized result set
7. Render in chart/table layer

### Recommended internal structure

Add a new server-side layer:

- `lib/report-datasets/office-attendance.ts`
- `lib/report-datasets/working-hours.ts`
- `lib/report-datasets/timesheet-compare.ts`
- `lib/report-spec.ts`
- `lib/report-runner.ts`

This should sit above current report helpers and below UI/API layers.

### Why not execute from current page components directly

Current page loaders are page-oriented and specialized. The report builder needs:

- reusable dataset metadata,
- reusable query options,
- reusable normalization,
- a stable contract for AI and saved reports.

## 14) Visualization Layer

### Recommendation

Persist a visualization config that is independent from the raw result rows.

Good options:

- `Vega-Lite`
  - strongest if you want a portable declarative chart grammar
- `ECharts option subset`
  - strongest if you prioritize richer app-style interactions

### V1 recommendation

Use a lightweight internal chart config format, not full raw Vega-Lite yet.

Example:

```json
{
  "type": "bar",
  "x": "department",
  "y": ["office_days"],
  "series": null,
  "stack": false,
  "showLegend": false
}
```

Reason:

- easier to validate,
- easier to evolve,
- better fit for a constrained governed BI builder.

If the system matures, map that internal config to Vega-Lite or ECharts renderer options.

## 15) Governance and Trust Features

### Required in V1

- source freshness label
- report owner
- created/updated timestamps
- version history
- visibility badge
- dataset badge

### Recommended in V2

- `Official`
- `Verified`
- `Deprecated`
- quality notes / assumptions

### Audit expectations

For each saved report, keep:

- who created it,
- who changed it,
- which prompt created the current version,
- which runtime filter context was used in execution.

## 16) Security and Access

### Must-have safeguards

- builder page is admin-only
- model tools run only server-side
- access scope is enforced after spec resolution and before data retrieval
- no direct DB credentials or raw SQL exposed to the client
- report specs are validated with Zod
- chart rendering sanitizes labels and content

### Sensitive fields

Do not expose everything from source systems just because it exists.

Each dataset should explicitly whitelist:

- fields allowed in filters,
- fields allowed in grouping,
- fields allowed in output,
- fields allowed only to HR admins.

## 17) Suggested V1 Scope

### In scope

- admin-only report builder
- semantic layer for current three report domains
- table/bar/line/stacked bar/KPI visuals
- save/load/edit/duplicate/publish
- private and published visibility
- report library page
- source freshness and version history

### Out of scope

- arbitrary SQL
- per-user drag-and-drop dashboard layout builder
- scheduled distribution
- local LLM as primary production model
- cross-source joins outside approved semantic datasets

## 18) Delivery Plan

## Phase 1 — Foundations

- define semantic layer contracts
- extract current report logic into reusable dataset runners
- create report spec schema and validator
- create Oracle tables for report definitions and versions

## Phase 2 — Builder MVP

- admin-only chat page
- preview panel
- save/load/edit/duplicate
- report library

## Phase 3 — Publish and Consumption

- published reports section
- favorites / pinned reports
- audit log
- version restore

## Phase 4 — AI Quality and Governance

- prompt templates
- better natural-language refinement
- official/verified workflow
- optional director/manager scoped builder access

## 19) Open Design Questions

1. Should published reports appear only in a library page, or also as dashboard home cards?
2. Should directors get read-only access to published AI-built reports in V1?
3. Do we want "official reports" to require HR-admin approval from a second user?
4. Do we want exports saved as templates tied to report definitions?
5. Should report specs support drill-through targets in V1, or only static views?

## 20) Recommendation

Build this as a governed internal BI layer inside MyReports.

Do not start from arbitrary text-to-SQL. Start from:

- semantic datasets,
- constrained report specs,
- admin preview/edit/save flow,
- normal runtime rendering afterward.

That gives the team the flexibility of AI-assisted exploration without sacrificing trust, repeatability, and access control.
