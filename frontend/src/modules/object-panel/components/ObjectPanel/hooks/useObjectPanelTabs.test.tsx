/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs';
import type {
  PanelAction,
  PanelObjectData,
  ViewType,
  ComputedCapabilities,
} from '@modules/object-panel/components/ObjectPanel/types';

const hoistedShortcuts = vi.hoisted(() => ({
  useShortcut: vi.fn(),
  useShortcuts: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => hoistedShortcuts.useShortcut(...args),
  useShortcuts: (...args: unknown[]) => hoistedShortcuts.useShortcuts(...args),
  useSearchShortcutTarget: () => undefined,
}));

describe('useObjectPanelTabs', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: ReturnType<typeof useObjectPanelTabs> | null } = { current: null };
  const dispatchMock = vi.fn();
  const setActiveTabMock = vi.fn();

  const baseCapabilities: ComputedCapabilities = {
    hasObjPanelLogs: true,
    hasNodeLogs: false,
    hasShell: false,
    hasManifest: false,
    hasValues: false,
    canDelete: true,
    canRestart: true,
    canScale: true,
    canEditYaml: true,
    canTrigger: false,
    canSuspend: false,
  };

  const objectData: PanelObjectData = {
    kind: 'Deployment',
    name: 'api',
    namespace: 'team-a',
  };

  const renderHook = async (
    props?: Partial<Parameters<typeof useObjectPanelTabs>[0]>
  ): Promise<ReturnType<typeof useObjectPanelTabs>> => {
    const finalProps = {
      capabilities: baseCapabilities,
      objectData,
      isHelmRelease: false,
      isEvent: false,
      isOpen: true,
      setActiveTab: setActiveTabMock,
      dispatch: dispatchMock as React.Dispatch<PanelAction>,
      currentTab: 'details' as ViewType,
      ...props,
    } satisfies Parameters<typeof useObjectPanelTabs>[0];

    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelTabs(finalProps);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    return resultRef.current!;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
    dispatchMock.mockClear();
    setActiveTabMock.mockClear();
    hoistedShortcuts.useShortcut.mockClear();
    hoistedShortcuts.useShortcuts.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('returns workload tabs excluding manifest/values for non-Helm resources', async () => {
    const { availableTabs } = await renderHook();
    const labels = availableTabs.map((tab) => tab.label);
    expect(labels).toEqual(['Details', 'Pods', 'Logs', 'Events', 'YAML']);
  });

  it('omits the Shell tab when capability is disabled', async () => {
    const { availableTabs } = await renderHook({
      objectData: { kind: 'Pod', name: 'api-123', namespace: 'team-a' },
    });
    expect(availableTabs.map((tab) => tab.label)).toEqual(['Details', 'Logs', 'Events', 'YAML']);
  });

  it('includes the Shell tab for pods when capability is available', async () => {
    const { availableTabs } = await renderHook({
      objectData: { kind: 'Pod', name: 'api-123', namespace: 'team-a' },
      capabilities: { ...baseCapabilities, hasShell: true },
    });
    expect(availableTabs.map((tab) => tab.label)).toEqual([
      'Details',
      'Logs',
      'Events',
      'YAML',
      'Shell',
    ]);
  });

  it('includes manifest/values and omits events/yaml for Helm releases', async () => {
    const { availableTabs } = await renderHook({
      isHelmRelease: true,
      capabilities: { ...baseCapabilities, hasManifest: true, hasValues: true },
    });
    const labels = availableTabs.map((tab) => tab.label);
    expect(labels).toEqual(['Details', 'Logs', 'Manifest', 'Values']);
  });

  it('hides events and YAML tabs for Event objects', async () => {
    const { availableTabs } = await renderHook({
      isEvent: true,
      objectData: { kind: 'Event', name: 'warning', namespace: 'team-a' },
    });
    const labels = availableTabs.map((tab) => tab.label);
    expect(labels).toEqual(['Details', 'Logs']);
  });

  it('adds the Maintenance tab for node objects', async () => {
    const { availableTabs } = await renderHook({
      objectData: { kind: 'Node', name: 'node-1' },
      capabilities: { ...baseCapabilities, hasObjPanelLogs: false },
    });
    expect(availableTabs.map((tab) => tab.label)).toEqual([
      'Details',
      'Pods',
      'Events',
      'YAML',
      'Maintenance',
    ]);
  });

  it('uses the Logs tab for node objects rather than a separate node logs tab', async () => {
    const { availableTabs } = await renderHook({
      objectData: { kind: 'Node', name: 'node-1' },
      capabilities: { ...baseCapabilities, hasObjPanelLogs: true, hasNodeLogs: false },
    });
    expect(availableTabs.map((tab) => tab.label)).toEqual([
      'Details',
      'Pods',
      'Logs',
      'Events',
      'YAML',
      'Maintenance',
    ]);
  });

  it('falls back to details when the active tab becomes unavailable', async () => {
    await renderHook({
      currentTab: 'logs',
      capabilities: { ...baseCapabilities, hasObjPanelLogs: false },
    });
    expect(setActiveTabMock).toHaveBeenCalledWith('details');
  });

  it('registers position-based shortcut keys matching visible tab order', async () => {
    await renderHook();

    // Escape closes the dockable object tab, not the inner Details/YAML/etc. tabs.
    expect(hoistedShortcuts.useShortcut).not.toHaveBeenCalled();

    // Tab shortcuts registered via useShortcuts (plural), keyed by position.
    // Deployment tabs: Details, Pods, Logs, Events, YAML → keys 1–5.
    const tabShortcuts = hoistedShortcuts.useShortcuts.mock.calls[0]?.[0] as
      | Array<{ key: string; description: string }>
      | undefined;
    expect(tabShortcuts?.map((s) => s.key)).toEqual(['1', '2', '3', '4', '5']);
    expect(tabShortcuts?.map((s) => s.description)).toEqual([
      'Switch to Details tab',
      'Switch to Pods tab',
      'Switch to Logs tab',
      'Switch to Events tab',
      'Switch to YAML tab',
    ]);
  });

  it('numbers shortcuts by position so hidden tabs do not leave gaps', async () => {
    // Helm releases hide events/yaml/pods, showing: Details, Logs, Manifest, Values.
    await renderHook({
      isHelmRelease: true,
      capabilities: { ...baseCapabilities, hasManifest: true, hasValues: true },
    });

    const tabShortcuts = hoistedShortcuts.useShortcuts.mock.calls[0]?.[0] as
      | Array<{ key: string; description: string }>
      | undefined;
    expect(tabShortcuts?.map((s) => s.key)).toEqual(['1', '2', '3', '4']);
    expect(tabShortcuts?.map((s) => s.description)).toEqual([
      'Switch to Details tab',
      'Switch to Logs tab',
      'Switch to Manifest tab',
      'Switch to Values tab',
    ]);
  });

  it('omits shortcuts for hidden tabs instead of disabling them', async () => {
    // Without logs capability: Details, Pods, Events, YAML → 4 shortcuts, no gap.
    const { availableTabs } = await renderHook({
      capabilities: { ...baseCapabilities, hasObjPanelLogs: false },
    });

    expect(availableTabs.map((tab) => tab.label)).toEqual(['Details', 'Pods', 'Events', 'YAML']);

    const tabShortcuts = hoistedShortcuts.useShortcuts.mock.calls[0]?.[0] as
      | Array<{ key: string; description: string }>
      | undefined;
    expect(tabShortcuts).toHaveLength(4);
    // Key '2' now maps to Pods (second visible tab), not to a disabled Logs shortcut.
    expect(tabShortcuts?.[1]?.description).toBe('Switch to Pods tab');
  });

  it('ignores tab shortcuts when the panel is closed', async () => {
    await renderHook({ isOpen: false });

    const tabShortcuts = hoistedShortcuts.useShortcuts.mock.calls[0]?.[0] as
      | Array<{ key: string; handler: () => boolean; enabled: boolean }>
      | undefined;
    expect(tabShortcuts?.[0]?.enabled).toBe(false);
    expect(tabShortcuts?.[0]?.handler()).toBe(false);
    expect(setActiveTabMock).not.toHaveBeenCalled();
  });

  it('fires tab change shortcuts matching visible tab positions', async () => {
    await renderHook();

    const tabShortcuts = hoistedShortcuts.useShortcuts.mock.calls[0]?.[0] as
      | Array<{ key: string; handler: () => boolean }>
      | undefined;

    // Key '1' → Details (first visible tab).
    expect(tabShortcuts?.[0]?.handler()).toBe(true);
    expect(setActiveTabMock).toHaveBeenCalledWith('details');

    // Key '3' → Logs (third visible tab for Deployment: Details, Pods, Logs).
    expect(tabShortcuts?.[2]?.handler()).toBe(true);
    expect(setActiveTabMock).toHaveBeenCalledWith('logs');

    // Key '4' → Events (fourth visible tab).
    expect(tabShortcuts?.[3]?.handler()).toBe(true);
    expect(setActiveTabMock).toHaveBeenCalledWith('events');
  });
});
