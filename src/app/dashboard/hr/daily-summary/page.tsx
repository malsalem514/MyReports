import PageContainer from '@/components/layout/page-container';
import { DailySummaryTable } from '@/features/hr-dashboard/components/daily-summary-table';

export default function DailySummaryPage() {
  return (
    <PageContainer
      pageTitle='Daily Summary Report'
      pageDescription='ActivTrak productivity data by employee'
    >
      <DailySummaryTable />
    </PageContainer>
  );
}
