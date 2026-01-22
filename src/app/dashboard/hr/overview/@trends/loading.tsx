import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className='h-6 w-44' />
        <Skeleton className='h-4 w-28' />
      </CardHeader>
      <CardContent>
        <Skeleton className='h-64 w-full' />
      </CardContent>
    </Card>
  );
}
