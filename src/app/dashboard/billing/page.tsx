'use client';

import PageContainer from '@/components/layout/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { billingInfoContent } from '@/config/infoconfig';

export default function BillingPage() {
  return (
    <PageContainer
      pageTitle='Billing & Plans'
      pageDescription='Manage your subscription and usage limits'
      infoContent={billingInfoContent}
    >
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground'>
            Billing management is available when authentication is configured.
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
