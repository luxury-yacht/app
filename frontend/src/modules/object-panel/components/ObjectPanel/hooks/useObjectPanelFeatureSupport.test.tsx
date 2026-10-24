/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport.test.tsx
 *
 * The panel features a kind supports come from the generated kind facets, matched
 * by the object's complete identity.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import type { PanelObjectData } from '../types';
import { useObjectPanelFeatureSupport } from './useObjectPanelFeatureSupport';

type HookResult = ReturnType<typeof useObjectPanelFeatureSupport>;

const ref = (group: string, version: string, kind: string): PanelObjectData => ({
  clusterId: 'cluster-a',
  group,
  version,
  kind,
  namespace: 'team-a',
  name: 'example',
});

describe('useObjectPanelFeatureSupport', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: HookResult | null } = { current: null };

  const renderHook = async (objectData: PanelObjectData | null) => {
    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelFeatureSupport(objectData);
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

  it('supports nothing without an object', async () => {
    expect(await renderHook(null)).toEqual({
      logs: 'none',
      shell: 'none',
      debug: false,
      edit: false,
    });
  });

  it('reads a pod’s logs, shell, and debug containers', async () => {
    expect(await renderHook(ref('', 'v1', 'Pod'))).toEqual({
      logs: 'pod',
      shell: 'exec',
      debug: true,
      edit: true,
    });
  });

  it('reads a workload’s pod logs', async () => {
    expect(await renderHook(ref('apps', 'v1', 'Deployment'))).toMatchObject({
      logs: 'owned-pods',
      shell: 'none',
    });
  });

  it('reads a node’s own logs and opens a node shell', async () => {
    expect(await renderHook(ref('', 'v1', 'Node'))).toEqual({
      logs: 'node',
      shell: 'node',
      debug: false,
      edit: true,
    });
  });

  it('gives a custom resource named like a built-in kind none of its features', async () => {
    expect(await renderHook(ref('batch.volcano.sh', 'v1alpha1', 'Job'))).toEqual({
      logs: 'none',
      shell: 'none',
      debug: false,
      edit: true,
    });
  });
});
