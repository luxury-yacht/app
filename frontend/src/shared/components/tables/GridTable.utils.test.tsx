/**
 * frontend/src/shared/components/tables/GridTable.utils.test.tsx
 *
 * Test suite for GridTable.utils.
 * Covers key behaviors and edge cases for GridTable.utils.
 */

import { describe, expect, it } from 'vitest';

import {
  buildClusterScopedKey,
  DEFAULT_FONT_SIZE,
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
  detectWidthUnit,
  getTextContent,
  isFixedColumnKey,
  isKindColumnKey,
  normalizeKindClass,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';
import type { ColumnWidthInput } from '@shared/components/tables/GridTable.types';

describe('GridTable utils', () => {
  it('normalizes kind class names', () => {
    expect(normalizeKindClass('Deployment')).toBe('deployment');
    expect(normalizeKindClass('Custom Kind!')).toBe('customkind');
    expect(normalizeKindClass('')).toBe('kind');
  });

  it('detects fixed column keys', () => {
    expect(isKindColumnKey('kind')).toBe(true);
    expect(isKindColumnKey('type')).toBe(true);
    expect(isFixedColumnKey('age')).toBe(false);
    expect(isFixedColumnKey('name')).toBe(false);
  });

  it('extracts kind, namespace, and search text defaults', () => {
    const row = {
      name: 'pod-1',
      namespaceDisplay: 'kube-system',
      kindDisplay: 'Pod',
      item: { kind: 'Pod', namespace: 'kube-system', name: 'pod-1' },
    };
    expect(defaultGetKind(row)).toBe('Pod');
    expect(defaultGetNamespace(row)).toBe('kube-system');
    expect(defaultGetNamespace({ namespaceDisplay: '—' })).toBe('');

    const search = defaultGetSearchText(row);
    expect(search).toContain('pod-1');
    expect(search).toContain('kube-system');
    expect(search).toContain('Pod');
  });

  it('derives text content from React nodes', () => {
    expect(getTextContent('plain')).toBe('plain');
    expect(getTextContent(42)).toBe('42');
    expect(getTextContent(['a', 'b'])).toBe('ab');
    expect(getTextContent(<span title="fallback" />)).toBe('fallback');
    expect(getTextContent(<div>child</div>)).toBe('child');
  });

  it('parses and detects width inputs', () => {
    expect(detectWidthUnit(undefined)).toBe('px');
    expect(detectWidthUnit('50%')).toBe('%');
    expect(parseWidthInputToNumber(120)).toBe(120);
    expect(parseWidthInputToNumber('2em')).toBe(2 * DEFAULT_FONT_SIZE);
    expect(parseWidthInputToNumber('30px')).toBe(30);
    expect(parseWidthInputToNumber('auto')).toBeNull();
    const invalid = '10vh' as unknown as ColumnWidthInput;
    expect(parseWidthInputToNumber(invalid)).toBeNull();
  });

  it('builds cluster-scoped keys using clusterId only', () => {
    // With clusterId present, key is prefixed.
    expect(buildClusterScopedKey({ clusterId: 'alpha:dev' }, 'pod-1')).toBe('alpha:dev|pod-1');
    expect(buildClusterScopedKey({ item: { clusterId: 'beta:prod' } }, 'svc-1')).toBe(
      'beta:prod|svc-1'
    );
  });

  it('throws when clusterId is missing', () => {
    // Without clusterId, buildClusterScopedKey throws to prevent silent key
    // collisions in multi-cluster views.
    expect(() => buildClusterScopedKey({ clusterName: 'dev' }, 'pod-1')).toThrow(
      /requires clusterId/
    );
    expect(() => buildClusterScopedKey({ item: { clusterName: 'prod' } }, 'svc-1')).toThrow(
      /requires clusterId/
    );
    expect(() => buildClusterScopedKey({}, 'deploy-1')).toThrow(/requires clusterId/);
    expect(() => buildClusterScopedKey(null, 'job-1')).toThrow(/requires clusterId/);
  });

  it('produces different keys for same name in different clusters', () => {
    const rowA = { clusterId: 'cluster-a', name: 'app' };
    const rowB = { clusterId: 'cluster-b', name: 'app' };
    const keyA = buildClusterScopedKey(rowA, 'app');
    const keyB = buildClusterScopedKey(rowB, 'app');
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('cluster-a|app');
    expect(keyB).toBe('cluster-b|app');
  });
});
