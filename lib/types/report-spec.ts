// lib/types/report-spec.ts
// ReportSpec and DashboardSpec types for the AI Report Builder.
// These define the structured JSON that the LLM outputs via tool calling.

// ── Query Layer (what data to fetch) ─────────────────────
export interface ReportQuery {
  dataset: string;
  measures: string[];
  dimensions: string[];
  filters: Array<{
    member: string;
    operator: 'equals' | 'notEquals' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'between' | 'inDateRange';
    values: string[];
  }>;
  timeDimension: {
    dimension: string;
    granularity: 'day' | 'week' | 'month' | 'quarter' | 'year';
    dateRange: [string, string] | null;
  } | null;
  orderBy: Array<{ member: string; direction: 'asc' | 'desc' }>;
  limit: number;
}

// ── Visualization Layer (how to render) ──────────────────
export interface ReportVisualization {
  type: 'table' | 'bar' | 'line' | 'area' | 'pie' | 'number' | 'scatter' | 'heatmap';
  xAxis: string | null;
  yAxis: string[];
  colorBy: string | null;
  stacked: boolean;
  title: string;
  subtitle: string | null;
}

// ── Theme (look and feel) ────────────────────────────────
export interface ReportTheme {
  palette: string[];
  background: string;
  textColor: string;
  gridColor: string;
  borderRadius: number;
  fontFamily: string;
}

// ── Combined Report Spec ─────────────────────────────────
export interface ReportSpec {
  id: string;
  query: ReportQuery;
  visualization: ReportVisualization;
  theme: ReportTheme;
}

// ── Dashboard Layout ─────────────────────────────────────
export interface DashboardItem {
  reportId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardSpec {
  id: string;
  name: string;
  description: string | null;
  items: DashboardItem[];
  theme: ReportTheme;
  reports: ReportSpec[];
}

// ── Default Theme ────────────────────────────────────────
export const DEFAULT_THEME: ReportTheme = {
  palette: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'],
  background: '#FFFFFF',
  textColor: '#1F2937',
  gridColor: '#E5E7EB',
  borderRadius: 4,
  fontFamily: 'Inter, system-ui, sans-serif',
};
