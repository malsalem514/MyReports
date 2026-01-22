'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { getTeamProductivityData } from '../actions/productivity-actions';

const chartConfig = {
  avgProductivityScore: {
    label: 'Productivity Score',
    color: 'var(--primary)'
  },
  totalProductiveHours: {
    label: 'Productive Hours',
    color: 'var(--chart-2)'
  }
} satisfies ChartConfig;

interface ProductivityChartProps {
  startDate?: Date;
  endDate?: Date;
}

export function ProductivityChart({
  startDate,
  endDate
}: ProductivityChartProps) {
  const [data, setData] = React.useState<
    {
      displayName: string;
      avgProductivityScore: number | null;
      totalProductiveHours: number;
    }[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [activeChart, setActiveChart] =
    React.useState<keyof typeof chartConfig>('avgProductivityScore');

  React.useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const end = endDate || new Date();
        const start =
          startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const result = await getTeamProductivityData({
          startDate: start,
          endDate: end,
          pageSize: 10,
          sortBy: 'avgProductivityScore',
          sortOrder: 'desc'
        });

        setData(
          result.data.map((d) => ({
            displayName: d.displayName,
            avgProductivityScore: d.avgProductivityScore,
            totalProductiveHours: d.totalProductiveHours
          }))
        );
      } catch (error) {
        console.error('Failed to load productivity data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [startDate, endDate]);

  const totals = React.useMemo(() => {
    return {
      avgProductivityScore:
        data.length > 0
          ? Math.round(
              (data.reduce(
                (sum, d) => sum + (d.avgProductivityScore || 0),
                0
              ) /
                data.length) *
                10
            ) / 10
          : 0,
      totalProductiveHours: Math.round(
        data.reduce((sum, d) => sum + d.totalProductiveHours, 0) * 10
      ) / 10
    };
  }, [data]);

  if (isLoading) {
    return (
      <Card className='@container/card !pt-3'>
        <CardHeader>
          <CardTitle>Team Productivity</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='h-[250px] animate-pulse rounded bg-muted' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className='@container/card !pt-3'>
      <CardHeader className='flex flex-col items-stretch space-y-0 border-b !p-0 sm:flex-row'>
        <div className='flex flex-1 flex-col justify-center gap-1 px-6 !py-0'>
          <CardTitle>Team Productivity</CardTitle>
          <CardDescription>
            <span className='hidden @[540px]/card:block'>
              Top performers for selected period
            </span>
            <span className='@[540px]/card:hidden'>Top performers</span>
          </CardDescription>
        </div>
        <div className='flex'>
          {(['avgProductivityScore', 'totalProductiveHours'] as const).map(
            (key) => (
              <button
                key={key}
                data-active={activeChart === key}
                className='data-[active=true]:bg-primary/5 hover:bg-primary/5 relative flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left transition-colors duration-200 even:border-l sm:border-t-0 sm:border-l sm:px-8 sm:py-6'
                onClick={() => setActiveChart(key)}
              >
                <span className='text-muted-foreground text-xs'>
                  {chartConfig[key].label}
                </span>
                <span className='text-lg font-bold leading-none sm:text-3xl'>
                  {key === 'avgProductivityScore'
                    ? `${totals[key]}%`
                    : totals[key].toLocaleString()}
                </span>
              </button>
            )
          )}
        </div>
      </CardHeader>
      <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto h-[250px] w-full'
        >
          <BarChart
            data={data}
            layout='vertical'
            margin={{ left: 12, right: 12 }}
          >
            <defs>
              <linearGradient id='fillProductivity' x1='0' y1='0' x2='1' y2='0'>
                <stop
                  offset='0%'
                  stopColor='var(--primary)'
                  stopOpacity={0.8}
                />
                <stop
                  offset='100%'
                  stopColor='var(--primary)'
                  stopOpacity={0.4}
                />
              </linearGradient>
            </defs>
            <CartesianGrid horizontal={false} />
            <YAxis
              dataKey='displayName'
              type='category'
              tickLine={false}
              axisLine={false}
              width={120}
              tickFormatter={(value) =>
                value.length > 15 ? `${value.slice(0, 15)}...` : value
              }
            />
            <XAxis
              type='number'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              cursor={{ fill: 'var(--primary)', opacity: 0.1 }}
              content={
                <ChartTooltipContent
                  className='w-[180px]'
                  formatter={(value, name) => {
                    if (name === 'avgProductivityScore') {
                      return [`${value}%`, 'Productivity Score'];
                    }
                    return [`${value} hrs`, 'Productive Hours'];
                  }}
                />
              }
            />
            <Bar
              dataKey={activeChart}
              fill='url(#fillProductivity)'
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
