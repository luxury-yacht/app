/**
 * frontend/src/shared/components/tables/persistence/gridTableViewRegistry.contract.test.ts
 *
 * Contract test: every viewId passed to a grid table persistence hook must
 * exist in gridTableViewRegistry.
 *
 * This prevents registry drift — if a new view is added but its viewId is not
 * registered, GC will silently delete the persisted state for that view.
 */

import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareUtf16Strings } from '@/shared/utils/sort';
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
  'modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx': {
    kind: 'classified-table',
    mode: 'Local Partial',
    reason:
      'Object-scoped recent-events feed (Event resources). Its display lifecycle is now controller-owned (boundedRowsSource Local Partial + useResourceInventoryTable, so empty/loading/partial cannot regress into a false-empty); the direct GridTable is presentation-only — a bespoke no-filter, age-sorted activity feed, not a browsable resource inventory.',
  },
  'modules/object-panel/components/ObjectPanel/Logs/ParsedLogTable.tsx': {
    kind: 'classified-table',
    mode: 'Local Partial',
    reason:
      'Parsed container log lines — NOT a Kubernetes resource inventory. A bounded log buffer with log-line expansion behavior; legitimately not a resource table, so it stays direct.',
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
    reason:
      'Age-sorts the bespoke no-filter object-events feed (no filter bar / sort persistence). Lifecycle is controller-owned; this is presentation-only sort for the activity feed.',
  },
} as const;

// The only modules allowed to PRODUCE a ResourceInventorySourceState — the source
// that feeds ResourceInventoryTable. boundedRowsSource (bounded local) and
// backendQuerySource (catalog/typed query) are the two adapters; the typed-query
// wrapper consumes backendQuerySource rather than building its own shape.
// A new ad-hoc source shape outside this set is a bypass of the normalized source
// contract and must be reviewed before being added here.
const RESOURCE_INVENTORY_SOURCE_ADAPTERS = [
  'modules/resource-grid/backendQuerySource.ts',
  'modules/resource-grid/boundedRowsSource.ts',
] as const;

/** Recursively find all .ts/.tsx files under `dir`. */
function walkSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip transient/tooling directories and generated dependency/build trees.
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      results.push(...walkSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      results.push(full);
    }
  }
  return results;
}

describe('walkSourceFiles', () => {
  it('ignores dot-directories while retaining ordinary source directories', () => {
    const sourceRoot = fs.mkdtempSync(path.join(tmpdir(), 'gridtable-view-registry-'));
    const dotDirectory = path.join(sourceRoot, '.biome-boundary-probe');
    const ordinaryDirectory = path.join(sourceRoot, 'ordinary');
    const transientFile = path.join(dotDirectory, 'adversarial.ts');
    const ordinaryFile = path.join(ordinaryDirectory, 'view.ts');
    try {
      fs.mkdirSync(dotDirectory);
      fs.mkdirSync(ordinaryDirectory);
      fs.writeFileSync(transientFile, 'export {};');
      fs.writeFileSync(ordinaryFile, 'export {};');

      expect(walkSourceFiles(sourceRoot)).toEqual([ordinaryFile]);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

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
  // AggregatedResourceGridView is the shared skeleton the aggregated grid
  // views delegate to; a view rendering it declares its viewId in its spec.
  const hookPattern =
    /useGridTablePersistence|useNamespaceGridTablePersistence|useClusterResourceGridTable|useNamespaceResourceGridTable|useQueryBackedNamespaceResourceGridTable|useQueryBackedClusterResourceGridTable|useObjectPanelResourceGridTable|AggregatedResourceGridView/;
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
    if (!hookPattern.test(content)) {
      continue;
    }

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
    const normalized = relativePath.split(path.sep).join('/');
    // The resource-grid infra files build tableMode dynamically from
    // type-constrained inputs (`queryTableMode`/`localTableMode` are typed unions),
    // so their internal base-hook calls reference a variable, not a string
    // literal. This check is a heuristic for catching unrecognized mode literals
    // at view call sites; the infra files are validated by the type system and are
    // also excluded from findResourceGridCallsMissingTableMode.
    if (
      normalized === 'modules/resource-grid/useResourceGridTable.tsx' ||
      normalized === 'modules/resource-grid/useQueryBackedResourceGridTable.ts'
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
        Object.getOwnPropertyDescriptor(DIRECT_GRIDTABLE_USAGE_EXCEPTIONS, relativePath) ===
        undefined
    )
    .sort(compareUtf16Strings);
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
        Object.getOwnPropertyDescriptor(DIRECT_USE_TABLE_SORT_EXCEPTIONS, relativePath) ===
        undefined
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
    .sort(compareUtf16Strings);
}

// A stale exception — an allowlisted file that no longer uses what it was
// allowlisted for — is dangerous: it silently pre-authorizes a future direct
// GridTable/useTableSort re-introduction in that file without review. The
// allowlist must stay exact, so every entry has to still earn its place.
function findStaleDirectUsageExceptions(sourceRoot: string): string[] {
  const stale: string[] = [];
  const check = (files: string[], pattern: RegExp, label: string) => {
    for (const file of files) {
      const full = path.join(sourceRoot, file);
      if (!fs.existsSync(full) || !pattern.test(fs.readFileSync(full, 'utf-8'))) {
        stale.push(`${file} (${label})`);
      }
    }
  };
  check(
    Object.keys(DIRECT_GRIDTABLE_USAGE_EXCEPTIONS),
    /<GridTable(?:<[^>]+>)?[\s>]/,
    'DIRECT_GRIDTABLE_USAGE_EXCEPTIONS'
  );
  check(
    Object.keys(DIRECT_USE_TABLE_SORT_EXCEPTIONS),
    /\buseTableSort\(/,
    'DIRECT_USE_TABLE_SORT_EXCEPTIONS'
  );
  return stale.sort(compareUtf16Strings);
}

// A "source producer" returns a ResourceInventorySourceState — either an arrow
// whose body builds it (`...): ResourceInventorySourceState<T> => ({`) or an
// annotated return type. These are the resource-inventory source adapters.
function findResourceInventorySourceProducers(sourceRoot: string): string[] {
  return walkSourceFiles(sourceRoot)
    .map((filePath) => path.relative(sourceRoot, filePath).split(path.sep).join('/'))
    .filter((relativePath) => !/\.test\.tsx?$/.test(relativePath))
    .filter((relativePath) => {
      const content = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf-8');
      return /ResourceInventorySourceState<[A-Za-z]+>\s*=>|\):\s*ResourceInventorySourceState/.test(
        content
      );
    })
    .sort();
}

describe('gridTableViewRegistry contract', () => {
  const srcRoot = path.resolve(__dirname, '../../../../');
  const registered = new Set(listRegisteredGridTableViews());
  const usages = extractViewIds(srcRoot);

  it('covers gridTableViewRegistry contract scenarios', async () => {
    // Scenario: finds at least one viewId usage (sanity check)
    expect(usages.length).toBeGreaterThan(0);

    {
      // Scenario: every viewId used in persistence hooks is registered
      const missing = usages
        .filter((u) => !registered.has(u.viewId))
        .map((m) => `viewId "${m.viewId}" in ${path.relative(srcRoot, m.file)}`);

      expect(missing, 'Add them to the VIEW_IDS set in gridTableViewRegistry.ts.').toEqual([]);
    }

    {
      // Scenario: registry does not contain stale entries with no matching usage
      const usedIds = new Set(usages.map((u) => u.viewId));
      const stale = [...registered].filter((id) => !usedIds.has(id));

      expect(stale, 'Remove them from gridTableViewRegistry.ts or add their usage.').toEqual([]);
    }

    {
      // Scenario: production resource-grid adapter calls declare tableMode
      const missing = findResourceGridCallsMissingTableMode(srcRoot);

      expect(
        missing,
        'Add an explicit Local Complete, Local Partial, Query Backed Static, or Query Backed Dynamic mode.'
      ).toEqual([]);
    }

    {
      // Scenario: production resource-grid adapter tableMode values are recognized
      const invalid = findResourceGridCallsWithoutRecognizedTableMode(srcRoot);

      expect(
        invalid,
        'Use Local Complete, Local Partial, Query Backed Static, or Query Backed Dynamic.'
      ).toEqual([]);
    }

    {
      // Scenario: direct production GridTable usage is explicitly allowed
      const unexpected = findProductionDirectGridTableUsages(srcRoot);

      expect(
        unexpected,
        'Route resource tables through the resource-grid adapter with tableMode, or add a reviewed bounded/partial exception here.'
      ).toEqual([]);
    }

    {
      // Scenario: direct production useTableSort usage is explicitly allowed
      const unexpected = findProductionDirectUseTableSortUsages(srcRoot);

      expect(
        unexpected,
        'Route resource tables through the resource-grid adapter tableMode path, or add a reviewed bounded/partial exception here.'
      ).toEqual([]);
    }

    {
      // Scenario: direct table bypass exceptions carry an explicit table-mode classification
      const unclassified = findUnclassifiedDirectUsageExceptions();

      expect(
        unclassified,
        'Every direct bypass must document whether it is an adapter shell, Local Complete, Local Partial, Query Backed Static, or Query Backed Dynamic.'
      ).toEqual([]);
    }

    {
      // Scenario: direct table bypass exceptions are not stale (each file still uses what it is allowlisted for)
      const stale = findStaleDirectUsageExceptions(srcRoot);

      expect(
        stale,
        'Remove the stale exception so the allowlist stays exact — a stale entry silently ' +
          'pre-authorizes a future direct bypass in that file without review.'
      ).toEqual([]);
    }

    {
      // Scenario: only the sanctioned adapters produce a resource-inventory source
      const producers = findResourceInventorySourceProducers(srcRoot);
      const sanctioned = new Set<string>(RESOURCE_INVENTORY_SOURCE_ADAPTERS);
      const unexpected = producers.filter((file) => !sanctioned.has(file));

      expect(
        unexpected,
        'Resource inventory tables must source from boundedRowsSource or backendQuerySource. ' +
          'A new source shape must be reviewed and added to RESOURCE_INVENTORY_SOURCE_ADAPTERS deliberately.'
      ).toEqual([]);

      // The set must be exact in both directions — a sanctioned adapter that stops
      // producing a source is a stale allowlist entry.
      const noLongerProducing = RESOURCE_INVENTORY_SOURCE_ADAPTERS.filter(
        (file) => !producers.includes(file)
      );

      expect(
        noLongerProducing,
        'Sanctioned source adapters must still produce a ResourceInventorySourceState.'
      ).toEqual([]);
    }
  });
});
