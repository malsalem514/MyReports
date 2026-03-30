# Office Attendance Approved Coverage Spec

Date: 2026-03-29
Status: Implemented
Scope: `app/dashboard/office-attendance/*`, `lib/dashboard-data.ts`, `lib/types/attendance.ts`

## Goal

Keep office attendance reporting fair and transparent by:

- showing raw office days for every employee-week
- adjusting compliance against approved week-level remote-work and work-abroad coverage
- keeping standing WFH policy visible without treating it as an automatic weekly exemption
- using clear week markers in the UI and exports so managers can tell why a week was adjusted

## Source Data

The implemented behavior uses three BambooHR-backed Oracle sources:

- `TL_EMPLOYEES.REMOTE_WORKDAY_POLICY_ASSIGNED`
  - standing policy flag
  - informational only in v1 of the adjusted attendance logic
- `TL_REMOTE_WORK_REQUESTS`
  - approved temporary remote-work requests
- `TL_WORK_ABROAD_REQUESTS`
  - approved temporary work-abroad or another-province requests

The daily sync keeps these sources current in Oracle and the attendance report reads from Oracle, not directly from BambooHR.

## Implemented Policy Rules

### Standing WFH policy

`REMOTE_WORKDAY_POLICY_ASSIGNED = 1` is treated as an employee policy label only.

It does:

- set `hasStandingWfhPolicy`
- contribute to `remoteWorkStatusLabel`
- remain visible in exports and the employee row

It does not:

- reduce the weekly office target
- make a week compliant by itself
- place the employee in the `approved-only` filter by itself
- add week markers by itself

### Approved temporary coverage

Only approved temporary records change week scoring:

- approved remote-work requests
- approved work-abroad / another-province requests

Week scoring uses only overlapping approved weekdays inside the scored week.

### Adjusted target

For each employee-week:

1. start from the standard target
2. subtract approved temporary weekdays in that week
3. floor the adjusted target at `0`
4. apply PTO excusal only after the adjusted target is known

Results:

- if adjusted target is `0`, the week is compliant and exempt from the KPI denominator
- if adjusted target is above `0`, compliance is based on the reduced target
- if PTO leaves too few available weekdays to satisfy the adjusted target, the week is excused and neutral to the KPI denominator
- if ActivTrak coverage is unknown, the week remains neutral

## Backend Contract

### `WeekCell`

The week cell carries:

- `rawOfficeTarget`
- `adjustedOfficeTarget`
- `adjustedCompliant`
- `isPtoExcused`
- `hasApprovedWfhCoverage`
- `hasApprovedRemoteCoverage`
- `hasApprovedWorkAbroadCoverage`
- `approvedCoverageWeekdays`
- `exceptionLabel`

### `AttendanceRow`

The row carries:

- `hasStandingWfhPolicy`
- `hasApprovedRemoteRequestInRange`
- `hasApprovedWorkAbroadRequestInRange`
- `hasAnyApprovedWfhCoverageInRange`

Important:

- `hasAnyApprovedWfhCoverageInRange` means actual approved temporary coverage in the selected range
- it intentionally excludes the standing policy flag

## UI Behavior

### Week markers

The employee grid keeps showing raw office days and adds small coverage markers when temporary approved coverage affected that week:

- remote-work coverage: house icon
- work-abroad coverage: plane icon
- both can appear in the same week if both sources apply

Exports use text equivalents:

- remote-work coverage: `[House]`
- work-abroad coverage: `[Plane]`

### Week colors

Current color precedence:

1. unknown coverage stays gray
2. any PTO in the week keeps the blue PTO signal
3. adjusted compliant weeks are green
4. non-compliant measured weeks use the standard warning/error tones

### Tooltips and detail modal

Week detail surfaces:

- raw office days
- raw target
- adjusted target
- PTO days
- approved coverage weekdays
- coverage source label

Coverage source can include:

- temporary remote work
- work abroad / another province
- both, when applicable

### Filters

The WFH filter operates on actual approved temporary coverage in range:

- `all`
- `standard-only`
- `approved-only`

Standing policy alone does not move an employee into `approved-only`.

## Aggregate Behavior

Department and manager views compute weekly buckets from the adjusted week logic:

- `eligibleEmployees`
- `compliantEmployees`
- `exemptEmployees`
- `excusedEmployees`
- `unknownEmployees`

Rules:

- only weeks with `adjustedOfficeTarget > 0` are eligible
- weeks with `adjustedOfficeTarget === 0` are exempt
- PTO-excused weeks are neutral
- unknown ActivTrak coverage is neutral

## Export Behavior

CSV and XLSX match the UI logic:

- employee weekly cells export the displayed office-day value plus `[House]` and/or `[Plane]`
- standing policy stays visible in dedicated metadata columns
- approved coverage in range reflects temporary approved coverage only
- aggregate exports include exempt and PTO-excused breakdown columns

## Acceptance Cases

1. Standing-policy employee with no approved temporary coverage:
   - no week marker
   - normal weekly target
   - employee remains in `standard-only`

2. Approved remote-work week that reduces target to `0`:
   - house marker shown
   - adjusted target `0`
   - week is compliant and exempt

3. Approved work-abroad week that reduces target to `1`:
   - plane marker shown
   - adjusted target `1`
   - compliance depends on actual office days versus `1`

4. Week with PTO and approved coverage:
   - tooltip shows both PTO and approved coverage details
   - blue PTO signal remains visible
   - denominator treatment follows adjusted-target and PTO-excusal rules

5. Employee with no ActivTrak coverage:
   - week stays neutral
   - no compliance failure is recorded
