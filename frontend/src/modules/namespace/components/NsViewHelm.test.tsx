import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NsViewHelm, { type HelmData } from './NsViewHelm';

const state = vi.hoisted(() => ({
  columns: null as GridColumnDefinition<HelmData>[] | null,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a', selectedClusterName: 'cluster-a' }),
}));
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));
vi.mock('@shared/hooks/useObjectActionController', () => ({
  useObjectActionController: () => ({ getMenuItems: vi.fn(), modals: null }),
}));
vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({}),
}));
vi.mock('@/hooks/useShortNames', () => ({ useShortNames: () => false }));
vi.mock('@modules/resource-grid/ResourceInventoryTable', () => ({ default: () => null }));
vi.mock('@modules/resource-grid/useQueryBackedResourceGridTable', () => ({
  useQueryBackedNamespaceResourceGridTable: (params: {
    columns: GridColumnDefinition<HelmData>[];
  }) => {
    state.columns = params.columns;
    return { gridTableProps: {}, favModal: null, source: {} };
  },
}));

describe('NsViewHelm', () => {
  let host: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    state.columns = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = ReactDOM.createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('leads with the identity columns followed by Status in All Namespaces', async () => {
    await act(async () => {
      root.render(<NsViewHelm namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />);
    });

    expect(state.columns?.map((column) => column.key)).toEqual([
      'kind',
      'name',
      'namespace',
      'status',
      'chart',
      'appVersion',
      'revision',
      'updated',
      'description',
      'age',
    ]);
  });
});
