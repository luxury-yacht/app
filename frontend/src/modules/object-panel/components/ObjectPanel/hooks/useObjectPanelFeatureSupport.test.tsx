import { act } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useObjectPanelFeatureSupport } from './useObjectPanelFeatureSupport';
import type { ResourceCapability } from '../types';

type HookResult = ReturnType<typeof useObjectPanelFeatureSupport>;

describe('useObjectPanelFeatureSupport', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: HookResult | null } = { current: null };

  const capabilities: Record<string, ResourceCapability> = {
    deployment: { logs: true, restart: true, scale: true, delete: true },
    helmrelease: { delete: true },
  };

  const renderHook = async (objectKind: string | null) => {
    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelFeatureSupport(objectKind, capabilities);
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
      logs: false,
      manifest: false,
      values: false,
      delete: false,
      restart: false,
      scale: false,
      edit: false,
      shell: false,
    });
  });

  it('mirrors configuration flags for known workloads', async () => {
    const result = await renderHook('deployment');

    expect(result).toEqual({
      logs: true,
      manifest: false,
      values: false,
      delete: true,
      restart: true,
      scale: true,
      edit: true,
      shell: false,
    });
  });

  it('enables manifest and values for Helm releases', async () => {
    const result = await renderHook('helmrelease');

    expect(result).toEqual({
      logs: false,
      manifest: true,
      values: true,
      delete: true,
      restart: false,
      scale: false,
      edit: true,
      shell: false,
    });
  });

  it('defaults to delete/edit for unlisted kinds', async () => {
    const result = await renderHook('customkind');

    expect(result).toEqual({
      logs: false,
      manifest: false,
      values: false,
      delete: true,
      restart: false,
      scale: false,
      edit: true,
      shell: false,
    });
  });
});
