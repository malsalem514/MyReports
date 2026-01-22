import {
  createSearchParamsCache,
  createSerializer,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum
} from 'nuqs/server';

export const searchParams = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(10),
  name: parseAsString,
  gender: parseAsString,
  category: parseAsString
  // advanced filter
  // filters: getFiltersStateParser().withDefault([]),
  // joinOperator: parseAsStringEnum(['and', 'or']).withDefault('and')
};

export const searchParamsCache = createSearchParamsCache(searchParams);
export const serialize = createSerializer(searchParams);

// HR Dashboard specific search params
export const hrSearchParams = {
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(20),
  startDate: parseAsString,
  endDate: parseAsString,
  department: parseAsString,
  search: parseAsString,
  sortBy: parseAsString.withDefault('displayName'),
  sortOrder: parseAsStringEnum(['asc', 'desc']).withDefault('asc')
};

export const hrSearchParamsCache = createSearchParamsCache(hrSearchParams);
export const hrSerialize = createSerializer(hrSearchParams);
