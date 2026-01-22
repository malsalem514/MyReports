'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis
} from 'recharts';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getEmployeeProductivityData } from '../actions/productivity-actions';

const chartConfig = {
  productivityScore: {
    label: 'Productivity Score',
    color: 'var(--primary)'
  },
  productiveHours: {
    label: 'Productive Hours',
    color: 'var(--chart-2)'
  },
  totalHours: {
    label: 'Total Hours',
    color: 'var(--chart-3)'
  }
} satisfies ChartConfig;

interface EmployeeProductivityChartProps {
  employeeId: number;
  startDate: Date;
  endDate: Date;
}

interface ChartData {
  date: string;
  productivityScore: number | null;
  productiveHours: number;
  totalHours: number;
}

export function EmployeeProductivityChart({
  employeeId,
  startDate,
  endDate
}: EmployeeProductivityChartProps) {
  const [data, setData] = React.useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const result = await getEmployeeProductivityData({
          employeeId,
          startDate,
          endDate
        });

        if (result) {
          const chartData = result.productivity.map((p) => ({
            date: new Date(p.ACTIVITY_DATE).toISOString().split('T')[0],
            productivityScore: p.PRODUCTIVITY_SCORE,
            productiveHours: p.PRODUCTIVE_HOURS,
            totalHours: p.TOTAL_HOURS
          }));

          // Sort by date ascending
          chartData.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
          );

          setData(chartData);
        }
      } catch (error) {
        console.error('Failed to load employee productivity:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [employeeId, startDate, endDate]);

  if (isLoading) {
    return <div className='h-[300px] animate-pulse rounded bg-muted' />;
  }

  if (data.length === 0) {
    return (
      <div className='flex h-[300px] items-center justify-center text-muted-foreground'>
        No productivity data available for this period
      </div>
    );
  }

  return (
    <Tabs defaultValue='score' className='w-full'>
      <TabsList className='mb-4'>
        <TabsTrigger value='score'>Productivity Score</TabsTrigger>
        <TabsTrigger value='hours'>Hours Breakdown</TabsTrigger>
      </TabsList>

      <TabsContent value='score'>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto h-[300px] w-full'
        >
          <AreaChart
            data={data}
            margin={{ left: 12, right: 12, top: 12, bottom: 12 }}
          >
            <defs>
              <linearGradient id='fillEmployeeScore' x1='0' y1='0' x2='0' y2='1'>
                <stop
                  offset='0%'
                  stopColor='var(--primary)'
                  stopOpacity={0.4}
                />
                <stop
                  offset='100%'
                  stopColor='var(--primary)'
                  stopOpacity={0.05}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray='3 3' />
            <XAxis
              dataKey='date'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric'
                });
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className='w-[180px]'
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric'
                    });
                  }}
                  formatter={(value) => [`${value}%`, 'Productivity Score']}
                />
              }
            />
            <Area
              type='monotone'
              dataKey='productivityScore'
              stroke='var(--primary)'
              fill='url(#fillEmployeeScore)'
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </TabsContent>

      <TabsContent value='hours'>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto h-[300px] w-full'
        >
          <BarChart
            data={data}
            margin={{ left: 12, right: 12, top: 12, bottom: 12 }}
          >
            <CartesianGrid vertical={false} strokeDasharray='3 3' />
            <XAxis
              dataKey='date'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric'
                });
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => `${value}h`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className='w-[180px]'
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric'
                    });
                  }}
                  formatter={(value, name) => {
                    if (name === 'productiveHours') {
                      return [`${value}h`, 'Productive'];
                    }
                    return [`${value}h`, 'Total'];
                  }}
                />
              }
            />
            <Bar
              dataKey='totalHours'
              fill='var(--chart-3)'
              radius={[4, 4, 0, 0]}
              opacity={0.5}
            />
            <Bar
              dataKey='productiveHours'
              fill='var(--primary)'
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </TabsContent>
    </Tabs>
  );
}
