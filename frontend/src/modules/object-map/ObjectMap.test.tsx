import ReactDOMClient from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ObjectMapSnapshotPayload } from '@core/refresh/types';
import ObjectMap from './ObjectMap';

const payload: ObjectMapSnapshotPayload = {
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  seed: {
    clusterId: 'cluster-a',
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    namespace: 'default',
    name: 'web',
    uid: 'deploy-uid',
  },
  nodes: [
    {
      id: 'deploy',
      depth: 0,
      ref: {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'default',
        name: 'web',
        uid: 'deploy-uid',
      },
    },
    {
      id: 'pod',
      depth: 1,
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'web-abc',
        uid: 'pod-uid',
      },
    },
  ],
  edges: [{ id: 'edge-1', source: 'deploy', target: 'pod', type: 'owner', label: 'owns' }],
  maxDepth: 4,
  maxNodes: 250,
  truncated: false,
};

const renderObjectMap = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  await act(async () => {
    root.render(<ObjectMap payload={payload} />);
    await Promise.resolve();
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const pointerEvent = (
  type: string,
  init: { pointerId: number; clientX: number; clientY: number; button?: number }
): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    pointerId: number;
    clientX: number;
    clientY: number;
    button: number;
  };
  event.pointerId = init.pointerId;
  event.clientX = init.clientX;
  event.clientY = init.clientY;
  event.button = init.button ?? 0;
  return event;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ObjectMap', () => {
  it('drags nodes, reroutes edges, and resets manual layout', async () => {
    const { container, cleanup } = await renderObjectMap();
    const node = container.querySelector<SVGGElement>('[aria-label="Deployment: web"]');
    const edge = container.querySelector<SVGPathElement>('.object-map__edges path');
    const resetButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset layout"]'
    );

    expect(node).toBeTruthy();
    expect(edge).toBeTruthy();
    expect(resetButton).toBeTruthy();
    expect(resetButton?.disabled).toBe(true);

    const initialTransform = node!.getAttribute('transform');
    const initialPath = edge!.getAttribute('d');

    await act(async () => {
      node!.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }));
      node!.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 70, clientY: 30 }));
      node!.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 70, clientY: 30 }));
      await Promise.resolve();
    });

    expect(node!.getAttribute('transform')).not.toBe(initialTransform);
    expect(edge!.getAttribute('d')).not.toBe(initialPath);
    expect(resetButton?.disabled).toBe(false);

    await act(async () => {
      resetButton!.click();
      await Promise.resolve();
    });

    expect(node!.getAttribute('transform')).toBe(initialTransform);
    expect(edge!.getAttribute('d')).toBe(initialPath);
    expect(resetButton?.disabled).toBe(true);

    cleanup();
  });
});
