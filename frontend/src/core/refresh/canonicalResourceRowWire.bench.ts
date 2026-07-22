import { structuralShareResourceRows } from '@shared/utils/structuralShareResourceRows';
import { bench, describe } from 'vitest';
import fixtureDocument from '@/test-fixtures/canonical-resource-row-wire.json';
import { parseRefreshSnapshotValue } from './client';
import type { CanonicalResourceRef, RefreshDomain } from './types';

type ResourceRow = { ref: CanonicalResourceRef } & Record<string, unknown>;
type SnapshotEntry = {
  family: string;
  boundary: 'refresh-snapshot';
  domain: RefreshDomain;
  rowPath: string;
  snapshot: Record<string, unknown>;
};

const entries = (
  fixtureDocument as {
    entries: Array<SnapshotEntry | { family: string; boundary: 'custom-hydration' }>;
  }
).entries;

const snapshotEntry = (family: string): SnapshotEntry => {
  const entry = entries.find((candidate) => candidate.family === family);
  if (entry?.boundary !== 'refresh-snapshot') {
    throw new Error(`Missing refresh snapshot fixture for ${family}`);
  }
  return entry;
};

const rowArray = (snapshot: Record<string, unknown>, rowPath: string): ResourceRow[] => {
  const value = rowPath.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      throw new Error(`Invalid fixture row path ${rowPath}`);
    }
    return (current as Record<string, unknown>)[segment];
  }, snapshot);
  if (!Array.isArray(value)) {
    throw new Error(`Fixture path ${rowPath} is not an array`);
  }
  return value as ResourceRow[];
};

const scaledSnapshotWire = (
  family: string,
  count: number
): { entry: SnapshotEntry; wire: string } => {
  const entry = snapshotEntry(family);
  const snapshot = structuredClone(entry.snapshot);
  const rows = rowArray(snapshot, entry.rowPath);
  const seed = rows[0];
  rows.splice(
    0,
    rows.length,
    ...Array.from({ length: count }, (_, index) => ({
      ...structuredClone(seed),
      ref: {
        ...seed.ref,
        name: `${seed.ref.name}-${index}`,
        uid: seed.ref.uid ? `${seed.ref.uid}-${index}` : undefined,
      },
    }))
  );
  return { entry, wire: JSON.stringify(snapshot) };
};

const staticPage = scaledSnapshotWire('catalog', 1_000);
const dynamicPage = scaledSnapshotWire('nodes', 1_000);
const staticPrevious = rowArray(
  parseRefreshSnapshotValue<Record<string, unknown>>(
    JSON.parse(staticPage.wire),
    staticPage.entry.domain
  ) as unknown as Record<string, unknown>,
  staticPage.entry.rowPath
);
const dynamicPrevious = rowArray(
  parseRefreshSnapshotValue<Record<string, unknown>>(
    JSON.parse(dynamicPage.wire),
    dynamicPage.entry.domain
  ) as unknown as Record<string, unknown>,
  dynamicPage.entry.rowPath
);

describe('1,000-row Go-seeded wire parse and apply', () => {
  bench('static JSON parse and envelope validation', () => {
    parseRefreshSnapshotValue(JSON.parse(staticPage.wire), staticPage.entry.domain);
  });

  bench('static parse, validation, and whole-row sharing', () => {
    const parsed = parseRefreshSnapshotValue<Record<string, unknown>>(
      JSON.parse(staticPage.wire),
      staticPage.entry.domain
    );
    structuralShareResourceRows(
      staticPrevious,
      rowArray(parsed as unknown as Record<string, unknown>, staticPage.entry.rowPath),
      'row-and-ref'
    );
  });

  bench('dynamic parse, validation, and ref-only sharing', () => {
    const parsed = parseRefreshSnapshotValue<Record<string, unknown>>(
      JSON.parse(dynamicPage.wire),
      dynamicPage.entry.domain
    );
    structuralShareResourceRows(
      dynamicPrevious,
      rowArray(parsed as unknown as Record<string, unknown>, dynamicPage.entry.rowPath),
      'ref-only'
    );
  });
});
