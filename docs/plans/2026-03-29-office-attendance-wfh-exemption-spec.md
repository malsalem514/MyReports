# Office Attendance WFH Exception Spec

Date: 2026-03-29
Status: Draft
Scope: `app/dashboard/office-attendance/*`, `lib/dashboard-data.ts`, `lib/types/attendance.ts`

## 1. Goal

Make the office attendance report fair for employees with approved work-from-home coverage by:

- keeping those employees visible in the report instead of treating them as blanket exclusions
- scoring compliance per employee-week against an adjusted target
- marking affected weeks with a green compliant state when the adjusted policy is satisfied
- adding `*` to the weekly office-days value when approved WFH coverage affected that week
- keeping raw office-day counts visible so the report stays transparent

This spec builds on the existing attendance pipeline and does not introduce a second reporting system.

## 2. Source Code Research Summary

### 2.1 Existing data sources already in production

The repo already has both required approval sources:

- Standing policy flag:
  - `TL_EMPLOYEES.REMOTE_WORKDAY_POLICY_ASSIGNED`
  - synced from BambooHR field `4631.0` in `lib/bamboohr.ts` and `lib/sync.ts`
- Temporary approved requests:
  - `TL_REMOTE_WORK_REQUESTS`
  - fields already include `REMOTE_WORK_START_DATE`, `REMOTE_WORK_END_DATE`, `REMOTE_WORK_TYPE`, `MANAGER_APPROVAL_RECEIVED`, and `ALTERNATE_IN_OFFICE_WORK_DATE`

No Oracle schema change is required for v1 of this feature.

### 2.2 Existing attendance backend behavior

`lib/dashboard-data.ts#getAttendanceReport(...)` already loads:

- weekly attendance from `V_ATTENDANCE_WEEKLY`
- employee metadata from `V_USER_MAPPINGS` + `TL_EMPLOYEES`
- daily attendance detail from `TL_ATTENDANCE`
- PTO-expanded weekdays from `TL_TIME_OFF`
- remote-work requests from `TL_REMOTE_WORK_REQUESTS`

The same function already:

- recognizes approved temporary remote-work requests when `MANAGER_APPROVAL_RECEIVED` is `YES` or `APPROVED`
- builds `approvedRemoteWorkEmails`
- builds `approvedRemoteWorkTypesByEmail`
- exposes row-level `approvedRemoteWorkRequest` and `remoteWorkStatusLabel`

Current gap:

- the permanent policy flag is not used in office attendance scoring
- temporary approvals affect labels only, not weekly targets
- weekly compliance currently adjusts only for PTO availability

### 2.3 Existing UI behavior

`app/dashboard/office-attendance/attendance-client.tsx` currently:

- colors employee week cells only from `officeDays` and `ptoDays`
- calculates employee score from raw office days and PTO capacity
- excludes `approvedRemoteWorkRequest` employees by default in employee view
- treats approved remote workers as fully excluded from aggregate eligibility
- shows remote-work request data in a dedicated "Remote Work Requests" view
- exports CSV/XLSX using raw office-day values only

Current gap:

- the page treats remote approval as an employee-level flag, but the requirement is employee-week handling

## 3. Policy Assumptions

These assumptions should be used for implementation unless HR later gives a richer policy model.

### 3.1 Standing policy flag

`REMOTE_WORKDAY_POLICY_ASSIGNED = 1` is treated as standing approved WFH coverage.

For this first version, that means:

- every scored week in range is treated as WFH-covered for that employee
- adjusted office target becomes `0` for those weeks
- those weeks are marked with `*`
- those weeks are green in the employee grid
- those weeks are excluded from KPI denominator and score capacity

Reason: the repo currently stores only a boolean standing-policy flag, not a custom numeric in-office target. If HR later wants "reduced target" instead of "full exemption," the calculation can change in one place without redesigning the UI model.

### 3.2 Approved temporary request

A temporary request affects scoring only when:

- `MANAGER_APPROVAL_RECEIVED` is `YES` or `APPROVED`
- the request overlaps the selected date range
- the overlap includes weekdays inside the ISO week being scored

Temporary approvals adjust only the overlapping week(s), not the whole employee row.

### 3.3 Alternate in-office date

`ALTERNATE_IN_OFFICE_WORK_DATE` remains visible in the request list and tooltips, but v1 does not use it as a scoring override.

Reason:

- actual office attendance is already measured from attendance data
- the alternate date field is informative but not reliable enough to replace measured office presence

### 3.4 PTO behavior

The current PTO concept remains valid:

- PTO can still excuse a week when there are not enough available workdays left to satisfy the adjusted target

This spec aligns scoring and compliance so PTO-excused weeks no longer lower the score.

## 4. Target Behavior

### 4.1 Employee-week outcome rules

| Week type | `*` marker | Cell color | Adjusted target | Counts in KPI denominator |
|---|---|---|---:|---|
| No approved WFH coverage | No | Existing color rules | `2` or current required value | Yes |
| Temporary approval, partial week, adjusted target met | Yes | Green | `1` or other reduced value | Yes |
| Temporary approval, partial week, adjusted target not met | Yes | Existing non-compliant color | `1` or other reduced value | Yes |
| Temporary approval makes target `0` | Yes | Green | `0` | No |
| Standing policy week | Yes | Green | `0` | No |
| PTO-excused week with no WFH coverage | No | Blue | `null` | No |
| PTO-excused week with WFH coverage | Yes | Blue if excused by PTO, otherwise green if target reaches `0` | `null` or `0` | No |
| No ActivTrak coverage | No | Gray / blank as today | `null` | No |

Important guardrail:

- `*` means "approved WFH coverage affected this week"
- green means "compliant under adjusted policy"
- partial approved weeks are not automatically green if the employee still missed the reduced target

That preserves fairness without hiding real misses.

### 4.2 Reporting principle

The report should show both:

- raw office attendance
- policy-adjusted compliance

In practice:

- the weekly cell still displays raw office days
- compliance colors and score use adjusted target
- `*` tells the viewer raw office days were interpreted with approved WFH coverage that week

Example:

- `1*` means the employee had 1 office day and approved WFH coverage affected that week
- if the adjusted target was `1`, the cell is green
- if the adjusted target was `2`, the cell is not green

## 5. Backend Design

### 5.1 Data model changes

Extend `lib/types/attendance.ts`.

### New types

```ts
export type WfhExceptionType =
  | 'none'
  | 'standing_policy'
  | 'temporary_partial'
  | 'temporary_full';
```

### `WeekCell` additions

```ts
export interface WeekCell {
  officeDays: number;
  remoteDays: number;
  ptoDays: number;
  days: DayDetail[];

  rawOfficeTarget: number;
  adjustedOfficeTarget: number | null;
  adjustedCompliant: boolean | null;
  isPtoExcused: boolean;

  hasApprovedWfhCoverage: boolean;
  wfhExceptionType: WfhExceptionType;
  approvedRemoteWeekdays: number;
  exceptionLabel: string | null;
}
```

### `AttendanceRow` additions

```ts
export interface AttendanceRow {
  ...
  hasStandingWfhPolicy: boolean;
  hasApprovedRemoteRequestInRange: boolean;
  hasAnyApprovedWfhCoverageInRange: boolean;
  exemptWeekCount: number;
}
```

Compatibility note:

- `approvedRemoteWorkRequest` is too narrow for the new behavior because it ignores the standing policy flag
- implementation should either replace it or keep it temporarily while introducing `hasAnyApprovedWfhCoverageInRange`

### 5.2 New indexing step in `getAttendanceReport(...)`

Add two indexes before row assembly:

- `standingPolicyEmails: Set<string>`
  - sourced from `empRows` joined to `TL_EMPLOYEES.REMOTE_WORKDAY_POLICY_ASSIGNED`
- `approvedRemoteDatesByEmail: Map<string, Set<string>>`
  - expand approved temporary requests into weekday date strings inside the selected range

Also add:

- `approvedRequestTypesByEmailWeek: Map<string, Set<string>>`
- `approvedRequestLabelsByEmailWeek: Map<string, string[]>`

These power the weekly tooltip and `remoteWorkStatusLabel`.

### 5.3 Weekly calculation rules

For each employee-week:

1. Start with the current required target.
2. Apply standing policy coverage first.
3. If no standing policy applies, subtract approved temporary remote weekdays from the target, floored at `0`.
4. Apply PTO excusal only after the WFH-adjusted target is known.
5. Determine whether the week contributes to score and aggregate compliance.

### Pseudocode

```ts
rawOfficeTarget = officeDaysRequired
hasStandingWfhPolicy = standingPolicyEmails.has(email)
approvedRemoteWeekdays = countApprovedWeekdays(email, week)
ptoDays = cell?.ptoDays ?? 0
availableDays = 5 - ptoDays

if (!hasActivTrakCoverage) {
  adjustedOfficeTarget = null
  adjustedCompliant = null
  isPtoExcused = false
  wfhExceptionType = 'none'
} else {
  let targetAfterWfh = rawOfficeTarget
  let wfhExceptionType: WfhExceptionType = 'none'

  if (hasStandingWfhPolicy) {
    targetAfterWfh = 0
    wfhExceptionType = 'standing_policy'
  } else if (approvedRemoteWeekdays > 0) {
    targetAfterWfh = Math.max(0, rawOfficeTarget - approvedRemoteWeekdays)
    wfhExceptionType =
      targetAfterWfh === 0 ? 'temporary_full' : 'temporary_partial'
  }

  if (targetAfterWfh === 0) {
    adjustedOfficeTarget = 0
    adjustedCompliant = true
    isPtoExcused = false
  } else if (availableDays < targetAfterWfh) {
    adjustedOfficeTarget = null
    adjustedCompliant = true
    isPtoExcused = true
  } else {
    adjustedOfficeTarget = targetAfterWfh
    adjustedCompliant = officeDays >= targetAfterWfh
    isPtoExcused = false
  }
}
```

### 5.4 Row summary rules

Keep these raw visibility metrics:

- `total`
- `avgPerWeek`

These remain based on actual office days.

Change these compliance metrics:

- `compliant`
- employee `scorePct` in the client
- aggregate weekly compliance percentages
- top summary compliance rate

These must be based on `adjustedOfficeTarget` and `adjustedCompliant`.

### Employee score rules

Weekly score capacity:

- `0` when `adjustedOfficeTarget` is `null`
- `0` when `adjustedOfficeTarget` is `0`
- otherwise `adjustedOfficeTarget`

Weekly earned points:

- `0` when capacity is `0`
- otherwise `min(officeDays, adjustedOfficeTarget)`

This makes:

- standing-policy weeks neutral to score
- fully exempt temporary weeks neutral to score
- PTO-excused weeks neutral to score
- partial approved weeks score against the reduced target

### 5.5 Aggregate view rules

Current aggregate logic is employee-level. It must become week-level.

Replace the current weekly classification with:

- `eligibleEmployees`
  - Quebec employees with ActivTrak coverage and `adjustedOfficeTarget > 0`
- `compliantEmployees`
  - eligible employees where `adjustedCompliant === true`
- `exemptEmployees`
  - Quebec employees with approved WFH coverage and `adjustedOfficeTarget === 0`
- `excusedEmployees`
  - Quebec employees with `isPtoExcused === true`
- `unknownEmployees`
  - Quebec employees without ActivTrak coverage

Update weekly aggregate tooltip/list fields accordingly:

- `fullyRemoteNames` should become `exemptNames`
- add `excusedNames` if useful in detail export and tooltip

Important:

- exempt weeks do not count as failures
- exempt weeks also do not inflate compliance denominator

## 6. UI Spec

### 6.1 Employee grid

### Weekly cell content

Employee week cells keep showing raw office days, but append `*` when approved WFH coverage affected that week.

Examples:

- `2`
- `1*`
- `0*`

### Weekly cell color

Employee cell color precedence:

1. unknown coverage -> gray
2. PTO-excused week -> blue
3. adjusted compliant -> green
4. partial / below adjusted target -> current orange or red behavior

This keeps the current blue PTO meaning and adds fair green compliance for approved WFH coverage.

### Tooltip content

Employee week tooltip should add:

- raw office days
- raw target
- adjusted target
- approved WFH coverage type
- approved remote weekdays in the week
- PTO days
- explanation text

Example tooltip copy:

- `Actual office days: 1`
- `Adjusted target: 1`
- `Approved WFH coverage: Temporary remote work request`
- `Approved remote weekdays: 1`
- `Result: Compliant under adjusted policy`

If standing policy applies:

- `Approved WFH coverage: Standing policy`
- `Adjusted target: 0`
- `Result: Exempt this week`

### 6.2 Legend

Add a small legend near the grid and detail modal:

- `* Approved WFH coverage affected this week`
- `Green = compliant under adjusted policy`
- `Blue = excused because PTO left too few available workdays`

### 6.3 Detail modal

Update `AttendanceDetailModal` so weekly compliance uses adjusted target, not raw `2-day` rule.

Changes:

- weekly summary row uses `adjustedOfficeTarget`
- compliant icon uses `adjustedCompliant`
- subtitle copy changes from "Weeks with at least 2 office days get a green check" to adjusted-policy wording
- add WFH coverage explanation to each week row

Suggested copy:

- `Weeks are scored against the adjusted office target after approved WFH coverage and PTO exceptions.`

### 6.4 Aggregate views

Department and manager views should:

- compute weekly compliance from week-level eligibility
- show exempt counts separately from compliant counts
- rename "Fully remote" to "Exempt this week"

Recommended weekly breakdown columns:

- `Eligible`
- `Compliant`
- `Exempt`
- `Excused`
- `Office Days`

Recommended tooltip/list labels:

- `Compliant`
- `Non-compliant`
- `Exempt this week`
- `PTO-excused`

### 6.5 Filters

The current employee-level control:

- `Exclude Approved Remote Work`
- `Include Approved Remote Work`

does not fit week-level exemption handling well.

Replace it with:

- `All employees` (default)
- `Only standard policy`
- `Only approved WFH coverage`

Behavior:

- `All employees`
  - show everyone, which lets managers see green exempt weeks and `*`
- `Only standard policy`
  - hide employees with any standing or temporary approved WFH coverage in the selected range
- `Only approved WFH coverage`
  - show only employees with any approved WFH coverage in the selected range

Backward-compatibility note:

- existing `approvedRemoteWork=include` URLs can map to `All employees`

### 6.6 Row badges and copy

Current `remoteWorkStatusLabel` should be updated so it can distinguish:

- `Standard Policy`
- `Standing WFH Policy`
- `Approved Temporary WFH`
- `Standing WFH Policy + Temporary Request`

Prefer "approved WFH coverage" or "standing WFH policy" over "licensed to work from home" in UI copy.

## 7. Export Spec

Exports must match the on-screen logic.

### 7.1 Employee CSV/XLSX

Weekly columns should export the displayed office-days value with `*` when applicable.

Examples:

- `2`
- `1*`
- `0*`

Add export-only metadata columns after `Remote Workday`:

- `Standing WFH Policy`
- `Approved WFH Coverage In Range`

Optional if more detail is needed:

- `Exempt Weeks`

### 7.2 Aggregate CSV/XLSX

Update weekly breakdown export columns from:

- `Eligible Quebec`
- `Compliant Count`
- `Compliant`
- `Non-compliant`
- `Fully remote`

to:

- `Eligible Quebec`
- `Compliant Count`
- `Exempt Count`
- `PTO Excused Count`
- `Compliant`
- `Non-compliant`
- `Exempt`
- `PTO Excused`

Excel fill colors must use the same adjusted logic as the table.

## 8. Non-goals For This Version

- no Oracle schema change
- no manual override table
- no new HR approval workflow
- no attempt to infer approval from raw remote attendance alone
- no use of `ALTERNATE_IN_OFFICE_WORK_DATE` as a scoring override
- no custom per-employee numeric weekly target beyond `0` or reduced-by-temporary-days logic

## 9. Implementation Slices

### Slice 1: backend data contract

- extend `WeekCell` and `AttendanceRow`
- index standing-policy emails
- expand approved request dates by email/week
- compute `adjustedOfficeTarget`, `adjustedCompliant`, `wfhExceptionType`

### Slice 2: employee UI

- update week cell rendering to append `*`
- update cell color helpers to use adjusted logic
- add legend
- update detail modal weekly compliance section

### Slice 3: aggregate UI

- move aggregate eligibility/compliance to week-level logic
- replace `fullyRemoteNames` with exempt naming
- update aggregate summaries and tooltips

### Slice 4: export parity

- update CSV/XLSX cell values
- update Excel fill colors
- add exempt/excused columns to aggregate weekly breakdown export

## 10. Acceptance Cases

Implementation is correct when all of the following are true:

1. Standard employee, no PTO, 2 office days:
   - cell shows `2`
   - cell is green
   - week counts in denominator

2. Standing-policy employee:
   - every week in range shows `*`
   - week cell is green
   - week does not count in denominator

3. Temporary request for one weekday, employee has 1 office day:
   - cell shows `1*`
   - adjusted target is `1`
   - cell is green
   - week counts in denominator

4. Temporary request for one weekday, employee has 0 office days:
   - cell shows `0*`
   - adjusted target is `1`
   - cell is not green
   - week counts in denominator

5. Temporary request covers enough weekdays to reduce target to `0`:
   - cell shows `0*` or `1*`
   - cell is green
   - week does not count in denominator

6. Employee has PTO that leaves too few available days for the adjusted target:
   - week is PTO-excused
   - cell is blue
   - week does not count in denominator or score capacity

7. Aggregate department view with mixed employees:
   - compliant percentage counts only week-level eligible employees
   - exempt employees are shown separately, not counted as failures
   - exempt employees do not inflate denominator

## 11. Recommended File Touch List

- `lib/types/attendance.ts`
- `lib/dashboard-data.ts`
- `app/dashboard/office-attendance/attendance-client.tsx`
- `lib/constants.ts`

Optional only if copy extraction becomes worthwhile:

- `lib/constants.ts` for new legend labels and colors
