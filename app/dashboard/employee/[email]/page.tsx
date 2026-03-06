import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccessContext, canAccessEmployee } from '@/lib/access';
import {
  getEmployeeByEmail,
  getAttendance,
  getTimeOff,
} from '@/lib/dashboard-data';

interface Params {
  email: string;
}

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ startDate?: string; endDate?: string; returnTo?: string }>;
}) {
  const { email: rawEmail } = await params;
  const sp = await searchParams;
  const email = decodeURIComponent(rawEmail);

  const access = await getAccessContext();
  if (!canAccessEmployee(access, email)) notFound();

  const endDate = sp.endDate ? new Date(sp.endDate) : new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = sp.startDate ? new Date(sp.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);
  const fallbackReturnTo = `/dashboard/search?startDate=${startDate.toISOString().split('T')[0] ?? ''}&endDate=${endDate.toISOString().split('T')[0] ?? ''}`;
  const returnTo = sp.returnTo && sp.returnTo.startsWith('/dashboard/')
    ? sp.returnTo
    : fallbackReturnTo;

  let employee = null as Awaited<ReturnType<typeof getEmployeeByEmail>>;
  let attendance = [] as Awaited<ReturnType<typeof getAttendance>>;
  let timeOff = [] as Awaited<ReturnType<typeof getTimeOff>>;
  let dataError: string | null = null;

  try {
    [employee, attendance, timeOff] = await Promise.all([
      getEmployeeByEmail(email),
      getAttendance(startDate, endDate, [email]),
      getTimeOff(startDate, endDate, [email]),
    ]);
  } catch (error) {
    dataError =
      error instanceof Error ? error.message : 'Employee data source unavailable';
  }

  if (!employee && !dataError) notFound();
  if (!employee && dataError) {
    employee = {
      id: '',
      email,
      displayName: email,
      firstName: null,
      lastName: null,
      jobTitle: null,
      department: null,
      division: null,
      location: null,
      supervisorId: null,
      supervisorEmail: null,
      hireDate: null,
      status: null,
      remoteWorkdayPolicyAssigned: false,
    };
  }
  const resolvedEmployee = employee!;

  let officeDays = 0, remoteDays = 0, totalHours = 0;
  for (const r of attendance) {
    if (r.location === 'Office') officeDays++;
    else if (r.location === 'Remote') remoteDays++;
    totalHours += r.totalHours;
  }
  const avgHours = attendance.length > 0 ? totalHours / attendance.length : 0;

  // Weekly compliance
  const weeklyMap = new Map<string, number>();
  for (const record of attendance) {
    if (record.location !== 'Office') continue;
    const d = record.date instanceof Date ? record.date : new Date(record.date);
    const day = d.getDay();
    const ws = new Date(d);
    ws.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    const weekKey = ws.toISOString().split('T')[0] ?? '';
    weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + 1);
  }

  const compliantWeeks = Array.from(weeklyMap.values()).filter((d) => d >= 2).length;
  const totalWeeks = weeklyMap.size || 1;
  const complianceRate = Math.round((compliantWeeks / totalWeeks) * 100);

  return (
    <div className="space-y-8">
      {dataError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Some employee data is currently unavailable. {dataError}
        </div>
      )}
      {/* Back */}
      <Link href={returnTo} className="text-[12px] text-gray-500 hover:text-gray-900">
        ← Back to report
      </Link>

      {/* Profile */}
      <div className="flex items-start gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-[24px] font-medium text-gray-600">
          {(resolvedEmployee.displayName || resolvedEmployee.email).charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 className="text-[18px] font-semibold text-gray-900">{resolvedEmployee.displayName || `${resolvedEmployee.firstName} ${resolvedEmployee.lastName}`}</h2>
          <p className="text-[13px] text-gray-600">{resolvedEmployee.jobTitle || 'No title'}</p>
          <p className="text-[12px] text-gray-500">{resolvedEmployee.department} · {resolvedEmployee.location}</p>
          <p className="text-[12px] text-gray-400">{resolvedEmployee.email}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-[12px] font-medium text-gray-500">Compliance</p>
          <p className={`mt-1 text-[28px] font-semibold tracking-tight ${complianceRate >= 100 ? 'text-green-600' : complianceRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {complianceRate}%
          </p>
          <p className="text-[11px] text-gray-400">{compliantWeeks}/{totalWeeks} weeks</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-[12px] font-medium text-gray-500">Office Days</p>
          <p className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">{officeDays}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-[12px] font-medium text-gray-500">Remote Days</p>
          <p className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">{remoteDays}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-[12px] font-medium text-gray-500">Total Hours</p>
          <p className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">{totalHours.toFixed(1)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-[12px] font-medium text-gray-500">Avg Hours/Day</p>
          <p className="mt-1 text-[28px] font-semibold tracking-tight text-gray-900">{avgHours.toFixed(1)}</p>
        </div>
      </div>

      {/* PTO */}
      {timeOff.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-6 py-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Time Off</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {timeOff.map((pto, i) => (
              <div key={i} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-[13px] font-medium text-gray-900">{pto.type}</p>
                  <p className="text-[11px] text-gray-500">{pto.startDate} — {pto.endDate}</p>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">{pto.amount} {pto.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attendance Log */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">
            Attendance Log ({attendance.length} days)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Date</th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Location</th>
                <th className="px-6 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500">Hours</th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">PTO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {attendance.slice(0, 60).map((rec, i) => {
                const d = rec.date instanceof Date ? rec.date : new Date(rec.date);
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-6 py-2.5 text-[13px] text-gray-900">
                      {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-6 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        rec.location === 'Office' ? 'bg-green-50 text-green-600' :
                        rec.location === 'Remote' ? 'bg-gray-100 text-gray-600' :
                        'bg-gray-50 text-gray-400'
                      }`}>{rec.location}</span>
                    </td>
                    <td className="px-6 py-2.5 text-right text-[13px] text-gray-600">{rec.totalHours.toFixed(1)}h</td>
                    <td className="px-6 py-2.5 text-[12px] text-amber-600">{rec.isPTO ? rec.ptoType || 'PTO' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
