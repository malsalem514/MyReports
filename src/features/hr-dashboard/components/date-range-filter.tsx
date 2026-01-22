'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

const presets = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 14 days', value: '14d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This month', value: 'this_month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'Custom', value: 'custom' }
];

function getPresetDates(preset: string): { from: Date; to: Date } {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  switch (preset) {
    case '7d':
      return {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        to: today
      };
    case '14d':
      return {
        from: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        to: today
      };
    case '30d':
      return {
        from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        to: today
      };
    case 'this_month':
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: today
      };
    case 'last_month':
      return {
        from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        to: new Date(today.getFullYear(), today.getMonth(), 0)
      };
    default:
      return {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        to: today
      };
  }
}

export function HRDateRangeFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialStartDate = searchParams.get('startDate');
  const initialEndDate = searchParams.get('endDate');

  const [date, setDate] = React.useState<DateRange | undefined>(() => {
    if (initialStartDate && initialEndDate) {
      return {
        from: new Date(initialStartDate),
        to: new Date(initialEndDate)
      };
    }
    return getPresetDates('7d');
  });

  const [selectedPreset, setSelectedPreset] = React.useState(() => {
    if (initialStartDate || initialEndDate) {
      return 'custom';
    }
    return '7d';
  });

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    if (value !== 'custom') {
      const dates = getPresetDates(value);
      setDate(dates);
      updateUrl(dates.from, dates.to);
    }
  };

  const handleDateChange = (newDate: DateRange | undefined) => {
    setDate(newDate);
    setSelectedPreset('custom');
    if (newDate?.from && newDate?.to) {
      updateUrl(newDate.from, newDate.to);
    }
  };

  const updateUrl = (from: Date, to: Date) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('startDate', from.toISOString().split('T')[0]);
    params.set('endDate', to.toISOString().split('T')[0]);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className='flex items-center gap-2'>
      <Select value={selectedPreset} onValueChange={handlePresetChange}>
        <SelectTrigger className='w-[140px]'>
          <SelectValue placeholder='Select period' />
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            id='date'
            variant='outline'
            className={cn(
              'w-[260px] justify-start text-left font-normal',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className='mr-2 h-4 w-4' />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, 'LLL dd, y')} -{' '}
                  {format(date.to, 'LLL dd, y')}
                </>
              ) : (
                format(date.from, 'LLL dd, y')
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto p-0' align='end'>
          <Calendar
            initialFocus
            mode='range'
            defaultMonth={date?.from}
            selected={date}
            onSelect={handleDateChange}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
