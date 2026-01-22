import PageContainer from '@/components/layout/page-container';
import { QuebecComplianceReport } from '@/features/hr-dashboard/components/quebec-compliance-report';

export default function QuebecCompliancePage() {
  return (
    <PageContainer
      pageTitle="Quebec Office Compliance"
      pageDescription="Track office attendance compliance for Quebec employees (2 days/week requirement)"
    >
      <QuebecComplianceReport />
    </PageContainer>
  );
}
