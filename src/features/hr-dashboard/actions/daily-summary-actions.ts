'use server';

import { fetchProductivityData } from '@/lib/api/bigquery/client';
import {
  getAccessContextByEmail,
  EmailBasedAccessContext
} from '@/lib/auth/manager-access';

export interface DailySummaryRow {
  date: string;
  userName: string;
  productiveHours: number;
  unproductiveHours: number;
  neutralHours: number;
  totalHours: number;
  productivityPercent: number;
}

export interface DailySummaryResult {
  data: DailySummaryRow[];
  accessContext: EmailBasedAccessContext | null;
  totalRecords: number;
  filteredRecords: number;
}

/**
 * Fetch daily summary data from ActivTrak (BigQuery)
 * Optionally filtered by user email and their allowed access
 */
export async function getDailySummaryData(
  filterEmail?: string
): Promise<DailySummaryResult> {
  try {
    // Get last 30 days of data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    // Get access context if email provided
    let accessContext: EmailBasedAccessContext | null = null;
    let allowedEmails: string[] | undefined = undefined;

    if (filterEmail && filterEmail.trim()) {
      accessContext = await getAccessContextByEmail(filterEmail);
      allowedEmails = accessContext.allowedEmails;
    }

    // Fetch data from BigQuery, filtered by allowed emails if provided
    const rawData = await fetchProductivityData(startDate, endDate, allowedEmails);

    // Transform to simpler format
    const result: DailySummaryRow[] = rawData.map((row) => {
      const productiveHours = row.productive_time / 3600;
      const unproductiveHours = row.unproductive_time / 3600;
      const neutralHours = row.neutral_time / 3600;
      const totalHours = row.total_time / 3600;
      const productivityPercent =
        totalHours > 0 ? (productiveHours / totalHours) * 100 : 0;

      return {
        date: row.date.toISOString().split('T')[0],
        userName: row.username,
        productiveHours,
        unproductiveHours,
        neutralHours,
        totalHours,
        productivityPercent
      };
    });

    // Sort by date descending, then by user name
    result.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return a.userName.localeCompare(b.userName);
    });

    return {
      data: result,
      accessContext,
      totalRecords: result.length,
      filteredRecords: result.length
    };
  } catch (error) {
    console.error('Error fetching daily summary:', error);
    throw new Error('Failed to fetch daily summary data from ActivTrak');
  }
}

/**
 * Get access context for an email (for UI display)
 */
export async function getAccessContext(
  email: string
): Promise<EmailBasedAccessContext> {
  return getAccessContextByEmail(email);
}
