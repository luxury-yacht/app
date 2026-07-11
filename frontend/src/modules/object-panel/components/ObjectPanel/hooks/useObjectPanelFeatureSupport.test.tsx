/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport.test.tsx
 */

/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport.test.tsx
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import type { ResourceCapability } from '../types';
import { useObjectPanelFeatureSupport } from './useObjectPanelFeatureSupport';

type HookResult = ReturnType<typeof useObjectPanelFeatureSupport>;

describe('useObjectPanelFeatureSupport', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: HookResult | null } = { current: null };

  const capabilities: Record<string, ResourceCapability> = {
    deployment: { objPanelLogs: true, restart: true, scale: true, delete: true },
    node: { nodeLogs: true },
    helmrelease: { delete: true },
  };

  const renderHook = async (objectKind: string | null, isHelmRelease = false) => {
    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelFeatureSupport(objectKind, capabilities, isHelmRelease);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    return requireValue(
      resultRef.current,
      'expected test value in useObjectPanelFeatureSupport.test.tsx'
    );
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('returns disabled features when kind is unknown', async () => {
    const result = await renderHook(null);

    expect(result).toEqual({
      objPanelLogs: false,
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
    });
  });

  it('mirrors configuration flags for known workloads', async () => {
    const result = await renderHook('deployment');

    expect(result).toEqual({
      objPanelLogs: true,
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
    });
  });

  it('enables manifest and values for Helm releases', async () => {
    const result = await renderHook('helmrelease', true);

    expect(result).toEqual({
      objPanelLogs: false,
      nodeLogs: false,
      manifest: true,
      values: true,
      delete: true,
      restart: false,
      scale: false,
      edit: true,
      shell: false,
      debug: false,
      trigger: false,
      suspend: false,
    });
  });

  it('does not enable Helm CLI tabs for real HelmRelease custom resources', async () => {
    const result = await renderHook('helmrelease', false);

    expect(result).toMatchObject({
      manifest: false,
      values: false,
      delete: true,
      edit: true,
    });
  });

  it('defaults to delete/edit for unlisted kinds', async () => {
    const result = await renderHook('customkind');

    expect(result).toEqual({
      objPanelLogs: false,
      nodeLogs: false,
      manifest: false,
      values: false,
      delete: true,
      restart: false,
      scale: false,
      edit: true,
      shell: false,
      debug: false,
      trigger: false,
      suspend: false,
    });
  });

  it('enables node logs for nodes', async () => {
    const result = await renderHook('node');

    expect(result).toEqual({
      objPanelLogs: false,
      nodeLogs: true,
      manifest: false,
      values: false,
      delete: false,
      restart: false,
      scale: false,
      edit: true,
      shell: false,
      debug: false,
      trigger: false,
      suspend: false,
    });
  });
});
