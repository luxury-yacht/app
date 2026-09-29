/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelLogsCapability.test.tsx
 *
 * The Logs tab gate through the real capability path: the named `view-logs`
 * descriptor for a pod is answered by QueryPermissions, and the unnamed
 * Pod-level descriptor for a workload by the shared permission map.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionStatus } from '@/core/capabilities/permissionTypes';
import { requireValue } from '@/test-utils/requireValue';
import type { FeatureSupport, PanelObjectData } from '../types';
import { useObjectPanelCapabilities } from './useObjectPanelCapabilities';

type QueryItem = { id: string; name?: string; subresource?: string };

const backend = vi.hoisted(() => ({
  // Decides each QueryPermissions item; the default allows everything.
  allow: (_item: QueryItem): boolean => true,
  permissionMap: new Map<string, PermissionStatus>(),
}));

vi.mock('@core/backend-api', () => ({
  QueryPermissions: async (items: QueryItem[]) => ({
    results: items.map((item) => ({
      ...item,
      allowed: backend.allow(item),
      source: 'ssrr',
      reason: '',
      error: '',
    })),
  }),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  onEvent: () => () => undefined,
}));

vi.mock('@/core/contexts/ClusterLifecycleContext', () => ({
  useOptionalClusterLifecycle: () => undefined,
}));

vi.mock('@/core/capabilities/permissionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/capabilities/permissionStore')>();
  return {
    ...actual,
    subscribeUserPermissions: () => () => undefined,
    getUserPermissionMap: () => backend.permissionMap,
  };
});

vi.mock('../NodeLogs/nodeLogsApi', () => ({
  discoverNodeLogs: vi.fn(),
  getCachedNodeLogDiscovery: () => null,
}));

const featureSupport: FeatureSupport = {
  objPanelLogs: true,
  nodeLogs: false,
  manifest: false,
  values: false,
  delete: false,
  restart: false,
  scale: false,
  edit: false,
  shell: false,
  debug: false,
  trigger: false,
  suspend: false,
};

const pod: PanelObjectData = {
  kind: 'Pod',
  name: 'web-0',
  namespace: 'team-a',
  clusterId: 'cluster-a',
  group: '',
  version: 'v1',
};

describe('Logs tab gate', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let result: ReturnType<typeof useObjectPanelCapabilities> | null = null;

  const render = async (objectData: PanelObjectData, objectKind: string) => {
    const Harness: React.FC = () => {
      result = useObjectPanelCapabilities({
        objectData,
        objectKind,
        detailScope: `${objectData.clusterId}|${objectData.namespace}:${objectData.group}/${objectData.version}:${objectKind}:${objectData.name}`,
        featureSupport,
      });
      return null;
    };
    await act(async () => {
      root.render(<Harness />);
    });
    // Let the QueryPermissions round trip settle.
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    return requireValue(result, 'expected the capabilities hook to render').capabilities;
  };

  beforeEach(() => {
    backend.allow = () => true;
    backend.permissionMap = new Map();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    result = null;
  });

  it('shows the tab for a pod whose logs the user may read by name', async () => {
    backend.allow = (item) => item.subresource !== 'log' || item.name === 'web-0';

    expect((await render(pod, 'pod')).hasObjPanelLogs).toBe(true);
  });

  it('hides the tab once the named pod-logs check is denied', async () => {
    backend.allow = (item) => item.subresource !== 'log';

    expect((await render(pod, 'pod')).hasObjPanelLogs).toBe(false);
  });

  it('hides a workload tab when pod logs are denied in the namespace', async () => {
    const { getPermissionKey } = await import('@/core/capabilities/permissionStore');
    const key = getPermissionKey('Pod', 'get', 'team-a', 'log', 'cluster-a', '', 'v1');
    backend.permissionMap = new Map([
      [
        key,
        {
          id: key,
          allowed: false,
          pending: false,
          reason: 'forbidden',
          error: null,
          source: 'ssrr',
          descriptor: {
            clusterId: 'cluster-a',
            group: '',
            version: 'v1',
            resourceKind: 'Pod',
            verb: 'get',
            namespace: 'team-a',
            subresource: 'log',
          },
          entry: { status: 'ready' },
        },
      ],
    ]);

    const deployment: PanelObjectData = { ...pod, kind: 'Deployment', name: 'web', group: 'apps' };
    expect((await render(deployment, 'deployment')).hasObjPanelLogs).toBe(false);
  });
});
