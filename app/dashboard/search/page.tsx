import Link from 'next/link';
import { getAccessContext, getScopedReportEmails } from '@/lib/access';
import { getEmployees } from '@/lib/dashboard-data';

interface SearchParams {
  q?: string;
  startDate?: string;
  endDate?: string;
}

export default async function EmployeeSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = (params.q || '').trim().toLowerCase();

  const endDate = params.endDate || new Date().toISOString().split('T')[0] || '';
  const startDate =
    params.startDate ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] || '';

  const access = await getAccessContext();
  const scopedEmails = getScopedReportEmails(access);
  let employees = [] as Awaited<ReturnType<typeof getEmployees>>;
  let dataError: string | null = null;
  try {
    employees = await getEmployees({ activeOnly: true, emails: scopedEmails });
  } catch (error) {
    dataError =
      error instanceof Error
        ? error.message
        : 'Employee data source is currently unavailable.';
  }

  let visible = employees;

  if (q) {
    visible = visible.filter((emp) => {
      const name = (emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`).toLowerCase();
      return (
        name.includes(q) ||
        (emp.email || '').toLowerCase().includes(q) ||
        (emp.department || '').toLowerCase().includes(q)
      );
    });
  }

  const rows = visible.slice(0, 100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-gray-900">Employee Search</h2>
        <p className="mt-0.5 text-[12px] text-gray-500">
          Find an employee and open their attendance profile.
        </p>
      </div>

      {dataError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          Employee data is currently unavailable. {dataError}
        </div>
      )}

      <form className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-gray-500">Search</label>
          <input
            name="q"
            defaultValue={params.q || ''}
            placeholder="Name, email, or department"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-300 focus:outline-none"
          />
        </div>
        <input type="hidden" name="startDate" value={startDate} />
        <input type="hidden" name="endDate" value={endDate} />
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-[12px] font-medium text-white hover:bg-gray-700"
        >
          Search
        </button>
      </form>

      <div className="flex items-center justify-between text-[12px] text-gray-500">
        <span>{rows.length} result(s){visible.length > rows.length ? ' (showing first 100)' : ''}</span>
        <span>Range: {startDate} to {endDate}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Employee</th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Email</th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Department</th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((emp) => {
              const empName = emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email;
              const href = `/dashboard/employee/${encodeURIComponent(emp.email)}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
              return (
                <tr key={emp.email ?? emp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-[13px] font-medium text-gray-900">{empName}</td>
                  <td className="px-4 py-3 text-[12px] text-gray-600">{emp.email}</td>
                  <td className="px-4 py-3 text-[12px] text-gray-600">{emp.department || 'Unknown'}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={href}
                      className="rounded-md border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 hover:bg-gray-50"
                    >
                      Open Profile
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-[13px] text-gray-500">
                  No matching employees.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
