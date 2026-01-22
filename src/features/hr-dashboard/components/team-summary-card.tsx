'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { getTeamProductivityData } from '../actions/productivity-actions';
import Link from 'next/link';

interface TeamSummaryCardProps {
  startDate?: Date;
  endDate?: Date;
}

export function TeamSummaryCard({ startDate, endDate }: TeamSummaryCardProps) {
  const [data, setData] = React.useState<
    {
      employeeId: number;
      displayName: string;
      department: string | null;
      avgProductivityScore: number | null;
      totalProductiveHours: number;
    }[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);

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
          pageSize: 5,
          sortBy: 'totalProductiveHours',
          sortOrder: 'desc'
        });

        setData(result.data);
      } catch (error) {
        console.error('Failed to load team summary:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [startDate, endDate]);

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function getScoreColor(score: number | null): string {
    if (score === null) return 'bg-muted text-muted-foreground';
    if (score >= 80) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    if (score >= 60) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Performers</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className='flex items-center gap-4'>
              <div className='h-10 w-10 animate-pulse rounded-full bg-muted' />
              <div className='flex-1 space-y-2'>
                <div className='h-4 w-32 animate-pulse rounded bg-muted' />
                <div className='h-3 w-24 animate-pulse rounded bg-muted' />
              </div>
              <div className='h-4 w-16 animate-pulse rounded bg-muted' />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Performers</CardTitle>
        <CardDescription>Most productive team members</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {data.length === 0 ? (
          <p className='text-center text-muted-foreground'>No data available</p>
        ) : (
          data.map((employee) => (
            <Link
              key={employee.employeeId}
              href={`/dashboard/hr/employee/${employee.employeeId}`}
              className='flex items-center gap-4 rounded-lg p-2 transition-colors hover:bg-muted/50'
            >
              <Avatar className='h-10 w-10'>
                <AvatarFallback>
                  {getInitials(employee.displayName)}
                </AvatarFallback>
              </Avatar>
              <div className='flex-1 min-w-0'>
                <p className='font-medium truncate'>{employee.displayName}</p>
                <p className='text-sm text-muted-foreground truncate'>
                  {employee.department || 'No department'}
                </p>
              </div>
              <div className='flex flex-col items-end gap-1'>
                <Badge
                  variant='secondary'
                  className={getScoreColor(employee.avgProductivityScore)}
                >
                  {employee.avgProductivityScore?.toFixed(0) ?? 'N/A'}%
                </Badge>
                <span className='text-xs text-muted-foreground'>
                  {employee.totalProductiveHours.toFixed(1)}h
                </span>
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
