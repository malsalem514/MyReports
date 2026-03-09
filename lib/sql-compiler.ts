// lib/sql-compiler.ts
import type { ReportQuery } from './types/report-spec';
import type { DatasetDefinition } from './catalog/loader';

export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
}

export interface QueryScope {
  role: string;
  department: string | null;
  email: string;
}

export function compileReportQuery(
  query: ReportQuery,
  dataset: DatasetDefinition,
  scope: QueryScope,
): CompiledQuery {
  const params: Record<string, unknown> = {};
  let paramIdx = 0;
  const nextParam = (value: unknown) => {
    const name = `p${paramIdx++}`;
    params[name] = value;
    return `:${name}`;
  };

  const measureMap = new Map(dataset.measures.map(m => [m.name, m.sql]));
  const dimMap = new Map(dataset.dimensions.map(d => [d.name, d.sql]));

  // SELECT clause
  const selectParts: string[] = [];

  // Time dimension granularity grouping (prepend if present)
  if (query.timeDimension) {
    const timeSql = dimMap.get(query.timeDimension.dimension);
    if (!timeSql) throw new Error(`Unknown time dimension: ${query.timeDimension.dimension}`);
    const granSql = granularitySql(resolveSql(timeSql, dataset), query.timeDimension.granularity);
    selectParts.push(`${granSql} AS "time_period"`);
  }

  for (const dim of query.dimensions) {
    const sql = dimMap.get(dim);
    if (!sql) throw new Error(`Unknown dimension: ${dim}`);
    selectParts.push(`${resolveSql(sql, dataset)} AS "${dim}"`);
  }
  for (const measure of query.measures) {
    const sql = measureMap.get(measure);
    if (!sql) throw new Error(`Unknown measure: ${measure}`);
    selectParts.push(`${resolveSql(sql, dataset)} AS "${measure}"`);
  }

  // FROM + JOINs
  let fromClause = `${dataset.base_table} base_`;
  for (const join of dataset.joins) {
    const joinSql = resolveSql(join.on, dataset);
    fromClause += `\n  ${join.type.toUpperCase()} JOIN ${join.table} ${join.alias} ON ${joinSql}`;
  }

  // WHERE clause
  const whereParts: string[] = [];

  // Role-based scoping from dataset definition
  const scopingRule = dataset.scoping?.[scope.role];
  if (scopingRule) {
    if (scopingRule.deny) {
      throw new Error(`Role "${scope.role}" is not permitted to query dataset "${dataset.dataset}"`);
    }
    if (scopingRule.sql && scope.department) {
      whereParts.push(resolveSql(scopingRule.sql, dataset));
      params['scope_dept'] = scope.department;
    }
  }

  // User-specified filters
  for (const filter of query.filters) {
    const dimSql = dimMap.get(filter.member);
    if (!dimSql) throw new Error(`Unknown filter member: ${filter.member}`);
    const resolved = resolveSql(dimSql, dataset);

    switch (filter.operator) {
      case 'equals':
        if (filter.values.length === 1) {
          whereParts.push(`${resolved} = ${nextParam(filter.values[0])}`);
        } else {
          const placeholders = filter.values.map(v => nextParam(v)).join(', ');
          whereParts.push(`${resolved} IN (${placeholders})`);
        }
        break;
      case 'notEquals':
        whereParts.push(`${resolved} != ${nextParam(filter.values[0])}`);
        break;
      case 'gt': case 'gte': case 'lt': case 'lte': {
        const ops: Record<string, string> = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
        whereParts.push(`${resolved} ${ops[filter.operator]} ${nextParam(filter.values[0])}`);
        break;
      }
      case 'between':
        whereParts.push(`${resolved} BETWEEN ${nextParam(filter.values[0])} AND ${nextParam(filter.values[1])}`);
        break;
      case 'inDateRange':
        whereParts.push(`${resolved} >= ${nextParam(filter.values[0])} AND ${resolved} < ${nextParam(filter.values[1])}`);
        break;
      case 'contains':
        whereParts.push(`${resolved} LIKE ${nextParam(`%${filter.values[0]}%`)}`);
        break;
    }
  }

  // Time dimension date range filter
  if (query.timeDimension?.dateRange) {
    const timeSql = dimMap.get(query.timeDimension.dimension);
    if (timeSql) {
      const resolved = resolveSql(timeSql, dataset);
      whereParts.push(`${resolved} >= ${nextParam(query.timeDimension.dateRange[0])}`);
      whereParts.push(`${resolved} < ${nextParam(query.timeDimension.dateRange[1])}`);
    }
  }

  // GROUP BY
  const groupByParts: string[] = [];
  if (query.timeDimension) {
    const timeSql = dimMap.get(query.timeDimension.dimension);
    if (timeSql) {
      groupByParts.push(granularitySql(resolveSql(timeSql, dataset), query.timeDimension.granularity));
    }
  }
  for (const dim of query.dimensions) {
    const dimSql = dimMap.get(dim);
    if (dimSql) {
      groupByParts.push(resolveSql(dimSql, dataset));
    }
  }

  // ORDER BY
  const orderByParts = query.orderBy.map(o => {
    const isMeasure = measureMap.has(o.member);
    const ref = isMeasure ? `"${o.member}"` : resolveSql(dimMap.get(o.member) ?? o.member, dataset);
    return `${ref} ${o.direction.toUpperCase()}`;
  });

  // Assemble
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join('\n  AND ')}` : '';
  const groupByClause = groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(', ')}` : '';
  const orderByClause = orderByParts.length > 0 ? `ORDER BY ${orderByParts.join(', ')}` : '';
  const limitClause = query.limit > 0 ? `FETCH FIRST ${query.limit} ROWS ONLY` : '';

  const sql = [
    `SELECT ${selectParts.join(',\n       ')}`,
    `FROM ${fromClause}`,
    whereClause,
    groupByClause,
    orderByClause,
    limitClause,
  ].filter(Boolean).join('\n');

  return { sql, params };
}

function resolveSql(sql: string, dataset: DatasetDefinition): string {
  let resolved = sql.replace(/\{base\}/g, 'base_');
  for (const join of dataset.joins) {
    resolved = resolved.replace(new RegExp(`\\{${join.alias}\\}`, 'g'), join.alias);
  }
  return resolved;
}

function granularitySql(timeSql: string, granularity: string): string {
  switch (granularity) {
    case 'day': return `TRUNC(${timeSql})`;
    case 'week': return `TRUNC(${timeSql}, 'IW')`;
    case 'month': return `TRUNC(${timeSql}, 'MM')`;
    case 'quarter': return `TRUNC(${timeSql}, 'Q')`;
    case 'year': return `TRUNC(${timeSql}, 'YYYY')`;
    default: return `TRUNC(${timeSql})`;
  }
}
