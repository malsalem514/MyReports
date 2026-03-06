import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isHRAdminEmail } from '@/lib/access';
import { getDevBypassEmail } from '@/lib/dev-bypass';
import { initializeSchema } from '@/lib/oracle';
import { syncTbsEmployeeMap } from '@/lib/sync';

export async function POST() {
  const bypassEmail = getDevBypassEmail('api-admin-sync-tbs-map');
  const session = bypassEmail ? null : await auth();
  const adminEmail = (bypassEmail || session?.user?.email || '').toLowerCase();
  if (!adminEmail || !isHRAdminEmail(adminEmail)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await initializeSchema();

  try {
    const mapped = await syncTbsEmployeeMap();
    return NextResponse.json({ success: true, mapped });
  } catch (error) {
    console.error('[API] TBS map sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
