/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/nodeShellCapability.test.tsx
 *
 * Node shell gating through the real capability hook and permission store; only
 * the backend permission read is faked.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryPayloadItem } from '@/core/capabilities/permissionRead';
import { __resetForTests } from '@/core/capabilities/permissionStore';
import { eventBus } from '@/core/events';
import { RESOURCE_CAPABILITIES } from '../constants';
import type { PanelObjectData } from '../types';
import { useObjectPanelCapabilities } from './useObjectPanelCapabilities';
import { useObjectPanelFeatureSupport } from './useObjectPanelFeatureSupport';

const hoisted = vi.hoisted(() => ({
  readQueryPermissions: vi.fn(),
}));

vi.mock('@/core/data-access', () => ({
  readQueryPermissions: (...args: unknown[]) => hoisted.readQueryPermissions(...args),
  requestData: async (options: { read: () => Promise<unknown> }) => ({
    status: 'executed',
    data: await options.read(),
  }),
}));

vi.mock('../NodeLogs/nodeLogsApi', () => ({
  discoverNodeLogs: async () => ({ supported: false, sources: [] }),
  getCachedNodeLogDiscovery: () => null,
}));

const node: PanelObjectData = {
  clusterId: 'cluster-a',
  group: '',
  version: 'v1',
  kind: 'Node',
  name: 'worker-1',
};

// Answers every check the way the cluster does for this user.
const answerPermissions = (isAllowed: (query: QueryPayloadItem) => boolean) => {
  hoisted.readQueryPermissions.mockImplementation(async (queries: QueryPayloadItem[]) => ({
    results: queries.map((query) => ({
      ...query,
      allowed: isAllowed(query),
      source: 'ssrr',
      reason: isAllowed(query) ? '' : `cannot ${query.verb} ${query.resourceKind}`,
      error: '',
    })),
    diagnostics: [],
  }));
};

describe('node shell capability', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const result: { current: ReturnType<typeof useObjectPanelCapabilities> | null } = {
    current: null,
  };

  const NodePanelHarness: React.FC = () => {
    const featureSupport = useObjectPanelFeatureSupport('node', RESOURCE_CAPABILITIES);
    result.current = useObjectPanelCapabilities({
      objectData: node,
      objectKind: 'node',
      detailScope: 'cluster-a|:/v1:node:worker-1',
      featureSupport,
    });
    return null;
  };

  const renderNodePanel = async () => {
    await act(async () => {
      root.render(<NodePanelHarness />);
    });
    // Let the permission reads resolve and the store publish.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    result.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    __resetForTests();
    eventBus.clear();
    hoisted.readQueryPermissions.mockReset();
  });

  // A user whose pod rights are limited to the debug pod namespace.
  const podsInDefault = (query: QueryPayloadItem) =>
    query.resourceKind !== 'Pod' || query.namespace === 'default';

  it('offers the shell on a node to a user who may manage pods in default', async () => {
    answerPermissions(podsInDefault);

    await renderNodePanel();

    expect(result.current?.capabilities.hasShell).toBe(true);
  });

  it.each(['create', 'get', 'delete'])(
    'withholds the shell when the user may not %s the debug pod',
    async (verb) => {
      answerPermissions(
        (query) => podsInDefault(query) && !(query.verb === verb && !query.subresource)
      );

      await renderNodePanel();

      expect(result.current?.capabilities.hasShell).toBe(false);
      expect(result.current?.capabilityReasons.shell).toBe(`cannot ${verb} Pod`);
    }
  );

  // Attach over a websocket upgrades a GET and over SPDY a POST; either suffices.
  it('offers the shell when only one attach verb is allowed', async () => {
    answerPermissions(
      (query) =>
        podsInDefault(query) && !(query.subresource === 'attach' && query.verb === 'create')
    );

    await renderNodePanel();

    expect(result.current?.capabilities.hasShell).toBe(true);
  });

  it('withholds the shell when the debug pod cannot be attached to', async () => {
    answerPermissions((query) => podsInDefault(query) && query.subresource !== 'attach');

    await renderNodePanel();

    expect(result.current?.capabilities.hasShell).toBe(false);
    expect(result.current?.capabilityReasons.shell).toBe('cannot get Pod');
  });
});
