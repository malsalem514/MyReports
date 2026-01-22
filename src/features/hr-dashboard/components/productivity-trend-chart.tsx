'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
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
import { getProductivityTrendData } from '../actions/productivity-actions';

const chartConfig = {
  avgProductivityScore: {
    label: 'Avg Score',
    color: 'var(--primary)'
  },
  totalProductiveHours: {
    label: 'Productive Hours',
    color: 'var(--chart-2)'
  }
} satisfies ChartConfig;

interface ProductivityTrendChartProps {
  startDate?: Date;
  endDate?: Date;
}

export function ProductivityTrendChart({
  startDate,
  endDate
}: ProductivityTrendChartProps) {
  const [data, setData] = React.useState<
    {
      date: string;
      avgProductivityScore: number;
      totalProductiveHours: number;
      employeeCount: number;
    }[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const end = endDate || new Date();
        const start =
          startDate || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        const result = await getProductivityTrendData({
          startDate: start,
          endDate: end
        });

        setData(result);
      } catch (error) {
        console.error('Failed to load trend data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [startDate, endDate]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Productivity Trend</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='h-[250px] animate-pulse rounded bg-muted' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Productivity Trend</CardTitle>
        <CardDescription>
          Daily productivity score and hours over time
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto h-[250px] w-full'
        >
          <AreaChart
            data={data}
            margin={{ left: 12, right: 12, top: 12, bottom: 12 }}
          >
            <defs>
              <linearGradient id='fillScore' x1='0' y1='0' x2='0' y2='1'>
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
              <linearGradient id='fillHours' x1='0' y1='0' x2='0' y2='1'>
                <stop
                  offset='0%'
                  stopColor='var(--chart-2)'
                  stopOpacity={0.4}
                />
                <stop
                  offset='100%'
                  stopColor='var(--chart-2)'
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
              yAxisId='score'
              orientation='left'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
            <YAxis
              yAxisId='hours'
              orientation='right'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => `${value}h`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className='w-[200px]'
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric'
                    });
                  }}
                  formatter={(value, name) => {
                    if (name === 'avgProductivityScore') {
                      return [`${value}%`, 'Avg Score'];
                    }
                    return [`${value} hrs`, 'Productive Hours'];
                  }}
                />
              }
            />
            <Area
              yAxisId='score'
              type='monotone'
              dataKey='avgProductivityScore'
              stroke='var(--primary)'
              fill='url(#fillScore)'
              strokeWidth={2}
            />
            <Area
              yAxisId='hours'
              type='monotone'
              dataKey='totalProductiveHours'
              stroke='var(--chart-2)'
              fill='url(#fillHours)'
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
