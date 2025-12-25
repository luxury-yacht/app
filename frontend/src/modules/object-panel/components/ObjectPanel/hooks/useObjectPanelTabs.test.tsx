/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.test.tsx
 *
 * Tests for useObjectPanelTabs.
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
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => hoistedShortcuts.useShortcut(...args),
  useSearchShortcutTarget: () => undefined,
}));

describe('useObjectPanelTabs', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: ReturnType<typeof useObjectPanelTabs> | null } = { current: null };
  const dispatchMock = vi.fn();
  const navigateMock = vi.fn();
  const closeMock = vi.fn();

  const baseCapabilities: ComputedCapabilities = {
    hasLogs: true,
    hasShell: false,
    hasManifest: false,
    hasValues: false,
    canDelete: true,
    canRestart: true,
    canScale: true,
    canEditYaml: true,
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
      navigationIndex: 0,
      navigationHistoryLength: 1,
      navigate: navigateMock,
      dispatch: dispatchMock as React.Dispatch<PanelAction>,
      close: closeMock,
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
    navigateMock.mockClear();
    closeMock.mockClear();
    hoistedShortcuts.useShortcut.mockClear();
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
      capabilities: { ...baseCapabilities, hasLogs: false },
    });
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', payload: 'details' });
  });

  it('registers shortcut handlers for navigation and tab switching', async () => {
    await renderHook({ navigationHistoryLength: 2 });
    const shortcutCalls = hoistedShortcuts.useShortcut.mock.calls;
    const keys = shortcutCalls.map(([config]) => (config as { key: string }).key);
    expect(keys).toEqual(['Escape', 'ArrowLeft', 'ArrowRight', '1', '2', '3', '4', '5']);
  });

  it('excludes logs tab and disables related shortcut when logs capability is absent', async () => {
    const { availableTabs } = await renderHook({
      capabilities: { ...baseCapabilities, hasLogs: false },
    });

    expect(availableTabs.map((tab) => tab.label)).toEqual(['Details', 'Pods', 'Events', 'YAML']);

    const logShortcut = hoistedShortcuts.useShortcut.mock.calls.find(
      ([config]) => (config as { key: string }).key === '2'
    )?.[0] as { enabled: boolean } | undefined;
    expect(logShortcut?.enabled).toBe(false);
  });

  it('disables shell shortcut when capability is absent', async () => {
    await renderHook({
      objectData: { kind: 'Pod', name: 'api-123', namespace: 'team-a' },
    });

    const shellShortcut = hoistedShortcuts.useShortcut.mock.calls.find(
      ([config]) => (config as { key: string }).key === '5'
    )?.[0] as { enabled: boolean } | undefined;
    expect(shellShortcut?.enabled).toBe(false);
  });

  it('invokes close handler when escape shortcut fires while open', async () => {
    await renderHook();
    const escapeShortcut = hoistedShortcuts.useShortcut.mock.calls.find(
      ([config]) => (config as { key: string }).key === 'Escape'
    )?.[0] as { handler: () => boolean };

    expect(escapeShortcut.handler()).toBe(true);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('navigates between history entries via arrow shortcuts', async () => {
    await renderHook({ navigationHistoryLength: 3, navigationIndex: 1 });

    const leftShortcut = hoistedShortcuts.useShortcut.mock.calls.find(
      ([config]) => (config as { key: string }).key === 'ArrowLeft'
    )?.[0] as { handler: () => boolean };
    expect(leftShortcut.handler()).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith(0);

    const rightShortcut = hoistedShortcuts.useShortcut.mock.calls.find(
      ([config]) => (config as { key: string }).key === 'ArrowRight'
    )?.[0] as { handler: () => boolean };
    expect(rightShortcut.handler()).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith(2);
  });

  it('ignores tab shortcuts when the panel is closed', async () => {
    await renderHook({ isOpen: false });
    const detailsShortcut = hoistedShortcuts.useShortcut.mock.calls.find(
      ([config]) => (config as { key: string }).key === '1'
    )?.[0] as { handler: () => boolean };

    expect(detailsShortcut.handler()).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('fires tab change shortcuts when the panel is open', async () => {
    await renderHook();
    const shortcutByKey = (key: string) =>
      hoistedShortcuts.useShortcut.mock.calls.find(
        ([config]) => (config as { key: string }).key === key
      )?.[0] as { handler: () => boolean };

    expect(shortcutByKey('2').handler()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', payload: 'logs' });

    expect(shortcutByKey('3').handler()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', payload: 'events' });

    expect(shortcutByKey('4').handler()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_ACTIVE_TAB', payload: 'yaml' });
  });

  it('returns false for navigation shortcuts when already at the boundary', async () => {
    await renderHook({ navigationHistoryLength: 1, navigationIndex: 0 });
    const shortcutByKey = (key: string) =>
      hoistedShortcuts.useShortcut.mock.calls.find(
        ([config]) => (config as { key: string }).key === key
      )?.[0] as { handler: () => boolean };

    expect(shortcutByKey('ArrowLeft').handler()).toBe(false);
    expect(shortcutByKey('ArrowRight').handler()).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
