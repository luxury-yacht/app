/**
 * frontend/src/shared/components/tables/persistence/gridTableViewRegistry.contract.test.ts
 *
 * Contract test: every viewId passed to a grid table persistence hook must
 * exist in gridTableViewRegistry.
 *
 * This prevents registry drift — if a new view is added but its viewId is not
 * registered, GC will silently delete the persisted state for that view.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { listRegisteredGridTableViews } from './gridTableViewRegistry';

const TABLE_MODES = [
  'Local Complete',
  'Local Partial',
  'Query Backed Static',
  'Query Backed Dynamic',
] as const;

const TABLE_MODE_PATTERN = new RegExp(TABLE_MODES.join('|'));

const DIRECT_GRIDTABLE_USAGE_EXCEPTIONS = {
  'modules/resource-grid/ResourceInventoryTable.tsx': {
    kind: 'resource-grid-surface',
    mode: 'Inherited from ResourceInventorySourceState (boundedRowsSource / backendQuerySource)',
    reason:
      'The one resource-inventory wrapper. Callers pass a normalized source state plus gridTableProps, so completeness/table mode is owned by the source, not this shell; it adds only the loading boundary and render-state-driven display.',
  },
  'modules/resource-grid/ObjectPanelResourceGridTableSurface.tsx': {
    kind: 'resource-grid-surface',
    mode: 'Inherited from useObjectPanelResourceGridTable',
    reason: 'Adapter shell only; callers provide gridTableProps after declaring tableMode.',
  },
  'modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx': {
    kind: 'classified-table',
    mode: 'Local Partial',
    reason: 'Object events are a recent/capped object-scoped snapshot window.',
  },
  'modules/object-panel/components/ObjectPanel/Logs/ParsedLogTable.tsx': {
    kind: 'classified-table',
    mode: 'Local Partial',
    reason: 'Parsed logs are derived from the bounded object-panel log buffer.',
  },
} as const;

const DIRECT_USE_TABLE_SORT_EXCEPTIONS = {
  'modules/resource-grid/useGridTableBinding.ts': {
    kind: 'resource-grid-surface',
    mode: 'Inherited from resource-grid tableMode',
    reason: 'Shared adapter disables local sort when tableMode is query-backed.',
  },
  'modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx': {
    kind: 'classified-table',
    mode: 'Local Partial',
    reason: 'Direct GridTable exception above owns the object-event local window.',
  },
} as const;

const STATS_BACKED_LOCAL_PARTIAL_FILES = [
  'modules/namespace/components/NsViewAutoscaling.tsx',
  'modules/namespace/components/NsViewConfig.tsx',
  'modules/namespace/components/NsViewEvents.tsx',
  'modules/namespace/components/NsViewHelm.tsx',
  'modules/namespace/components/NsViewNetwork.tsx',
  'modules/namespace/components/NsViewQuotas.tsx',
  'modules/namespace/components/NsViewRBAC.tsx',
  'modules/namespace/components/NsViewStorage.tsx',
] as const;

/** Recursively find all .ts/.tsx files under `dir`. */
function walkSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, dist, and test fixtures.
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      results.push(...walkSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract viewId string literals from files that call one of the persistence hooks.
 *
 * Matches patterns like:
 *   viewId: 'some-view'
 *   viewId: "some-view"
 *
 * For dynamic viewIds (e.g. `viewId: resolvedViewId`), we trace the variable
 * assignment in the same file and extract any string literals from ternary or
 * nullish-coalescing expressions (covers the BrowseView pattern).
 */
function extractViewIds(sourceRoot: string): { viewId: string; file: string }[] {
  const files = walkSourceFiles(sourceRoot);
  const hookPattern =
    /useGridTablePersistence|useNamespaceGridTablePersistence|useClusterResourceGridTable|useNamespaceResourceGridTable|useQueryBackedNamespaceResourceGridTable|useQueryBackedClusterResourceGridTable|useObjectPanelResourceGridTable/;
  const staticViewIdPattern = /viewId:\s*['"]([^'"]+)['"]/g;
  const dynamicViewIdPattern = /viewId:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;

  const found: { viewId: string; file: string }[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(sourceRoot, filePath);
    if (
      relativePath.split(path.sep).join('/') === 'modules/resource-grid/useResourceGridTable.tsx' ||
      relativePath.split(path.sep).join('/') ===
        'modules/resource-grid/useQueryBackedResourceGridTable.ts'
    ) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!hookPattern.test(content)) continue;

    // Collect static viewId literals.
    for (const match of content.matchAll(staticViewIdPattern)) {
      found.push({ viewId: match[1], file: filePath });
    }

    // Collect dynamic viewIds by tracing the variable in the same file.
    for (const match of content.matchAll(dynamicViewIdPattern)) {
      const varName = match[1];
      // Look for string literals in the variable's assignment expression.
      // Covers patterns like: const resolvedViewId = viewId ?? (cond ? 'a' : 'b');
      const assignPattern = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*([^;]+);`);
      const assignMatch = content.match(assignPattern);
      if (assignMatch) {
        const expr = assignMatch[1];
        for (const litMatch of expr.matchAll(/['"]([^'"]+)['"]/g)) {
          found.push({ viewId: litMatch[1], file: filePath });
        }
      }
    }
  }

  return found;
}

function findResourceGridCallsMissingTableMode(sourceRoot: string): string[] {
  const files = walkSourceFiles(sourceRoot);
  const callPattern =
    /use(?:(?:Cluster|Namespace|ObjectPanel|Query)ResourceGridTable|QueryBacked(?:Namespace|Cluster)ResourceGridTable)(?:<[^>]+>)?\s*\(\s*\{[\s\S]*?\n\s*\}\s*\)/g;
  const missing: string[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(sourceRoot, filePath);
    if (
      relativePath.split(path.sep).join('/') === 'modules/resource-grid/useResourceGridTable.tsx' ||
      relativePath.split(path.sep).join('/') ===
        'modules/resource-grid/useQueryBackedResourceGridTable.ts'
    ) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const match of content.matchAll(callPattern)) {
      if (!/\b(?:tableMode|queryTableMode)\s*:/.test(match[0])) {
        missing.push(relativePath);
      }
    }
  }

  return [...new Set(missing)].sort();
}

function findResourceGridCallsWithoutRecognizedTableMode(sourceRoot: string): string[] {
  const files = walkSourceFiles(sourceRoot);
  const callPattern =
    /use(?:(?:Cluster|Namespace|ObjectPanel|Query)ResourceGridTable|QueryBacked(?:Namespace|Cluster)ResourceGridTable)(?:<[^>]+>)?\s*\(\s*\{[\s\S]*?\n\s*\}\s*\)/g;
  const invalid: string[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(sourceRoot, filePath);
    if (
      relativePath.split(path.sep).join('/') === 'modules/resource-grid/useResourceGridTable.tsx'
    ) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const match of content.matchAll(callPattern)) {
      if (
        /\b(?:tableMode|queryTableMode)\s*:/.test(match[0]) &&
        !TABLE_MODE_PATTERN.test(match[0])
      ) {
        invalid.push(relativePath);
      }
    }
  }

  return [...new Set(invalid)].sort();
}

function findProductionDirectGridTableUsages(sourceRoot: string): string[] {
  return walkSourceFiles(sourceRoot)
    .map((filePath) => path.relative(sourceRoot, filePath).split(path.sep).join('/'))
    .filter((relativePath) => !relativePath.startsWith('shared/components/tables/'))
    .filter((relativePath) => !relativePath.endsWith('.stories.tsx'))
    .filter((relativePath) => {
      const content = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf-8');
      return /<GridTable(?:<[^>]+>)?[\s>]/.test(content);
    })
    .filter(
      (relativePath) =>
        !Object.prototype.hasOwnProperty.call(DIRECT_GRIDTABLE_USAGE_EXCEPTIONS, relativePath)
    )
    .sort();
}

function findProductionDirectUseTableSortUsages(sourceRoot: string): string[] {
  return walkSourceFiles(sourceRoot)
    .map((filePath) => path.relative(sourceRoot, filePath).split(path.sep).join('/'))
    .filter((relativePath) => !relativePath.startsWith('hooks/'))
    .filter((relativePath) => {
      const content = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf-8');
      return /\buseTableSort\(/.test(content);
    })
    .filter(
      (relativePath) =>
        !Object.prototype.hasOwnProperty.call(DIRECT_USE_TABLE_SORT_EXCEPTIONS, relativePath)
    )
    .sort();
}

function findUnclassifiedDirectUsageExceptions(): string[] {
  const entries = [
    ...Object.entries(DIRECT_GRIDTABLE_USAGE_EXCEPTIONS),
    ...Object.entries(DIRECT_USE_TABLE_SORT_EXCEPTIONS),
  ];
  return entries
    .filter(([, exception]) => !exception.mode.trim() || !exception.reason.trim())
    .map(([file]) => file)
    .sort();
}

function findStatsBackedLocalPartialViewsMissingCopy(sourceRoot: string): string[] {
  return STATS_BACKED_LOCAL_PARTIAL_FILES.filter((relativePath) => {
    const content = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf-8');
    return (
      !/stats\?\s*:\s*SnapshotStats\s*\|\s*null/.test(content) ||
      !/\bbuildLocalPartialDataLabel\b/.test(content) ||
      !/\bpartialDataLabel\s*:/.test(content)
    );
  }).sort();
}

describe('gridTableViewRegistry contract', () => {
  const srcRoot = path.resolve(__dirname, '../../../../');
  const registered = new Set(listRegisteredGridTableViews());
  const usages = extractViewIds(srcRoot);

  it('finds at least one viewId usage (sanity check)', () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it('every viewId used in persistence hooks is registered', () => {
    const missing = usages.filter((u) => !registered.has(u.viewId));
    if (missing.length > 0) {
      const details = missing
        .map((m) => `  viewId "${m.viewId}" in ${path.relative(srcRoot, m.file)}`)
        .join('\n');
      throw new Error(
        `Found viewIds used in persistence hooks but missing from gridTableViewRegistry:\n${details}\n\n` +
          'Add them to the VIEW_IDS set in gridTableViewRegistry.ts.'
      );
    }
  });

  it('registry does not contain stale entries with no matching usage', () => {
    const usedIds = new Set(usages.map((u) => u.viewId));
    const stale = [...registered].filter((id) => !usedIds.has(id));
    if (stale.length > 0) {
      throw new Error(
        `Registry contains viewIds with no matching usage in source files:\n` +
          stale.map((id) => `  "${id}"`).join('\n') +
          '\n\nRemove them from gridTableViewRegistry.ts or add their usage.'
      );
    }
  });

  it('production resource-grid adapter calls declare tableMode', () => {
    const missing = findResourceGridCallsMissingTableMode(srcRoot);
    if (missing.length > 0) {
      throw new Error(
        `Found resource-grid adapter calls without tableMode:\n` +
          missing.map((file) => `  ${file}`).join('\n') +
          '\n\nAdd an explicit Local Complete, Local Partial, Query Backed Static, or Query Backed Dynamic mode.'
      );
    }
  });

  it('production resource-grid adapter tableMode values are recognized', () => {
    const invalid = findResourceGridCallsWithoutRecognizedTableMode(srcRoot);
    if (invalid.length > 0) {
      throw new Error(
        `Found resource-grid adapter calls with unrecognized tableMode:\n` +
          invalid.map((file) => `  ${file}`).join('\n') +
          '\n\nUse Local Complete, Local Partial, Query Backed Static, or Query Backed Dynamic.'
      );
    }
  });

  it('direct production GridTable usage is explicitly allowed', () => {
    const unexpected = findProductionDirectGridTableUsages(srcRoot);
    if (unexpected.length > 0) {
      throw new Error(
        `Found direct production GridTable usages without an explicit exception:\n` +
          unexpected.map((file) => `  ${file}`).join('\n') +
          '\n\nRoute resource tables through the resource-grid adapter with tableMode, or add a reviewed bounded/partial exception here.'
      );
    }
  });

  it('direct production useTableSort usage is explicitly allowed', () => {
    const unexpected = findProductionDirectUseTableSortUsages(srcRoot);
    if (unexpected.length > 0) {
      throw new Error(
        `Found direct production useTableSort usages without an explicit exception:\n` +
          unexpected.map((file) => `  ${file}`).join('\n') +
          '\n\nRoute resource tables through the resource-grid adapter tableMode path, or add a reviewed bounded/partial exception here.'
      );
    }
  });

  it('direct table bypass exceptions carry an explicit table-mode classification', () => {
    const unclassified = findUnclassifiedDirectUsageExceptions();
    if (unclassified.length > 0) {
      throw new Error(
        `Found direct GridTable/useTableSort exceptions without mode and reason:\n` +
          unclassified.map((file) => `  ${file}`).join('\n') +
          '\n\nEvery direct bypass must document whether it is an adapter shell, Local Complete, Local Partial, Query Backed Static, or Query Backed Dynamic.'
      );
    }
  });

  it('stats-backed Local Partial resource tables surface producer truncation copy', () => {
    const missing = findStatsBackedLocalPartialViewsMissingCopy(srcRoot);
    if (missing.length > 0) {
      throw new Error(
        `Found stats-backed Local Partial tables without SnapshotStats partial-state copy:\n` +
          missing.map((file) => `  ${file}`).join('\n') +
          '\n\nPass producer SnapshotStats into buildLocalPartialDataLabel and expose it as GridTable partialDataLabel.'
      );
    }
  });
});
