import PageContainer from '@/components/layout/page-container';
import { ProductivityTable } from '@/features/hr-dashboard/components/productivity-table';
import { HRDateRangeFilter } from '@/features/hr-dashboard/components/date-range-filter';
import { searchParamsCache } from '@/lib/searchparams';

interface TeamPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const params = await searchParams;

  // Parse date params with defaults
  const endDate = params.endDate
    ? new Date(params.endDate as string)
    : new Date();
  const startDate = params.startDate
    ? new Date(params.startDate as string)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const page = parseInt((params.page as string) || '1', 10);
  const pageSize = parseInt((params.pageSize as string) || '20', 10);
  const department = params.department as string | undefined;
  const search = params.search as string | undefined;
  const sortBy = (params.sortBy as string) || 'displayName';
  const sortOrder = (params.sortOrder as 'asc' | 'desc') || 'asc';

  return (
    <PageContainer>
      <div className='flex flex-1 flex-col space-y-4'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Team Members</h2>
            <p className='text-muted-foreground'>
              View and manage team productivity data
            </p>
          </div>
          <HRDateRangeFilter />
        </div>

        <ProductivityTable
          startDate={startDate}
          endDate={endDate}
          page={page}
          pageSize={pageSize}
          department={department}
          search={search}
          sortBy={sortBy}
          sortOrder={sortOrder}
        />
      </div>
    </PageContainer>
  );
}
