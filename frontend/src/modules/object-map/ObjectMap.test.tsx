import ReactDOMClient from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import ObjectMap from './ObjectMap';

const ref = (
  id: string,
  kind: string,
  name: string,
  group: string,
  version = 'v1'
): ObjectMapReference => ({
  clusterId: 'cluster-a',
  group,
  version,
  kind,
  namespace: 'default',
  name,
  uid: `${id}-uid`,
});

const payload: ObjectMapSnapshotPayload = {
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  seed: ref('deploy', 'Deployment', 'web', 'apps'),
  nodes: [
    {
      id: 'deploy',
      depth: 0,
      ref: ref('deploy', 'Deployment', 'web', 'apps'),
    },
    {
      id: 'pod',
      depth: 1,
      ref: ref('pod', 'Pod', 'web-abc', ''),
    },
  ],
  edges: [{ id: 'edge-1', source: 'deploy', target: 'pod', type: 'owner', label: 'owns' }],
  maxDepth: 4,
  maxNodes: 250,
  truncated: false,
};

const collapsePayload: ObjectMapSnapshotPayload = {
  ...payload,
  nodes: [
    { id: 'deploy', depth: 0, ref: ref('deploy', 'Deployment', 'web', 'apps') },
    { id: 'rs-old', depth: 1, ref: ref('rs-old', 'ReplicaSet', 'web-old', 'apps') },
    { id: 'rs-new', depth: 1, ref: ref('rs-new', 'ReplicaSet', 'web-new', 'apps') },
    { id: 'pod-new', depth: 2, ref: ref('pod-new', 'Pod', 'web-new-abc', '') },
  ],
  edges: [
    { id: 'edge-old', source: 'deploy', target: 'rs-old', type: 'owner', label: 'owns' },
    { id: 'edge-new', source: 'deploy', target: 'rs-new', type: 'owner', label: 'owns' },
    { id: 'edge-pod', source: 'rs-new', target: 'pod-new', type: 'owner', label: 'owns' },
  ],
};

const renderObjectMap = async ({
  testPayload = payload,
  onOpenPanel,
  onNavigateView,
}: {
  testPayload?: ObjectMapSnapshotPayload;
  onOpenPanel?: (ref: ObjectMapReference) => void;
  onNavigateView?: (ref: ObjectMapReference) => void;
} = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  await act(async () => {
    root.render(
      <ObjectMap payload={testPayload} onOpenPanel={onOpenPanel} onNavigateView={onNavigateView} />
    );
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

const mouseEvent = (type: string, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ObjectMap', () => {
  it('selects a node, highlights connected paths, and clears selection', async () => {
    const { container, cleanup } = await renderObjectMap();
    const deploy = container.querySelector<SVGGElement>('[aria-label="Deployment: web"]');
    const pod = container.querySelector<SVGGElement>('[aria-label="Pod: web-abc"]');
    const edge = container.querySelector<SVGPathElement>('.object-map__edges path');
    const canvas = container.querySelector<HTMLDivElement>('.object-map__canvas');

    expect(deploy).toBeTruthy();
    expect(pod).toBeTruthy();
    expect(edge).toBeTruthy();
    expect(canvas).toBeTruthy();

    await act(async () => {
      deploy!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });

    expect(deploy!.classList.contains('object-map-node--selected')).toBe(true);
    expect(pod!.classList.contains('object-map-node--connected')).toBe(true);
    expect(edge!.classList.contains('object-map-edge--highlighted')).toBe(true);

    await act(async () => {
      deploy!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });

    expect(deploy!.classList.contains('object-map-node--selected')).toBe(false);
    expect(edge!.classList.contains('object-map-edge--highlighted')).toBe(false);

    await act(async () => {
      pod!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });
    expect(pod!.classList.contains('object-map-node--selected')).toBe(true);

    await act(async () => {
      canvas!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });

    expect(pod!.classList.contains('object-map-node--selected')).toBe(false);

    cleanup();
  });

  it('passes full object references for modifier-click actions', async () => {
    const onOpenPanel = vi.fn();
    const onNavigateView = vi.fn();
    const { container, cleanup } = await renderObjectMap({ onOpenPanel, onNavigateView });
    const pod = container.querySelector<SVGGElement>('[aria-label="Pod: web-abc"]');

    expect(pod).toBeTruthy();

    await act(async () => {
      pod!.dispatchEvent(mouseEvent('click', { metaKey: true }));
      await Promise.resolve();
    });

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onOpenPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'web-abc',
        uid: 'pod-uid',
      })
    );

    await act(async () => {
      pod!.dispatchEvent(mouseEvent('click', { ctrlKey: true }));
      await Promise.resolve();
    });

    expect(onOpenPanel).toHaveBeenCalledTimes(2);

    await act(async () => {
      pod!.dispatchEvent(mouseEvent('click', { altKey: true }));
      await Promise.resolve();
    });

    expect(onNavigateView).toHaveBeenCalledTimes(1);
    expect(onNavigateView).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'web-abc',
        uid: 'pod-uid',
      })
    );

    cleanup();
  });

  it('shows and clears edge hover tooltip data', async () => {
    const { container, cleanup } = await renderObjectMap();
    const edge = container.querySelector<SVGPathElement>('.object-map__edges path');

    expect(edge).toBeTruthy();

    await act(async () => {
      edge!.dispatchEvent(mouseEvent('mouseover'));
      await Promise.resolve();
    });

    expect(container.querySelector('.object-map__edge-tooltip-label')?.textContent).toBe('owns');

    await act(async () => {
      edge!.dispatchEvent(mouseEvent('mouseout'));
      await Promise.resolve();
    });

    expect(container.querySelector('.object-map__edge-tooltip-label')).toBeNull();

    cleanup();
  });

  it('collapses and expands older ReplicaSets', async () => {
    const { container, cleanup } = await renderObjectMap({ testPayload: collapsePayload });

    expect(container.querySelector('[aria-label="ReplicaSet: web-new"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="ReplicaSet: web-old"]')).toBeNull();

    const badge = container.querySelector<SVGGElement>('[aria-label="Show 1 hidden ReplicaSet"]');
    expect(badge).toBeTruthy();

    await act(async () => {
      badge!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="ReplicaSet: web-old"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Collapse other ReplicaSets"]')).toBeTruthy();

    cleanup();
  });

  it('renders empty, truncated, and warning states outside the renderer', async () => {
    const emptyPayload: ObjectMapSnapshotPayload = {
      ...payload,
      nodes: [],
      edges: [],
    };
    const empty = await renderObjectMap({ testPayload: emptyPayload });
    expect(
      empty.container.querySelector('[data-testid="object-map-empty"]')?.textContent
    ).toContain('No related objects found.');
    empty.cleanup();

    const warned = await renderObjectMap({
      testPayload: {
        ...payload,
        truncated: true,
        warnings: ['permission denied for secrets'],
      },
    });

    expect(warned.container.querySelector('.object-map__banner')?.textContent).toContain(
      'Showing 2 of many'
    );
    expect(warned.container.querySelector('.object-map__warnings')?.textContent).toContain(
      'permission denied for secrets'
    );

    warned.cleanup();
  });

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
