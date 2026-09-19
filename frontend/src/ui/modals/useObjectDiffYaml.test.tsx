import type { CatalogItem } from '@core/refresh/types';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useObjectDiffYaml } from './useObjectDiffYaml';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  request: vi.fn(),
  enable: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@core/refresh', () => ({ useRefreshScopedDomain: () => mocks.state }));
vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: mocks.request,
  setRefreshDomainEnabled: mocks.enable,
  resetRefreshDomain: mocks.reset,
}));

it('owns retained YAML and change tracking by complete identity in every render', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const item: CatalogItem = {
    ref: {
      clusterId: 'a',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'ns',
      name: 'app',
      uid: 'shared',
      resource: 'deployments',
    },
    resourceVersion: '1',
    creationTimestamp: '',
    scope: 'Namespace',
  };
  let current!: ReturnType<typeof useObjectDiffYaml>;
  const seen: string[] = [];
  function Consumer({ selection }: { selection: CatalogItem }) {
    current = useObjectDiffYaml(selection, true);
    seen.push(current.normalized);
    return null;
  }
  const render = (selection = item) => act(() => root.render(<Consumer selection={selection} />));
  try {
    mocks.state = { status: 'ready', data: { yaml: 'value: first' }, checksum: 'one' };
    render();
    expect(current.normalized).toContain('first');
    expect(current.changedAt).toBeNull();
    mocks.state = { status: 'ready', data: { yaml: 'value: second' }, checksum: 'two' };
    render();
    expect(current.normalized).toContain('second');
    expect(current.changedAt).not.toBeNull();
    mocks.state = { status: 'error', data: null, error: 'offline' };
    render();
    expect(current.normalized).toContain('second');
    expect(current.error).toBe('offline');
    mocks.state = { status: 'loading', data: null };
    seen.length = 0;
    const nextItem = { ...item, ref: { ...item.ref, clusterId: 'b' } };
    render(nextItem);
    expect(seen.every((text) => text === '')).toBe(true);
    expect(current.changedAt).toBeNull();
    mocks.state = { status: 'ready', data: { yaml: 'value: third' }, checksum: 'three' };
    render(nextItem);
    expect(current.normalized).toContain('third');
    expect(current.changedAt).toBeNull();
    mocks.state = { status: 'ready', data: { yaml: '' } };
    render(nextItem);
    expect(current.normalized).toBe('');
  } finally {
    act(() => root.unmount());
  }
});
