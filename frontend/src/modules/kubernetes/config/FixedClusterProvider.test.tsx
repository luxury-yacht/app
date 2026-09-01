import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClusterProvider, useKubeconfig } from './KubeconfigContext';

const contextRef: { current: ReturnType<typeof useKubeconfig> | null } = { current: null };

const Probe: React.FC = () => {
  contextRef.current = useKubeconfig();
  return null;
};

describe('FixedClusterProvider', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    contextRef.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('exposes one immutable cluster without a workspace selection transition', async () => {
    await act(async () => {
      root.render(
        <FixedClusterProvider clusterId="cluster-1" clusterName="production">
          <Probe />
        </FixedClusterProvider>
      );
    });

    expect(contextRef.current?.selectedClusterId).toBe('cluster-1');
    expect(contextRef.current?.selectedClusterName).toBe('production');
    await act(async () => {
      await contextRef.current?.openKubeconfig('another');
    });
    expect(contextRef.current?.selectedClusterId).toBe('cluster-1');
  });
});
