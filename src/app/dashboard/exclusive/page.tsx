'use client';

import PageContainer from '@/components/layout/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ExclusivePage() {
  return (
    <PageContainer>
      <Card>
        <CardHeader>
          <CardTitle>Exclusive Features</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground'>
            This area contains exclusive features available when authentication
            is configured.
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
