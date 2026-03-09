// lib/catalog/loader.ts
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

export interface ScopingRule {
  sql?: string;
  requires_join?: boolean;
  deny?: boolean;
}

export interface DatasetDefinition {
  dataset: string;
  display_name: string;
  description: string;
  base_table: string;
  joins: Array<{ table: string; alias: string; on: string; type: string }>;
  measures: Array<{ name: string; sql: string; type: string; description: string }>;
  dimensions: Array<{ name: string; sql: string; type: string; description: string; values?: string[] }>;
  scoping?: Record<string, ScopingRule>;
}

let catalogCache: Map<string, DatasetDefinition> | null = null;

export function getCatalog(): Map<string, DatasetDefinition> {
  if (catalogCache) return catalogCache;

  const catalogDir = join(process.cwd(), 'lib', 'catalog');
  const files = readdirSync(catalogDir).filter(f => f.endsWith('.yaml'));
  const catalog = new Map<string, DatasetDefinition>();

  for (const file of files) {
    const raw = readFileSync(join(catalogDir, file), 'utf-8');
    const def = parseYaml(raw) as DatasetDefinition;
    // Default joins to empty array if not specified
    if (!def.joins) def.joins = [];
    catalog.set(def.dataset, def);
  }

  catalogCache = catalog;
  return catalog;
}

/** Reset cache — useful for testing */
export function resetCatalogCache(): void {
  catalogCache = null;
}

/** Build Zod-compatible enum arrays from catalog for AI tool schemas */
export function buildToolSchemas(catalog: Map<string, DatasetDefinition>) {
  const datasetNames = [...catalog.keys()] as [string, ...string[]];
  const allMeasures = new Map<string, string[]>();
  const allDimensions = new Map<string, string[]>();

  for (const [name, def] of catalog) {
    allMeasures.set(name, def.measures.map(m => m.name));
    allDimensions.set(name, def.dimensions.map(d => d.name));
  }

  return { datasetNames, allMeasures, allDimensions };
}

/** Serialize catalog for LLM system prompt */
export function buildCatalogSummary(catalog: Map<string, DatasetDefinition>): string {
  return [...catalog.entries()].map(([name, def]) => {
    const measures = def.measures.map(m => `${m.name} — ${m.description}`).join(', ');
    const dims = def.dimensions.map(d => `${d.name} — ${d.description}`).join(', ');
    return `Dataset "${name}" (${def.display_name}): ${def.description}\n  Measures: ${measures}\n  Dimensions: ${dims}`;
  }).join('\n\n');
}
