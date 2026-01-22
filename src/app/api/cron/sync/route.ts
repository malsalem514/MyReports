import { NextRequest, NextResponse } from 'next/server';
import {
  syncEmployees,
  syncProductivityData,
  runFullSync
} from '@/features/hr-dashboard/actions/sync-actions';

// Cron secret for security
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Verify cron request is authorized
 */
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  return token === CRON_SECRET;
}

/**
 * POST /api/cron/sync
 *
 * Trigger data sync operations
 *
 * Query params:
 * - type: 'employees' | 'productivity' | 'full' (default: 'full')
 * - days: number of days for productivity sync (default: 7)
 *
 * Headers:
 * - Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: NextRequest) {
  // Verify authorization
  if (CRON_SECRET && !isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const syncType = searchParams.get('type') || 'full';
    const days = parseInt(searchParams.get('days') || '7', 10);

    let result;

    switch (syncType) {
      case 'employees':
        result = await syncEmployees();
        break;
      case 'productivity':
        result = await syncProductivityData(days);
        break;
      case 'full':
      default:
        result = await runFullSync(days);
        break;
    }

    return NextResponse.json({
      success: true,
      syncType,
      result
    });
  } catch (error) {
    console.error('Cron sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/sync
 *
 * Health check endpoint
 */
export async function GET(request: NextRequest) {
  // Allow unauthenticated health checks
  return NextResponse.json({
    status: 'ok',
    message: 'HR Dashboard sync cron endpoint',
    endpoints: {
      'POST /api/cron/sync': 'Trigger sync (requires auth)',
      'POST /api/cron/sync?type=employees': 'Sync employees only',
      'POST /api/cron/sync?type=productivity': 'Sync productivity only',
      'POST /api/cron/sync?type=full&days=14': 'Full sync with 14 days of data'
    }
  });
}
