import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardFooter
} from '@/components/ui/card';
import { Suspense } from 'react';
import { getProductivitySummaryData } from '@/features/hr-dashboard/actions/productivity-actions';
import { getManagerAccessContext } from '@/lib/auth/manager-access';
import {
  IconTrendingUp,
  IconClock,
  IconUsers,
  IconChartBar
} from '@tabler/icons-react';
import { HRDateRangeFilter } from '@/features/hr-dashboard/components/date-range-filter';

interface OverviewLayoutProps {
  productivity: React.ReactNode;
  team_summary: React.ReactNode;
  trends: React.ReactNode;
}

export default async function HROverviewLayout({
  productivity,
  team_summary,
  trends
}: OverviewLayoutProps) {
  const context = await getManagerAccessContext();

  // Default date range: last 7 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  const summary = await getProductivitySummaryData({ startDate, endDate });

  const greeting = context?.isHRAdmin
    ? 'HR Dashboard'
    : context?.isManager
      ? 'Team Dashboard'
      : 'My Productivity';

  return (
    <PageContainer>
      <div className='flex flex-1 flex-col space-y-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>{greeting}</h2>
            <p className='text-muted-foreground'>
              {context?.isHRAdmin
                ? 'Organization-wide productivity overview'
                : context?.isManager
                  ? 'Monitor your team productivity'
                  : 'Track your productivity metrics'}
            </p>
          </div>
          <HRDateRangeFilter />
        </div>

        {/* Summary Cards */}
        <div className='*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:grid-cols-2 lg:grid-cols-4'>
          <Card className='@container/card'>
            <CardHeader>
              <CardDescription>Team Members</CardDescription>
              <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
                {summary.totalEmployees}
              </CardTitle>
              <CardAction>
                <Badge variant='outline'>
                  <IconUsers className='size-4' />
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className='flex-col items-start gap-1.5 text-sm'>
              <div className='text-muted-foreground'>Active employees tracked</div>
            </CardFooter>
          </Card>

          <Card className='@container/card'>
            <CardHeader>
              <CardDescription>Avg Productivity Score</CardDescription>
              <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
                {summary.avgProductivityScore.toFixed(1)}%
              </CardTitle>
              <CardAction>
                <Badge variant='outline'>
                  <IconTrendingUp className='size-4' />
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className='flex-col items-start gap-1.5 text-sm'>
              <div className='text-muted-foreground'>
                Team average this period
              </div>
            </CardFooter>
          </Card>

          <Card className='@container/card'>
            <CardHeader>
              <CardDescription>Productive Hours</CardDescription>
              <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
                {summary.totalProductiveHours.toLocaleString()}
              </CardTitle>
              <CardAction>
                <Badge variant='outline'>
                  <IconClock className='size-4' />
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className='flex-col items-start gap-1.5 text-sm'>
              <div className='text-muted-foreground'>
                Total productive time tracked
              </div>
            </CardFooter>
          </Card>

          <Card className='@container/card'>
            <CardHeader>
              <CardDescription>Productive %</CardDescription>
              <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
                {summary.productivePercent.toFixed(1)}%
              </CardTitle>
              <CardAction>
                <Badge variant='outline'>
                  <IconChartBar className='size-4' />
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className='flex-col items-start gap-1.5 text-sm'>
              <div className='text-muted-foreground'>
                Of total tracked time
              </div>
            </CardFooter>
          </Card>
        </div>

        {/* Charts Grid */}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-7'>
          <div className='col-span-4'>
            <Suspense fallback={<div className='h-80 animate-pulse rounded-lg bg-muted' />}>
              {productivity}
            </Suspense>
          </div>
          <div className='col-span-4 md:col-span-3'>
            <Suspense fallback={<div className='h-80 animate-pulse rounded-lg bg-muted' />}>
              {team_summary}
            </Suspense>
          </div>
          <div className='col-span-7'>
            <Suspense fallback={<div className='h-80 animate-pulse rounded-lg bg-muted' />}>
              {trends}
            </Suspense>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
