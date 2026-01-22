import { redirect } from 'next/navigation';
import { hasHRDashboardAccess } from '@/lib/auth/manager-access';

export default async function HRDashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Check if user has access to HR dashboard
  const hasAccess = await hasHRDashboardAccess();

  if (!hasAccess) {
    redirect('/dashboard/overview');
  }

  return <>{children}</>;
}
