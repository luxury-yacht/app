import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
import { describe, expect, it } from 'vitest';
import { normalizeHydratedCustomRow } from '@/modules/browse/hooks/customCatalogRowAdapter';
import fixtureDocument from '@/test-fixtures/canonical-resource-row-wire.json';
import { parseRefreshSnapshotValue } from './client';
import type { RefreshDomain } from './types';

type SnapshotFixtureEntry = {
  family: string;
  boundary: 'refresh-snapshot';
  domain: RefreshDomain;
  rowPath: string;
  snapshot: unknown;
};

type HydrationFixtureEntry = {
  family: 'custom-page-hydration';
  boundary: 'custom-hydration';
  row: unknown;
};

type FixtureEntry = SnapshotFixtureEntry | HydrationFixtureEntry;

type FixtureDocument = {
  entries: FixtureEntry[];
};

const fixture = fixtureDocument as FixtureDocument;

const valueAtPath = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      throw new Error(`Fixture path ${path} stopped before ${segment}`);
    }
    return (current as Record<string, unknown>)[segment];
  }, value);

describe('canonical resource row wire fixtures', () => {
  it('covers every inventoried producer family with a unique entry', () => {
    expect(fixture.entries).toHaveLength(24);
    expect(new Set(fixture.entries.map(({ family }) => family)).size).toBe(24);
  });

  it.each(fixture.entries)('$family survives its production frontend parse boundary', (entry) => {
    const row = (() => {
      if (entry.boundary === 'custom-hydration') {
        return normalizeHydratedCustomRow(entry.row) as unknown as Record<string, unknown>;
      }
      const snapshot = parseRefreshSnapshotValue<Record<string, unknown>>(
        entry.snapshot,
        entry.domain
      );
      const rows = valueAtPath(snapshot, entry.rowPath);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(1);
      return (rows as Array<Record<string, unknown>>)[0];
    })();
    const ref = row.ref as Record<string, unknown>;
    expect(typeof ref.clusterId).toBe('string');
    expect(typeof ref.group).toBe('string');
    expect(typeof ref.version).toBe('string');
    expect(typeof ref.kind).toBe('string');
    expect(typeof ref.resource).toBe('string');
    expect(typeof ref.name).toBe('string');
    expect(buildRequiredCanonicalObjectRowKey(ref)).toContain('cluster-wire');

    if (entry.boundary === 'custom-hydration') {
      expect(ref.namespace).toBe('');
    }
  });
});
