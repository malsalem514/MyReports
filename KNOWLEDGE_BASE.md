# HR Dashboard - Knowledge Base

## Project Overview

This is an HR productivity dashboard built on Next.js 16 (App Router) that displays ActivTrak productivity data from BigQuery. The dashboard has been simplified to show only a single "Daily Summary" report.

**GitHub Repository:** https://github.com/malsalem514/MyReports.git

---

## Current State

### What's Implemented
- Simplified navigation showing only "HR Reports > Daily Summary"
- Daily Summary table displaying ActivTrak productivity data from BigQuery
- BigQuery client for fetching productivity data
- BambooHR client for employee data
- Oracle database connection pool (available but not currently used)
- Clerk authentication has been **bypassed** (user doesn't use Clerk)
- **Manager-based access control** - Users can only see their own data + their direct/indirect reports
- **Email input for testing** - Manual email entry to test different user access levels
- **HR Admin support** - Designated HR admins can see all employees

### What's NOT Implemented (from original plan)
- Microsoft Entra ID SSO integration (currently using manual email input for testing)
- Data sync system (BambooHR -> Oracle, BigQuery -> Oracle)
- Employee detail pages
- Charts and trend analysis

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.4 | React framework with App Router |
| React | 19.2.0 | UI library |
| TypeScript | 5.7.2 | Type safety |
| Tailwind CSS | 4.0.0 | Styling |
| Shadcn UI | - | Component library |
| BigQuery | 8.1.1 | ActivTrak data source |
| oracledb | 6.10.0 | Oracle database client |
| Zod | 4.1.8 | Schema validation |
| Recharts | 2.15.1 | Charts (not currently used) |

---

## Credentials & Configuration

### BigQuery (ActivTrak)
```
Project ID: us-activtrak-ac-prod
Dataset: 672561
Table: daily_user_summary
Location: US
```

**Authentication:** Requires Google Cloud service account credentials file.
- Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the JSON key file path

### BambooHR
```
Subdomain: jestais
API Key: 597304a7ac08d727fe883570b8fc725f57b49660
Base URL: https://api.bamboohr.com/api/gateway.php/jestais/v1
```

### Oracle Database
```
User: timelogs
Password: timelogs
Connection String: srv-db-100:1521/SUPPOPS
```

### Environment Variables (create .env.local)
```env
# BigQuery / ActivTrak
BIGQUERY_PROJECT_ID=us-activtrak-ac-prod
BIGQUERY_DATASET=672561
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# BambooHR
BAMBOOHR_API_KEY=597304a7ac08d727fe883570b8fc725f57b49660
BAMBOOHR_SUBDOMAIN=jestais

# Oracle Database
ORACLE_USER=timelogs
ORACLE_PASSWORD=timelogs
ORACLE_CONNECTION_STRING=srv-db-100:1521/SUPPOPS
```

---

## Project Structure

```
C:\musa\HR_Dashboard\
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Redirects to /dashboard/hr/daily-summary
│   │   ├── layout.tsx                        # Root layout
│   │   └── dashboard/
│   │       ├── page.tsx                      # Redirects to /dashboard/hr/daily-summary
│   │       ├── layout.tsx                    # Dashboard layout with sidebar
│   │       └── hr/
│   │           ├── page.tsx                  # Redirects to daily-summary
│   │           └── daily-summary/
│   │               └── page.tsx              # Daily Summary page (MAIN PAGE)
│   ├── config/
│   │   └── nav-config.ts                     # Navigation config (HR Reports only)
│   ├── features/
│   │   └── hr-dashboard/
│   │       ├── actions/
│   │       │   ├── daily-summary-actions.ts  # Server action for fetching data
│   │       │   └── productivity-actions.ts   # Additional productivity actions
│   │       └── components/
│   │           └── daily-summary-table.tsx   # Main table component
│   ├── lib/
│   │   ├── api/
│   │   │   ├── bigquery/
│   │   │   │   └── client.ts                 # BigQuery client (ActivTrak)
│   │   │   └── bamboohr/
│   │   │       └── client.ts                 # BambooHR client
│   │   ├── auth/
│   │   │   └── manager-access.ts             # Manager access control (BambooHR-based)
│   │   └── db/
│   │       └── oracle.ts                     # Oracle connection pool
│   ├── components/
│   │   ├── ui/                               # Shadcn UI components
│   │   ├── layout/
│   │   │   ├── app-sidebar.tsx               # Sidebar (Clerk bypassed)
│   │   │   ├── user-nav.tsx                  # User nav (Clerk bypassed)
│   │   │   └── org-switcher.tsx              # Org switcher (Clerk bypassed)
│   │   └── icons.tsx                         # Icon definitions
│   └── hooks/
│       └── use-nav.ts                        # Navigation hook (RBAC bypassed)
└── package.json
```

---

## Key Files Detail

### 1. Navigation Config (`src/config/nav-config.ts`)
Simplified to show only HR Reports:
```typescript
export const navItems: NavItem[] = [
  {
    title: 'HR Reports',
    url: '/dashboard/hr',
    icon: 'users',
    isActive: true,
    items: [
      {
        title: 'Daily Summary',
        url: '/dashboard/hr/daily-summary',
        icon: 'dashboard'
      }
    ]
  }
];
```

### 2. Daily Summary Page (`src/app/dashboard/hr/daily-summary/page.tsx`)
Main entry point for the dashboard.

### 3. Daily Summary Table (`src/features/hr-dashboard/components/daily-summary-table.tsx`)
Client component that:
- Calls `getDailySummaryData()` server action
- Displays data in a table with columns: Date, User, Productive/Unproductive/Neutral/Total hours, Productivity %
- Has search filter and refresh button
- Color-coded hours (green=productive, red=unproductive, gray=neutral)

### 4. Server Action (`src/features/hr-dashboard/actions/daily-summary-actions.ts`)
```typescript
export async function getDailySummaryData(filterEmail?: string): Promise<DailySummaryResult>
```
- Accepts optional email parameter for access filtering
- Fetches last 30 days of data from BigQuery
- Filters by allowed emails based on BambooHR hierarchy
- Transforms seconds to hours
- Calculates productivity percentage
- Returns data + access context info

### 5. BigQuery Client (`src/lib/api/bigquery/client.ts`)
Key functions:
- `fetchProductivityData(startDate, endDate, emails?)` - Main data fetch
- `fetchProductivityByUsernames(usernames, startDate, endDate)` - Filter by users
- `fetchProductivityStats(startDate, endDate, emails?)` - Aggregated stats
- `fetchProductivityTrend(startDate, endDate, emails?)` - Daily trends
- `fetchDistinctEmails(startDate, endDate)` - Get all user emails
- `healthCheck()` - Verify connection

**BigQuery Table Schema (daily_user_summary):**
| Field | Type | Description |
|-------|------|-------------|
| local_date | DATE | Activity date |
| user_name | STRING | User email (not name) |
| user_id | INT | User ID |
| productive_active_duration_seconds | INT | Active productive time |
| productive_passive_duration_seconds | INT | Passive productive time |
| unproductive_active_duration_seconds | INT | Active unproductive time |
| unproductive_passive_duration_seconds | INT | Passive unproductive time |
| undefined_active_duration_seconds | INT | Active neutral time |
| undefined_passive_duration_seconds | INT | Passive neutral time |
| total_duration_seconds | INT | Total tracked time |
| active_duration_seconds | INT | Active time |
| focused_duration_seconds | INT | Focus time |
| collaboration_duration_seconds | INT | Collaboration time |
| break_duration_seconds | INT | Break/idle time |

### 6. BambooHR Client (`src/lib/api/bamboohr/client.ts`)
Key functions:
- `fetchEmployeeDirectory()` - Get all employees
- `fetchEmployee(employeeId)` - Get single employee
- `fetchActiveEmployees()` - Get non-inactive employees
- `fetchEmployeesByDepartment(department)` - Filter by dept
- `buildSupervisorMap()` - Build manager hierarchy
- `fetchReportingStructure(managerId)` - Get manager's reports
- `healthCheck()` - Verify connection

### 7. Oracle Client (`src/lib/db/oracle.ts`)
Key functions:
- `initializePool()` - Initialize connection pool
- `getConnection()` - Get connection from pool
- `query<T>(sql, binds)` - Execute query, return rows
- `queryOne<T>(sql, binds)` - Execute query, return single row
- `execute(sql, binds)` - Execute INSERT/UPDATE/DELETE
- `executeTransaction(callback)` - Transaction wrapper
- `healthCheck()` - Verify connection

---

## Manager Access Control

### How It Works
The system uses BambooHR's supervisor relationships to determine data access:

1. **HR Admins** - See all employees' data
2. **Managers** - See own data + direct reports + indirect reports (recursive)
3. **Employees** - See only their own data
4. **Unknown Users** - If email not in BambooHR, see only their own data

### Key File: `src/lib/auth/manager-access.ts`
```typescript
export async function getAccessContextByEmail(userEmail: string): Promise<EmailBasedAccessContext>
```

Returns:
```typescript
interface EmailBasedAccessContext {
  userEmail: string;
  employeeId: string | null;
  employeeName: string | null;
  isHRAdmin: boolean;
  isManager: boolean;
  allowedEmails: string[];      // List of emails user can view
  directReportCount: number;
  totalReportCount: number;
}
```

### HR Admin Configuration
HR admin emails are defined in `src/lib/auth/manager-access.ts`:
```typescript
const HR_ADMIN_EMAILS = [
  'admin@company.com',
  'hr@jestais.com',
  // Add more HR admin emails here
];
```

### UI Features
The Daily Summary page now includes:
- **Email input field** - Enter any email to test access
- **Access context display** - Shows user role (HR Admin/Manager/Employee)
- **Report counts** - Shows direct and indirect report counts
- **Automatic filtering** - Data table only shows allowed records

### Testing Access Control
1. Enter an HR admin email (e.g., `hr@jestais.com`) - Should see all employees
2. Enter a manager's email - Should see own data + reports
3. Enter a regular employee's email - Should see only own data
4. Enter an unknown email - Should see only that email's data (if exists in ActivTrak)

---

## Clerk Authentication Bypass

The original template used Clerk for authentication. Since user doesn't have Clerk:

**Files modified to bypass Clerk:**
1. `src/components/layout/app-sidebar.tsx` - Mock user data instead of Clerk
2. `src/components/layout/user-nav.tsx` - Mock user data instead of Clerk
3. `src/components/layout/org-switcher.tsx` - Static company header instead of Clerk OrganizationList
4. `src/hooks/use-nav.ts` - Returns all nav items without RBAC filtering
5. `src/app/providers.tsx` - Removed ClerkProvider wrapper
6. `src/middleware.ts` (proxy.ts) - Bypasses Clerk route protection

**Mock User Data:**
```typescript
const mockUser = {
  firstName: 'Admin',
  lastName: 'User',
  emailAddresses: [{ emailAddress: 'admin@company.com' }],
  imageUrl: ''
};
```

---

## Running the Project

```bash
# Install dependencies
bun install

# Run development server
bun dev

# Access at:
http://localhost:3000  (or 3001/3002/etc if port in use)

# The app redirects to:
http://localhost:3000/dashboard/hr/daily-summary
```

---

## Future Enhancements (from original plan)

### Phase 1: Microsoft Entra ID SSO
- Configure Enterprise Application in Azure Portal
- Set up SAML SSO
- Replace mock user with authenticated user

### Phase 2: Data Sync System
- Sync BambooHR employees to Oracle daily
- Sync BigQuery productivity data to Oracle every 2 hours
- Link by email address

### Phase 3: Manager Access Control
- Implement `getManagerAccessContext()` function
- HR Admins see all employees
- Managers see direct + transitive reports
- Employees see only their own data

### Phase 4: Additional Features
- Team overview page with charts
- Employee detail pages
- Date range filters
- Department filters
- Trend analysis charts

---

## Known Issues & Notes

1. **Port Conflicts:** Dev server may use different port if 3000 is busy (check console output)

2. **BigQuery Authentication:** Must have valid Google Cloud service account credentials

3. **Clerk Dependencies:** @clerk/nextjs is still in package.json but bypassed in code. Could be removed if not planning to use authentication.

4. **Server Actions:** All data fetching uses Next.js Server Actions (files with 'use server' directive)

5. **Time Conversion:** BigQuery stores time in seconds, displayed as hours in table

---

## Git History

```
9b322ae Simplify dashboard to show only HR Daily Summary report
e6186d9 HR Dashboard with BigQuery/BambooHR integration
```

---

## Commands Reference

```bash
# Development
bun dev              # Start dev server
bun build            # Build for production
bun start            # Start production server
bun lint             # Run ESLint
bun format           # Format with Prettier

# Git
git status           # Check changes
git add .            # Stage all
git commit -m "msg"  # Commit
git push origin main # Push to GitHub
```
