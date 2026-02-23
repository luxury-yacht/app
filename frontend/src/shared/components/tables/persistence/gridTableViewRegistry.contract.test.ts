/**
 * frontend/src/shared/components/tables/persistence/gridTableViewRegistry.contract.test.ts
 *
 * Contract test: every viewId passed to useGridTablePersistence or
 * useNamespaceGridTablePersistence must exist in gridTableViewRegistry.
 *
 * This prevents registry drift — if a new view is added but its viewId is not
 * registered, GC will silently delete the persisted state for that view.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { listRegisteredGridTableViews } from './gridTableViewRegistry';

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
  const hookPattern = /useGridTablePersistence|useNamespaceGridTablePersistence/;
  const staticViewIdPattern = /viewId:\s*['"]([^'"]+)['"]/g;
  const dynamicViewIdPattern = /viewId:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;

  const found: { viewId: string; file: string }[] = [];

  for (const filePath of files) {
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
      const assignPattern = new RegExp(
        `(?:const|let|var)\\s+${varName}\\s*=\\s*([^;]+);`
      );
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
});
