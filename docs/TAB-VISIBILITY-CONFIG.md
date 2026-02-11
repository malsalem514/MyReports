# Tab Visibility Configuration

Per-role defaults with per-email overrides for dashboard tab visibility.

## Overview

HR administrators can control which dashboard tabs each user sees. The system uses a **two-layer resolution model**:

1. **Role defaults** — each role (`hr-admin`, `manager`, `employee`) has a default set of visible tabs
2. **Email overrides** — individual users can be force-shown or force-hidden specific tabs, overriding their role defaults

## Functional Specification

### Roles & Default Visibility

| Tab | HR Admin | Manager | Employee |
|-----|----------|---------|----------|
| overview | ✅ | ✅ | ✅ |
| calendar | ✅ | ✅ | ✅ |
| pulse | ✅ | ✅ | ❌ |
| compliance | ✅ | ✅ | ❌ |
| attendance | ✅ | ✅ | ✅ |
| office-attendance | ✅ | ✅ | ❌ |
| report | ✅ | ✅ | ❌ |
| search | ✅ | ✅ | ✅ |
| executive | ✅ | ❌ | ❌ |

### Role Resolution

A user's role is derived from their `AccessContext`:

- `isHRAdmin === true` → `hr-admin`
- `isManager === true` → `manager`
- Otherwise → `employee`

### Override Behavior

- An override with `VISIBLE=1` **force-shows** a tab regardless of role default
- An override with `VISIBLE=0` **force-hides** a tab regardless of role default
- Removing an override reverts the tab to its role default
- Overrides are keyed by **lowercase email + tab key**

### Route Protection

If a user navigates directly to a hidden tab's URL (e.g., `/dashboard/executive`), they are **redirected to `/dashboard`**. This is enforced server-side in the layout.

### Admin UI (`/dashboard/admin`)

Only accessible to HR admins. Two sections:

1. **Role Defaults** — grid of roles × tabs with toggle switches. Changes take effect on next page load for affected users.
2. **User Overrides** — search by email, view/add/toggle/remove per-tab overrides.

## Technical Specification

### Database Schema (Oracle)

#### TL_TAB_ROLES

Role-based tab defaults. Seeded on schema init.

```sql
CREATE TABLE TL_TAB_ROLES (
  ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ROLE_NAME VARCHAR2(50) NOT NULL,    -- 'hr-admin', 'manager', 'employee'
  TAB_KEY VARCHAR2(50) NOT NULL,      -- matches TAB_KEYS constant
  VISIBLE NUMBER(1) DEFAULT 1,       -- 1=show, 0=hide
  CONSTRAINT TL_TAB_ROLES_UQ UNIQUE (ROLE_NAME, TAB_KEY)
);
```

#### TL_TAB_OVERRIDES

Per-email overrides. Empty by default — populated via admin UI.

```sql
CREATE TABLE TL_TAB_OVERRIDES (
  ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  EMAIL VARCHAR2(255) NOT NULL,       -- lowercase
  TAB_KEY VARCHAR2(50) NOT NULL,
  VISIBLE NUMBER(1) DEFAULT 1,       -- 1=force show, 0=force hide
  CONSTRAINT TL_TAB_OVERRIDES_UQ UNIQUE (EMAIL, TAB_KEY)
);
```

### Seed Data

Inserted via `MERGE INTO ... WHEN NOT MATCHED` in `initializeSchema()` — idempotent, won't overwrite admin changes on restart.

### Architecture

```
┌─────────────────────────────────────────────────┐
│ layout.tsx (server component)                   │
│  ├─ getAccessContext() → role                   │
│  ├─ getVisibleTabs(email, access)               │
│  │   ├─ query TL_TAB_ROLES for role defaults    │
│  │   ├─ query TL_TAB_OVERRIDES for email        │
│  │   └─ merge: overrides win                    │
│  ├─ filter NAV_ITEMS to visible only            │
│  ├─ route protection (redirect if hidden)       │
│  └─ render DashboardNav (client component)      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ /dashboard/admin (HR-admin only)                │
│  ├─ page.tsx: server gate + load roleMap        │
│  └─ admin-client.tsx: toggles + email search    │
│      └─ POST /api/admin/tabs                    │
│          ├─ set-role → MERGE TL_TAB_ROLES       │
│          ├─ set-override → MERGE TL_TAB_OVERRIDES│
│          └─ remove-override → DELETE             │
└─────────────────────────────────────────────────┘
```

### File Inventory

| File | Type | Purpose |
|------|------|---------|
| `lib/tab-config.ts` | Service | Tab visibility queries & mutations |
| `lib/oracle.ts` | Modified | Schema + seed for 2 new tables |
| `app/dashboard/layout.tsx` | Server component | Fetches visible tabs, filters nav, protects routes |
| `app/dashboard/dashboard-nav.tsx` | Client component | Navigation bar, date pickers (extracted from old layout) |
| `app/dashboard/admin/page.tsx` | Server page | HR-admin gate, loads role defaults |
| `app/dashboard/admin/admin-client.tsx` | Client component | Toggle grids for roles & overrides |
| `app/api/admin/tabs/route.ts` | API route | GET overrides, POST mutations |

### API Reference

#### `GET /api/admin/tabs?email=user@example.com`

Returns existing overrides for an email.

```json
{ "overrides": { "executive": true, "pulse": false } }
```

#### `POST /api/admin/tabs`

Mutation endpoint. Body:

```json
// Set role default
{ "action": "set-role", "role": "manager", "tabKey": "executive", "visible": true }

// Set email override
{ "action": "set-override", "email": "user@example.com", "tabKey": "pulse", "visible": false }

// Remove email override (revert to role default)
{ "action": "remove-override", "email": "user@example.com", "tabKey": "pulse" }
```

All endpoints require HR admin session.

### Key Design Decisions

1. **Server-side layout** — Tab filtering happens in the server component, not client-side. Users never see HTML for tabs they shouldn't access.
2. **MERGE upserts** — Oracle MERGE is atomic and idempotent. No race conditions between concurrent admin changes.
3. **Seed via WHEN NOT MATCHED** — Schema init seeds defaults but never overwrites existing config. Safe to re-run.
4. **Admin tab is hardcoded** — The "Admin" nav link is not stored in `TL_TAB_ROLES`. It's always visible for HR admins and hidden for everyone else. This prevents accidental lockout.
