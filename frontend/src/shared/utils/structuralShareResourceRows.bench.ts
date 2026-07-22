import { bench, describe } from 'vitest';
import type { CanonicalResourceRef } from '@/core/refresh/types';
import { structuralShareResourceRows } from './structuralShareResourceRows';

interface BenchmarkRow {
  ref: CanonicalResourceRef;
  status: string;
  labels: Record<string, string>;
  conditions: Array<{ type: string; status: string }>;
}

const rows = (count: number): BenchmarkRow[] =>
  Array.from({ length: count }, (_, index) => ({
    ref: {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'ConfigMap',
      resource: 'configmaps',
      namespace: `namespace-${index % 20}`,
      name: `config-${index}`,
      uid: `uid-${index}`,
    },
    status: 'Ready',
    labels: { app: `app-${index % 50}` },
    conditions: [{ type: 'Ready', status: 'True' }],
  }));

const staticPrevious = rows(1_000);
const staticIncoming = rows(1_000);
const dynamicPrevious = rows(1_000);
const dynamicIncoming = rows(1_000);

describe('1,000-row query-page structural sharing', () => {
  bench('static row-and-ref comparison', () => {
    structuralShareResourceRows(staticPrevious, staticIncoming, 'row-and-ref');
  });

  bench('dynamic ref-only comparison', () => {
    structuralShareResourceRows(dynamicPrevious, dynamicIncoming, 'ref-only');
  });
});
