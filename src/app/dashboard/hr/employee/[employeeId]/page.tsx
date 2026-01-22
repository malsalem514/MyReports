import PageContainer from '@/components/layout/page-container';
import { notFound, redirect } from 'next/navigation';
import { getEmployeeProductivityData } from '@/features/hr-dashboard/actions/productivity-actions';
import { canAccessEmployeeData } from '@/lib/auth/manager-access';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconArrowLeft, IconMail, IconBriefcase } from '@tabler/icons-react';
import Link from 'next/link';
import { EmployeeProductivityChart } from '@/features/hr-dashboard/components/employee-productivity-chart';

interface EmployeeDetailPageProps {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function EmployeeDetailPage({
  params,
  searchParams
}: EmployeeDetailPageProps) {
  const { employeeId: employeeIdParam } = await params;
  const queryParams = await searchParams;

  const employeeId = parseInt(employeeIdParam, 10);

  if (isNaN(employeeId)) {
    notFound();
  }

  // Check access
  const hasAccess = await canAccessEmployeeData(employeeId);
  if (!hasAccess) {
    redirect('/dashboard/hr');
  }

  // Parse date params
  const endDate = queryParams.endDate
    ? new Date(queryParams.endDate as string)
    : new Date();
  const startDate = queryParams.startDate
    ? new Date(queryParams.startDate as string)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get employee data
  const data = await getEmployeeProductivityData({
    employeeId,
    startDate,
    endDate
  });

  if (!data || !data.employee) {
    notFound();
  }

  const { employee, summary } = data;

  return (
    <PageContainer>
      <div className='flex flex-1 flex-col space-y-6'>
        {/* Header */}
        <div className='flex items-start justify-between'>
          <div className='flex items-start gap-4'>
            <Button variant='ghost' size='icon' asChild>
              <Link href='/dashboard/hr/team'>
                <IconArrowLeft className='size-5' />
              </Link>
            </Button>
            <div>
              <h2 className='text-2xl font-bold tracking-tight'>
                {employee.DISPLAY_NAME}
              </h2>
              <div className='mt-1 flex items-center gap-4 text-muted-foreground'>
                {employee.JOB_TITLE && (
                  <span className='flex items-center gap-1'>
                    <IconBriefcase className='size-4' />
                    {employee.JOB_TITLE}
                  </span>
                )}
                <span className='flex items-center gap-1'>
                  <IconMail className='size-4' />
                  {employee.EMAIL}
                </span>
              </div>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            {employee.DEPARTMENT && (
              <Badge variant='outline'>{employee.DEPARTMENT}</Badge>
            )}
            {employee.IS_ACTIVE ? (
              <Badge variant='default'>Active</Badge>
            ) : (
              <Badge variant='secondary'>Inactive</Badge>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>Avg Productivity Score</CardDescription>
              <CardTitle className='text-2xl'>
                {summary.avgProductivityScore?.toFixed(1) ?? 'N/A'}%
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>Productive Hours</CardDescription>
              <CardTitle className='text-2xl'>
                {summary.totalProductiveHours.toFixed(1)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>Total Hours Tracked</CardDescription>
              <CardTitle className='text-2xl'>
                {summary.totalHours.toFixed(1)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className='pb-2'>
              <CardDescription>Days Tracked</CardDescription>
              <CardTitle className='text-2xl'>{summary.daysTracked}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Productivity Over Time</CardTitle>
            <CardDescription>
              Daily productivity metrics for the selected period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmployeeProductivityChart
              employeeId={employeeId}
              startDate={startDate}
              endDate={endDate}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
