/**
 * frontend/src/ui/layout/namespaceScope.test.ts
 *
 * Tests for the sidebar namespace-scope editor logic
 * (docs/plans/namespace-scope.md).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/settings/clusterAllowedNamespaces', () => ({
  getClusterAllowedNamespaces: vi.fn(),
  setClusterAllowedNamespaces: vi.fn(),
}));
vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: vi.fn(),
}));

import {
  getClusterAllowedNamespaces,
  setClusterAllowedNamespaces,
} from '@/core/settings/clusterAllowedNamespaces';
import { requestRefreshDomain } from '@/core/data-access';
import {
  NAMESPACE_SCOPE_SOFT_WARNING_THRESHOLD,
  addNamespaceToScope,
  isValidNamespaceName,
  loadNamespaceScope,
  removeNamespaceFromScope,
  saveNamespaceScope,
} from './namespaceScope';

const getMock = vi.mocked(getClusterAllowedNamespaces);
const setMock = vi.mocked(setClusterAllowedNamespaces);
const refreshMock = vi.mocked(requestRefreshDomain);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isValidNamespaceName', () => {
  it('accepts DNS-1123 labels and rejects everything else', () => {
    expect(isValidNamespaceName('prod')).toBe(true);
    expect(isValidNamespaceName('team-a1')).toBe(true);
    expect(isValidNamespaceName('')).toBe(false);
    expect(isValidNamespaceName('Prod')).toBe(false);
    expect(isValidNamespaceName('-lead')).toBe(false);
    expect(isValidNamespaceName('trail-')).toBe(false);
    expect(isValidNamespaceName('has_underscore')).toBe(false);
    expect(isValidNamespaceName('a'.repeat(64))).toBe(false);
    expect(isValidNamespaceName('a'.repeat(63))).toBe(true);
  });
});

describe('scope list operations', () => {
  it('adds a trimmed name, rejecting duplicates and invalid names', () => {
    expect(addNamespaceToScope(['prod'], ' dev ')).toEqual({ next: ['prod', 'dev'] });
    expect(addNamespaceToScope(['prod'], 'prod').error).toMatch(/already/);
    expect(addNamespaceToScope(['prod'], 'Not Valid').error).toMatch(/lowercase/);
  });

  it('removes a name', () => {
    expect(removeNamespaceFromScope(['prod', 'dev'], 'prod')).toEqual(['dev']);
    expect(removeNamespaceFromScope(['prod'], 'absent')).toEqual(['prod']);
  });
});

describe('loadNamespaceScope', () => {
  it('reads the persisted scope for the cluster', async () => {
    getMock.mockResolvedValue(['prod']);
    await expect(loadNamespaceScope('kc:ctx')).resolves.toEqual(['prod']);
    expect(getMock).toHaveBeenCalledWith('kc:ctx');
  });

  it('returns an empty scope when no cluster is selected', async () => {
    await expect(loadNamespaceScope('')).resolves.toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('saveNamespaceScope', () => {
  it('persists and returns the normalized scope WITHOUT an immediate refetch', async () => {
    // The refetch must NOT fire here: the backend tears down and rebuilds the
    // cluster's subsystem for seconds after the save, so an immediate fetch
    // races the rebuild and caches the stale pre-rebuild snapshot. The
    // frontend converges on the backend's cluster:scope:changed event
    // instead (orchestrator + NamespaceContext listeners).
    setMock.mockResolvedValue(['prod', 'dev']);

    const result = await saveNamespaceScope('kc:ctx', ['prod', 'dev']);
    expect(result).toEqual(['prod', 'dev']);
    expect(setMock).toHaveBeenCalledWith('kc:ctx', ['prod', 'dev']);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('propagates backend validation errors', async () => {
    setMock.mockRejectedValue(new Error('invalid namespace name "Bad!"'));

    await expect(saveNamespaceScope('kc:ctx', ['Bad!'])).rejects.toThrow('invalid namespace');
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('soft warning threshold', () => {
  it('is a sane bound (watches scale with kinds × namespaces)', () => {
    expect(NAMESPACE_SCOPE_SOFT_WARNING_THRESHOLD).toBeGreaterThan(5);
    expect(NAMESPACE_SCOPE_SOFT_WARNING_THRESHOLD).toBeLessThanOrEqual(50);
  });
});
