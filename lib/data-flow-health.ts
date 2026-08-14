export const DEFAULT_DATA_FRESHNESS_MAX_BUSINESS_DAYS = 2;

export interface DataFlowSource {
  name: string;
  latestDate: Date | null;
}

export interface DataFlowHealthAssessment {
  ok: boolean;
  maxBusinessDayLag: number;
  missingSources: string[];
  staleSources: string[];
  sourceBusinessDayLag: Record<string, number | null>;
}

export function businessDayLag(latestDate: Date, now: Date): number {
  const cursor = new Date(latestDate.getFullYear(), latestDate.getMonth(), latestDate.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (cursor >= end) return 0;

  let businessDays = 0;
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) businessDays += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return businessDays;
}

export function getDataFreshnessMaxBusinessDays(
  value: string | undefined = process.env.DATA_FRESHNESS_MAX_BUSINESS_DAYS,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1
    ? parsed
    : DEFAULT_DATA_FRESHNESS_MAX_BUSINESS_DAYS;
}

export function assessDataFlowHealth(params: {
  now: Date;
  sources: DataFlowSource[];
  maxBusinessDayLag?: number;
}): DataFlowHealthAssessment {
  const maxBusinessDayLag = params.maxBusinessDayLag ?? DEFAULT_DATA_FRESHNESS_MAX_BUSINESS_DAYS;
  const missingSources: string[] = [];
  const staleSources: string[] = [];
  const sourceBusinessDayLag: Record<string, number | null> = {};

  for (const source of params.sources) {
    if (!source.latestDate || Number.isNaN(source.latestDate.getTime())) {
      missingSources.push(source.name);
      sourceBusinessDayLag[source.name] = null;
      continue;
    }

    const lag = businessDayLag(source.latestDate, params.now);
    sourceBusinessDayLag[source.name] = lag;
    if (lag > maxBusinessDayLag) staleSources.push(source.name);
  }

  return {
    ok: missingSources.length === 0 && staleSources.length === 0,
    maxBusinessDayLag,
    missingSources,
    staleSources,
    sourceBusinessDayLag,
  };
}
