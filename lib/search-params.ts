import type { LookbackWeeks } from './constants';
import { LOOKBACK_OPTIONS } from './constants';

export interface SearchParamReader {
  get(name: string): string | null;
  has(name: string): boolean;
  toString(): string;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function parseListParam(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

export function parseEnumParam<T extends string>(
  value: string | null | undefined,
  allowedValues: readonly T[],
  fallback: T,
): T {
  return allowedValues.includes(value as T) ? (value as T) : fallback;
}

export function sanitizeParam(
  value: string | null | undefined,
  allowedValues: readonly string[],
  fallback = 'all',
): string {
  if (!value) return fallback;
  return allowedValues.includes(value) ? value : fallback;
}

export function parsePageParam(value: string | null | undefined): number {
  const parsed = Number(value || '0');
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function parseLookbackWeeks(
  value: string | null | undefined,
  fallback: LookbackWeeks,
): LookbackWeeks {
  const parsed = Number(value);
  return LOOKBACK_OPTIONS.includes(parsed as LookbackWeeks) ? (parsed as LookbackWeeks) : fallback;
}

export function buildPathWithParams(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
