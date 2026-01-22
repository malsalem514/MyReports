'use client';

import { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getDailySummaryData,
  DailySummaryResult
} from '@/features/hr-dashboard/actions/daily-summary-actions';
import { EmailBasedAccessContext } from '@/lib/auth/manager-access';
import { IconSearch, IconRefresh, IconUser, IconUsers, IconShield } from '@tabler/icons-react';

interface DailySummaryRow {
  date: string;
  userName: string;
  productiveHours: number;
  unproductiveHours: number;
  neutralHours: number;
  totalHours: number;
  productivityPercent: number;
}

export function DailySummaryTable() {
  const [data, setData] = useState<DailySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [appliedEmail, setAppliedEmail] = useState('');
  const [accessContext, setAccessContext] = useState<EmailBasedAccessContext | null>(null);

  const fetchData = async (email?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result: DailySummaryResult = await getDailySummaryData(email);
      setData(result.data);
      setAccessContext(result.accessContext);
      setAppliedEmail(email || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilter = () => {
    fetchData(filterEmail.trim() || undefined);
  };

  const handleClearFilter = () => {
    setFilterEmail('');
    setAppliedEmail('');
    setAccessContext(null);
    fetchData();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleApplyFilter();
    }
  };

  const filteredData = data.filter(
    (row) =>
      row.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.date.includes(searchTerm)
  );

  const formatHours = (hours: number) => {
    return hours.toFixed(1);
  };

  const formatPercent = (percent: number) => {
    return `${percent.toFixed(1)}%`;
  };

  return (
    <div className='space-y-4'>
      {/* Email Filter Card */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>Filter by User Email</CardTitle>
          <CardDescription>
            Enter an email to view only that user's records and their direct reports.
            HR admins see all employees.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex gap-2'>
            <div className='relative flex-1'>
              <IconUser className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                placeholder='Enter email address (e.g., john@company.com)'
                value={filterEmail}
                onChange={(e) => setFilterEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                className='pl-10'
              />
            </div>
            <Button onClick={handleApplyFilter} disabled={loading}>
              Apply Filter
            </Button>
            {appliedEmail && (
              <Button variant='outline' onClick={handleClearFilter} disabled={loading}>
                Clear
              </Button>
            )}
          </div>

          {/* Access Context Info */}
          {accessContext && (
            <div className='mt-4 p-3 bg-muted rounded-lg'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-sm font-medium'>
                  {accessContext.employeeName || accessContext.userEmail}
                </span>
                {accessContext.isHRAdmin && (
                  <Badge variant='default' className='bg-purple-600'>
                    <IconShield className='mr-1 h-3 w-3' />
                    HR Admin
                  </Badge>
                )}
                {accessContext.isManager && !accessContext.isHRAdmin && (
                  <Badge variant='secondary'>
                    <IconUsers className='mr-1 h-3 w-3' />
                    Manager
                  </Badge>
                )}
                {!accessContext.isManager && !accessContext.isHRAdmin && (
                  <Badge variant='outline'>
                    <IconUser className='mr-1 h-3 w-3' />
                    Employee
                  </Badge>
                )}
              </div>
              <div className='mt-2 text-sm text-muted-foreground'>
                {accessContext.isHRAdmin ? (
                  <span>Full access to all {accessContext.allowedEmails.length} employees</span>
                ) : accessContext.isManager ? (
                  <span>
                    Access to own data + {accessContext.directReportCount} direct reports + {accessContext.totalReportCount - accessContext.directReportCount} indirect reports
                    ({accessContext.allowedEmails.length} total)
                  </span>
                ) : accessContext.employeeId ? (
                  <span>Access to own data only</span>
                ) : (
                  <span>User not found in BambooHR - showing own data only</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Table Card */}
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle>ActivTrak Daily User Summary</CardTitle>
              {appliedEmail && (
                <CardDescription className='mt-1'>
                  Filtered for: {appliedEmail}
                </CardDescription>
              )}
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => fetchData(appliedEmail || undefined)}
              disabled={loading}
            >
              <IconRefresh className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <div className='relative mt-4'>
            <IconSearch className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              placeholder='Search within results by name or date...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='pl-10'
            />
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className='text-center py-8 text-red-500'>{error}</div>
          ) : loading ? (
            <div className='text-center py-8 text-muted-foreground'>
              Loading data...
            </div>
          ) : data.length === 0 && !appliedEmail ? (
            <div className='text-center py-8 text-muted-foreground'>
              Enter an email above and click "Apply Filter" to load data
            </div>
          ) : filteredData.length === 0 ? (
            <div className='text-center py-8 text-muted-foreground'>
              No data found
            </div>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className='text-right'>Productive (hrs)</TableHead>
                    <TableHead className='text-right'>Unproductive (hrs)</TableHead>
                    <TableHead className='text-right'>Neutral (hrs)</TableHead>
                    <TableHead className='text-right'>Total (hrs)</TableHead>
                    <TableHead className='text-right'>Productivity %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((row, index) => (
                    <TableRow key={`${row.date}-${row.userName}-${index}`}>
                      <TableCell>{row.date}</TableCell>
                      <TableCell className='font-medium'>{row.userName}</TableCell>
                      <TableCell className='text-right text-green-600'>
                        {formatHours(row.productiveHours)}
                      </TableCell>
                      <TableCell className='text-right text-red-600'>
                        {formatHours(row.unproductiveHours)}
                      </TableCell>
                      <TableCell className='text-right text-gray-500'>
                        {formatHours(row.neutralHours)}
                      </TableCell>
                      <TableCell className='text-right'>
                        {formatHours(row.totalHours)}
                      </TableCell>
                      <TableCell className='text-right font-semibold'>
                        {formatPercent(row.productivityPercent)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!loading && !error && data.length > 0 && (
            <div className='mt-4 text-sm text-muted-foreground'>
              Showing {filteredData.length} of {data.length} records
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
