import { redirect } from 'next/navigation';
import { getAccessContext } from '@/lib/access';
import {
  getEmptyRawDataResult,
  getRawDataCatalog,
  getRawDataReport,
  normalizeRawDataDatasetKey,
  RAW_DATA_PAGE_SIZE,
} from '@/lib/raw-data';
import { getTrailingDaysDateRange, parseDateInput, toDateParam } from '@/lib/report-date-defaults';
import { parsePageParam } from '@/lib/search-params';
import { requireVisibleTab } from '@/lib/tab-config';
import { RawDataClient } from './raw-data-client';

export default async function RawDataPage({
  searchParams,
}: {
  searchParams: Promise<{
    dataset?: string;
    startDate?: string;
    endDate?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const access = await getAccessContext();
  if (!access.userEmail) {
    redirect('/login');
  }
  if (!access.isRootAdmin && !access.isHRAdmin) {
    redirect('/dashboard');
  }
  await requireVisibleTab(access.userEmail, access, 'raw-data');

  const params = await searchParams;
  const datasetKey = normalizeRawDataDatasetKey(params.dataset);
  const { startDate: defaultStartDate, endDate: defaultEndDate } = getTrailingDaysDateRange(30);
  let startDate = parseDateInput(params.startDate, defaultStartDate, false);
  let endDate = parseDateInput(params.endDate, defaultEndDate, true);

  if (startDate > endDate) {
    const previousStart = startDate;
    startDate = parseDateInput(toDateParam(endDate), endDate, false);
    endDate = parseDateInput(toDateParam(previousStart), previousStart, true);
  }

  const page = parsePageParam(params.page);
  const search = (params.q || '').trim();
  const catalog = getRawDataCatalog();

  try {
    const result = await getRawDataReport({
      datasetKey,
      startDate,
      endDate,
      search,
      page,
      pageSize: RAW_DATA_PAGE_SIZE,
    });
    return <RawDataClient catalog={catalog} result={result} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Oracle raw-data report unavailable';
    const result = getEmptyRawDataResult({
      datasetKey,
      startDate,
      endDate,
      search,
      page,
      pageSize: RAW_DATA_PAGE_SIZE,
    });
    return <RawDataClient catalog={catalog} result={result} errorMessage={message} />;
  }
}
