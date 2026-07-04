/**
 * frontend/src/core/settings/clusterAllowedNamespaces.test.ts
 *
 * Tests for the typed per-cluster namespace-scope accessors.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wailsjs/go/backend/App', () => ({
  GetClusterAllowedNamespaces: vi.fn(),
  SetClusterAllowedNamespaces: vi.fn(),
}));

import { GetClusterAllowedNamespaces, SetClusterAllowedNamespaces } from '@wailsjs/go/backend/App';
import {
  getClusterAllowedNamespaces,
  setClusterAllowedNamespaces,
} from './clusterAllowedNamespaces';

const getBinding = vi.mocked(GetClusterAllowedNamespaces);
const setBinding = vi.mocked(SetClusterAllowedNamespaces);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getClusterAllowedNamespaces', () => {
  it('returns the persisted scope for the cluster', async () => {
    getBinding.mockResolvedValue(['prod', 'dev']);

    await expect(getClusterAllowedNamespaces('kc:ctx')).resolves.toEqual(['prod', 'dev']);
    expect(getBinding).toHaveBeenCalledWith('kc:ctx');
  });

  it('normalizes a null backend response (unset scope) to an empty list', async () => {
    getBinding.mockResolvedValue(null as unknown as string[]);

    await expect(getClusterAllowedNamespaces('kc:ctx')).resolves.toEqual([]);
  });

  it('rejects an empty clusterId without calling the backend', async () => {
    await expect(getClusterAllowedNamespaces('')).rejects.toThrow(/clusterId/);
    expect(getBinding).not.toHaveBeenCalled();
  });
});

describe('setClusterAllowedNamespaces', () => {
  it('persists and returns the backend-normalized scope', async () => {
    setBinding.mockResolvedValue(['prod', 'dev']);

    await expect(setClusterAllowedNamespaces('kc:ctx', [' prod ', 'dev'])).resolves.toEqual([
      'prod',
      'dev',
    ]);
    expect(setBinding).toHaveBeenCalledWith('kc:ctx', [' prod ', 'dev']);
  });

  it('normalizes a null backend response (cleared scope) to an empty list', async () => {
    setBinding.mockResolvedValue(null as unknown as string[]);

    await expect(setClusterAllowedNamespaces('kc:ctx', [])).resolves.toEqual([]);
  });

  it('rejects an empty clusterId without calling the backend', async () => {
    await expect(setClusterAllowedNamespaces('', ['prod'])).rejects.toThrow(/clusterId/);
    expect(setBinding).not.toHaveBeenCalled();
  });

  it('propagates backend validation errors', async () => {
    setBinding.mockRejectedValue(new Error('invalid namespace name "Bad!"'));

    await expect(setClusterAllowedNamespaces('kc:ctx', ['Bad!'])).rejects.toThrow(
      'invalid namespace name "Bad!"'
    );
  });
});
