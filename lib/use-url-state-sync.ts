'use client';

import { useEffect, useMemo } from 'react';
import { buildPathWithParams, type SearchParamReader } from './search-params';

type RouterLike = {
  replace(href: string, options?: { scroll?: boolean }): void;
};

export interface UrlStateField {
  read: (params: SearchParamReader) => unknown;
  sync: (value: unknown) => void;
  write: (params: URLSearchParams) => void;
}

interface UseUrlStateSyncOptions {
  pathname: string;
  router: RouterLike;
  scroll?: boolean;
  searchParams: SearchParamReader;
  fields: UrlStateField[];
}

export function useUrlStateSync({
  pathname,
  router,
  scroll = false,
  searchParams,
  fields,
}: UseUrlStateSyncOptions): URLSearchParams {
  const nextValues = useMemo(
    () => fields.map((field) => field.read(searchParams)),
    [fields, searchParams],
  );

  useEffect(() => {
    fields.forEach((field, index) => {
      field.sync(nextValues[index]);
    });
  }, [fields, nextValues]);

  const nextParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    fields.forEach((field) => {
      field.write(params);
    });
    return params;
  }, [fields, searchParams]);

  useEffect(() => {
    const next = nextParams.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(buildPathWithParams(pathname, nextParams), { scroll });
    }
  }, [nextParams, pathname, router, scroll, searchParams]);

  return nextParams;
}
