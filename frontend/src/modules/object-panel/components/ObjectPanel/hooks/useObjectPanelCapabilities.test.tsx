/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureSupport, PanelObjectData } from '../types';
import { useObjectPanelCapabilities } from './useObjectPanelCapabilities';

const mockUseCapabilities = vi.fn();
const mockUseUserPermission = vi.fn();
const mockDiscoverNodeLogs = vi.fn();
const mockGetCachedNodeLogDiscovery = vi.fn();

vi.mock('@/core/capabilities', () => ({
  useCapabilities: (...args: unknown[]) => mockUseCapabilities(...args),
  useUserPermission: (...args: unknown[]) => mockUseUserPermission(...(args as [])),
}));

vi.mock('../NodeLogs/nodeLogsApi', () => ({
  discoverNodeLogs: (...args: unknown[]) => mockDiscoverNodeLogs(...args),
  getCachedNodeLogDiscovery: (...args: unknown[]) => mockGetCachedNodeLogDiscovery(...args),
}));

type HookProps = Parameters<typeof useObjectPanelCapabilities>[0];
type HookResult = ReturnType<typeof useObjectPanelCapabilities>;

describe('useObjectPanelCapabilities', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: HookResult | null } = { current: null };

  const renderHook = async (props: HookProps) => {
    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelCapabilities(props);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    return resultRef.current!;
  };

  const baseFeatureSupport: FeatureSupport = {
    logs: true,
    nodeLogs: false,
    manifest: false,
    values: false,
    delete: true,
    restart: true,
    scale: true,
    edit: true,
    shell: false,
    debug: false,
    trigger: false,
    suspend: false,
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
    mockUseCapabilities.mockReset();
    mockUseUserPermission.mockReset();
    mockDiscoverNodeLogs.mockReset();
    mockGetCachedNodeLogDiscovery.mockReset();
    mockGetCachedNodeLogDiscovery.mockReturnValue(null);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('computes capability flags and reasons using descriptor responses', async () => {
    const capabilityStateMap: Record<
      string,
      { allowed: boolean; pending: boolean; reason?: string }
    > = {
      delete: { allowed: true, pending: false },
      restart: { allowed: true, pending: false },
      scale: { allowed: false, pending: false, reason: 'forbidden' },
      'edit-yaml': { allowed: false, pending: false, reason: 'locked' },
      'view-logs': { allowed: true, pending: false },
      'view-yaml': { allowed: true, pending: false },
      'view-manifest': { allowed: false, pending: false },
      'view-values': { allowed: false, pending: false },
    };

    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
    }));
    mockUseUserPermission.mockReturnValue({ allowed: true, pending: false });

    const objectData: PanelObjectData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
    };

    const result = await renderHook({
      objectData,
      objectKind: 'deployment',
      detailScope: 'team-a:deployment:api',
      featureSupport: baseFeatureSupport,
    });

    expect(mockUseCapabilities).toHaveBeenCalled();
    const [descriptors] = mockUseCapabilities.mock.calls[0];
    const descriptorIds = (descriptors as Array<{ id: string }>).map((d) => d.id);
    expect(descriptorIds).toEqual(
      expect.arrayContaining(['view-yaml', 'edit-yaml', 'view-logs', 'delete', 'restart', 'scale'])
    );

    expect(result.capabilities.canDelete).toBe(true);
    expect(result.capabilities.canScale).toBe(false);
    expect(result.capabilityReasons.scale).toBe('forbidden');
    expect(result.capabilityReasons.editYaml).toBe('locked');
  });

  it('disables logs when the user lacks log permissions', async () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: () => ({ allowed: true, pending: false }),
    }));
    mockUseUserPermission.mockReturnValue({ allowed: false, pending: false });

    const result = await renderHook({
      objectData: { kind: 'Deployment', name: 'api', namespace: 'team-a' },
      objectKind: 'deployment',
      detailScope: 'team-a:deployment:api',
      featureSupport: baseFeatureSupport,
    });

    expect(result.capabilities.hasLogs).toBe(false);
  });

  it('returns default states when descriptors are unavailable', async () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: () => ({ allowed: false, pending: false }),
    }));
    mockUseUserPermission.mockReturnValue({ allowed: true, pending: false });

    const result = await renderHook({
      objectData: null,
      objectKind: null,
      detailScope: null,
      featureSupport: {
        logs: false,
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
      },
    });

    expect(result.capabilities).toEqual({
      hasLogs: false,
      hasNodeLogs: false,
      hasShell: false,
      hasManifest: false,
      hasValues: false,
      canDelete: false,
      canRestart: false,
      canScale: false,
      canEditYaml: false,
      canTrigger: false,
      canSuspend: false,
    });
    expect(result.capabilityReasons).toEqual({
      nodeLogs: undefined,
      delete: undefined,
      restart: undefined,
      scale: undefined,
      editYaml: undefined,
      shell: undefined,
      debug: undefined,
    });
  });

  it('enables shell capability when descriptors allow access', async () => {
    const capabilityStateMap: Record<string, { allowed: boolean; pending: boolean }> = {
      'shell-exec-create': { allowed: true, pending: false },
    };

    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
    }));
    mockUseUserPermission.mockReturnValue({ allowed: true, pending: false });

    const result = await renderHook({
      objectData: { kind: 'Pod', name: 'api-123', namespace: 'team-a' },
      objectKind: 'pod',
      detailScope: 'team-a:pod:api-123',
      featureSupport: { ...baseFeatureSupport, shell: true },
    });

    expect(result.capabilities.hasShell).toBe(true);
  });

  it('enables shell capability when websocket exec GET is allowed but create is denied', async () => {
    const capabilityStateMap: Record<
      string,
      { allowed: boolean; pending: boolean; reason?: string }
    > = {
      'shell-exec-get': { allowed: true, pending: false },
      'shell-exec-create': {
        allowed: false,
        pending: false,
        reason: 'EKS Access Policy: denied create pods/exec',
      },
    };

    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
    }));
    mockUseUserPermission.mockReturnValue({ allowed: true, pending: false });

    const result = await renderHook({
      objectData: { kind: 'Pod', name: 'api-123', namespace: 'team-a', clusterId: 'c1' },
      objectKind: 'pod',
      detailScope: 'team-a:pod:api-123',
      featureSupport: { ...baseFeatureSupport, shell: true },
    });

    expect(result.capabilities.hasShell).toBe(true);
    expect(result.capabilityStates.shell.allowed).toBe(true);
    expect(result.capabilityReasons.shell).toBeUndefined();
  });

  it('surfaces shell denial only when both exec verbs are denied', async () => {
    const capabilityStateMap: Record<
      string,
      { allowed: boolean; pending: boolean; reason?: string }
    > = {
      'shell-exec-get': {
        allowed: false,
        pending: false,
        reason: 'Forbidden: get pods/exec',
      },
      'shell-exec-create': {
        allowed: false,
        pending: false,
        reason: 'Forbidden: create pods/exec',
      },
    };

    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
    }));
    mockUseUserPermission.mockReturnValue({ allowed: true, pending: false });

    const result = await renderHook({
      objectData: { kind: 'Pod', name: 'api-123', namespace: 'team-a', clusterId: 'c1' },
      objectKind: 'pod',
      detailScope: 'team-a:pod:api-123',
      featureSupport: { ...baseFeatureSupport, shell: true },
    });

    expect(result.capabilities.hasShell).toBe(false);
    expect(result.capabilityReasons.shell).toBe('Forbidden: get pods/exec');
  });

  it('surfaces debug-denied reason when ephemeralcontainers permission is denied', async () => {
    const capabilityStateMap: Record<
      string,
      { allowed: boolean; pending: boolean; reason?: string }
    > = {
      'debug-ephemeral': {
        allowed: false,
        pending: false,
        reason: 'Forbidden: pods/ephemeralcontainers',
      },
    };

    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
    }));
    mockUseUserPermission.mockReturnValue(null);

    const result = await renderHook({
      objectData: { kind: 'Pod', name: 'demo', namespace: 'team-a', clusterId: 'c1' },
      objectKind: 'pod',
      detailScope: 'team-a:pod:demo',
      featureSupport: { ...baseFeatureSupport, shell: true, debug: true },
    });

    expect(result.capabilityStates.debug.allowed).toBe(false);
    expect(result.capabilityReasons.debug).toBe('Forbidden: pods/ephemeralcontainers');
  });

  it('allows debug when ephemeralcontainers permission is granted', async () => {
    const capabilityStateMap: Record<string, { allowed: boolean; pending: boolean }> = {
      'debug-ephemeral': { allowed: true, pending: false },
    };

    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
    }));
    mockUseUserPermission.mockReturnValue(null);

    const result = await renderHook({
      objectData: { kind: 'Pod', name: 'demo', namespace: 'team-a', clusterId: 'c1' },
      objectKind: 'pod',
      detailScope: 'team-a:pod:demo',
      featureSupport: { ...baseFeatureSupport, shell: true, debug: true },
    });

    expect(result.capabilityStates.debug.allowed).toBe(true);
    expect(result.capabilityReasons.debug).toBeUndefined();
  });

  it('does not surface a debug disabled reason when permission is allowed with an EKS reason', async () => {
    const capabilityStateMap: Record<
      string,
      { allowed: boolean; pending: boolean; reason?: string }
    > = {
      'debug-ephemeral': {
        allowed: true,
        pending: false,
        reason: 'EKS Access Policy: allowed by ClusterRoleBinding "example"',
      },
    };

    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
    }));
    mockUseUserPermission.mockReturnValue(null);

    const result = await renderHook({
      objectData: { kind: 'Pod', name: 'demo', namespace: 'team-a', clusterId: 'c1' },
      objectKind: 'pod',
      detailScope: 'team-a:pod:demo',
      featureSupport: { ...baseFeatureSupport, shell: true, debug: true },
    });

    expect(result.capabilityStates.debug.allowed).toBe(true);
    expect(result.capabilityReasons.debug).toBeUndefined();
  });

  it('enables node logs when discovery returns readable sources', async () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: () => ({ allowed: false, pending: false }),
    }));
    mockUseUserPermission.mockReturnValue({ allowed: true, pending: true });
    mockDiscoverNodeLogs.mockResolvedValue({
      supported: true,
      sources: [
        {
          id: 'journal/kubelet',
          label: 'journal / kubelet',
          kind: 'journal',
          path: 'journal/kubelet',
        },
      ],
    });

    const result = await renderHook({
      objectData: { kind: 'Node', name: 'node-a', clusterId: 'c1' },
      objectKind: 'node',
      detailScope: 'node:node-a',
      featureSupport: { ...baseFeatureSupport, logs: false, nodeLogs: true },
    });

    expect(mockDiscoverNodeLogs).toHaveBeenCalledWith('c1', 'node-a');
    expect(result.capabilities.hasNodeLogs).toBe(true);
    expect(result.capabilities.hasLogs).toBe(true);
    expect(result.nodeLogSources).toEqual([
      {
        id: 'journal/kubelet',
        label: 'journal / kubelet',
        kind: 'journal',
        path: 'journal/kubelet',
      },
    ]);
    expect(result.capabilityReasons.nodeLogs).toBeUndefined();
  });

  it('reuses cached node log discovery results for the same node', async () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: () => ({ allowed: false, pending: false }),
    }));
    mockUseUserPermission.mockReturnValue({ allowed: false, pending: true });
    mockGetCachedNodeLogDiscovery.mockReturnValue({
      supported: true,
      sources: [
        {
          id: 'journal/kubelet',
          label: 'journal / kubelet',
          kind: 'journal',
          path: 'journal/kubelet',
        },
      ],
    });

    const result = await renderHook({
      objectData: { kind: 'Node', name: 'node-a', clusterId: 'c1' },
      objectKind: 'node',
      detailScope: 'node:node-a',
      featureSupport: { ...baseFeatureSupport, logs: false, nodeLogs: true },
    });

    expect(mockGetCachedNodeLogDiscovery).toHaveBeenCalledWith('c1', 'node-a');
    expect(mockDiscoverNodeLogs).not.toHaveBeenCalled();
    expect(result.capabilities.hasNodeLogs).toBe(true);
    expect(result.nodeLogSources).toHaveLength(1);
  });

  it('does not leak cached node log discovery across cluster switches', async () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: () => ({ allowed: false, pending: false }),
    }));
    mockUseUserPermission.mockImplementation(() => ({ allowed: true, pending: false }));
    mockGetCachedNodeLogDiscovery.mockImplementation((clusterId: string, nodeName: string) => {
      if (clusterId === 'c1' && nodeName === 'node-a') {
        return {
          supported: true,
          sources: [
            {
              id: 'journal/kubelet',
              label: 'journal / kubelet',
              kind: 'journal',
              path: 'journal/kubelet',
            },
          ],
        };
      }
      return null;
    });
    mockDiscoverNodeLogs.mockResolvedValue({
      supported: true,
      sources: [
        {
          id: 'journal/containerd',
          label: 'journal / containerd',
          kind: 'journal',
          path: 'journal/containerd',
        },
      ],
    });

    const first = await renderHook({
      objectData: { kind: 'Node', name: 'node-a', clusterId: 'c1' },
      objectKind: 'node',
      detailScope: 'node:node-a:c1',
      featureSupport: { ...baseFeatureSupport, logs: false, nodeLogs: true },
    });

    expect(first.nodeLogSources[0]?.path).toBe('journal/kubelet');
    expect(mockDiscoverNodeLogs).not.toHaveBeenCalled();

    const second = await renderHook({
      objectData: { kind: 'Node', name: 'node-a', clusterId: 'c2' },
      objectKind: 'node',
      detailScope: 'node:node-a:c2',
      featureSupport: { ...baseFeatureSupport, logs: false, nodeLogs: true },
    });

    expect(mockGetCachedNodeLogDiscovery).toHaveBeenCalledWith('c2', 'node-a');
    expect(mockDiscoverNodeLogs).toHaveBeenCalledWith('c2', 'node-a');
    expect(second.nodeLogSources[0]?.path).toBe('journal/containerd');
  });

  it('surfaces a node logs reason when discovery finds no readable sources', async () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: () => ({ allowed: false, pending: false }),
    }));
    mockUseUserPermission.mockReturnValue({ allowed: false, pending: true });
    mockDiscoverNodeLogs.mockResolvedValue({
      supported: false,
      sources: [],
      reason: 'node logs are not supported on this cluster',
    });

    const result = await renderHook({
      objectData: { kind: 'Node', name: 'node-a', clusterId: 'c1' },
      objectKind: 'node',
      detailScope: 'node:node-a',
      featureSupport: { ...baseFeatureSupport, logs: false, nodeLogs: true },
    });

    expect(result.capabilities.hasNodeLogs).toBe(false);
    expect(result.capabilities.hasLogs).toBe(true);
    expect(result.nodeLogSources).toEqual([]);
    expect(result.capabilityReasons.nodeLogs).toBe('node logs are not supported on this cluster');
  });
});
