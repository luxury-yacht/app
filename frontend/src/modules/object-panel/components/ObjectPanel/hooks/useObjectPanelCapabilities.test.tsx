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

vi.mock('@/core/capabilities', () => ({
  useCapabilities: (...args: unknown[]) => mockUseCapabilities(...args),
  useUserPermission: (...args: unknown[]) => mockUseUserPermission(...(args as [])),
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
    });

    return resultRef.current!;
  };

  const baseFeatureSupport: FeatureSupport = {
    logs: true,
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

  const workloadKindApiNames = {
    deployment: 'Deployment',
    daemonset: 'DaemonSet',
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
      workloadKindApiNames,
    });

    expect(mockUseCapabilities).toHaveBeenCalledTimes(1);
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
      workloadKindApiNames,
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
      workloadKindApiNames,
    });

    expect(result.capabilities).toEqual({
      hasLogs: false,
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
      'shell-exec': { allowed: true, pending: false },
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
      workloadKindApiNames,
    });

    expect(result.capabilities.hasShell).toBe(true);
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
      workloadKindApiNames,
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
      workloadKindApiNames,
    });

    expect(result.capabilityStates.debug.allowed).toBe(true);
    expect(result.capabilityReasons.debug).toBeUndefined();
  });
});
