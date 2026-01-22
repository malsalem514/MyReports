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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getDailySummaryData } from '@/features/hr-dashboard/actions/daily-summary-actions';
import { IconSearch, IconRefresh } from '@tabler/icons-react';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getDailySummaryData();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle>ActivTrak Daily User Summary</CardTitle>
          <Button
            variant='outline'
            size='sm'
            onClick={fetchData}
            disabled={loading}
          >
            <IconRefresh className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        <div className='relative mt-4'>
          <IconSearch className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            placeholder='Search by name or date...'
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
        {!loading && !error && (
          <div className='mt-4 text-sm text-muted-foreground'>
            Showing {filteredData.length} of {data.length} records
          </div>
        )}
      </CardContent>
    </Card>
  );
}
