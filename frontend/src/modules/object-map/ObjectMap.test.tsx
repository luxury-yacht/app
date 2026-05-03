import ReactDOMClient from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import ObjectMap from './ObjectMap';

vi.mock('./ObjectMapG6Renderer', () => {
  const MockObjectMapG6Renderer = (props: {
    layout: {
      nodes: Array<{
        id: string;
        x: number;
        y: number;
        ref: ObjectMapReference;
      }>;
      edges: Array<{
        id: string;
        d: string;
        sourceId: string;
        targetId: string;
        label: string;
      }>;
    };
    selectionState: {
      activeId: string | null;
      connectedIds: Set<string>;
      connectedEdgeIds: Set<string>;
    };
    badgeForNode: (nodeId: string) => { deploymentId: string; hiddenCount: number } | null;
    onSelectNode: (id: string) => void;
    onToggleGroup: (deploymentId: string) => void;
    onNodeDragStart: (
      node: { id: string; x: number; y: number; ref: ObjectMapReference },
      pointer: {
        pointerId: number;
        button: number;
        clientX: number;
        clientY: number;
        layoutX: number;
        layoutY: number;
      }
    ) => void;
    onNodeDragMove: (pointer: {
      pointerId: number;
      button: number;
      clientX: number;
      clientY: number;
      layoutX: number;
      layoutY: number;
    }) => void;
    onNodeDragEnd: (pointer: {
      pointerId: number;
      button: number;
      clientX: number;
      clientY: number;
      layoutX: number;
      layoutY: number;
    }) => void;
    onClearSelection: () => void;
    onOpenPanel?: (ref: ObjectMapReference) => void;
    onNavigateView?: (ref: ObjectMapReference) => void;
  }) => {
    const firstNode = props.layout.nodes[0];

    return (
      <div data-testid="object-map-g6-mock">
        <button type="button" data-testid="mock-clear-selection" onClick={props.onClearSelection}>
          clear
        </button>
        {firstNode && (
          <button
            type="button"
            data-testid="mock-drag-first-node"
            onClick={() => {
              props.onNodeDragStart(firstNode, {
                pointerId: 1,
                button: 0,
                clientX: 10,
                clientY: 10,
                layoutX: firstNode.x,
                layoutY: firstNode.y,
              });
              props.onNodeDragMove({
                pointerId: 1,
                button: 0,
                clientX: 70,
                clientY: 30,
                layoutX: firstNode.x + 60,
                layoutY: firstNode.y + 20,
              });
              props.onNodeDragEnd({
                pointerId: 1,
                button: 0,
                clientX: 70,
                clientY: 30,
                layoutX: firstNode.x + 60,
                layoutY: firstNode.y + 20,
              });
            }}
          >
            drag
          </button>
        )}
        <div data-testid="mock-nodes">
          {props.layout.nodes.map((node) => {
            const badge = props.badgeForNode(node.id);
            return (
              <div
                key={node.id}
                data-testid={`mock-node-${node.id}`}
                data-active={props.selectionState.activeId === node.id}
                data-connected={props.selectionState.connectedIds.has(node.id)}
                data-x={node.x}
                data-y={node.y}
              >
                <button
                  type="button"
                  aria-label={`${node.ref.kind}: ${node.ref.name}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey) {
                      props.onOpenPanel?.(node.ref);
                      return;
                    }
                    if (event.altKey) {
                      props.onNavigateView?.(node.ref);
                      return;
                    }
                    props.onSelectNode(node.id);
                  }}
                >
                  {node.ref.name}
                </button>
                {badge && (
                  <button
                    type="button"
                    aria-label={`Show ${badge.hiddenCount} hidden ReplicaSet`}
                    onClick={() => props.onToggleGroup(badge.deploymentId)}
                  >
                    badge
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div data-testid="mock-edges">
          {props.layout.edges.map((edge) => (
            <div
              key={edge.id}
              data-testid={`mock-edge-${edge.id}`}
              data-path={edge.d}
              data-highlighted={props.selectionState.connectedEdgeIds.has(edge.id)}
            >
              {edge.label}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return { default: MockObjectMapG6Renderer };
});

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

  for (
    let attempts = 0;
    attempts < 5 &&
    !container.querySelector('[data-testid="object-map-g6-mock"]') &&
    !container.querySelector('[data-testid="object-map-empty"]');
    attempts += 1
  ) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const mouseEvent = (type: string, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ObjectMap', () => {
  it('selects a node, highlights connected paths, and clears selection', async () => {
    const { container, cleanup } = await renderObjectMap();
    const deploy = container.querySelector<HTMLButtonElement>('[aria-label="Deployment: web"]');
    const podNode = container.querySelector<HTMLElement>('[data-testid="mock-node-pod"]');
    const edge = container.querySelector<HTMLElement>('[data-testid="mock-edge-edge-1"]');
    const clear = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-clear-selection"]'
    );

    expect(deploy).toBeTruthy();
    expect(podNode).toBeTruthy();
    expect(edge).toBeTruthy();
    expect(clear).toBeTruthy();

    await act(async () => {
      deploy!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="mock-node-deploy"]')?.dataset.active
    ).toBe('true');
    expect(podNode?.dataset.connected).toBe('true');
    expect(edge?.dataset.highlighted).toBe('true');

    await act(async () => {
      deploy!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="mock-node-deploy"]')?.dataset.active
    ).toBe('false');
    expect(edge?.dataset.highlighted).toBe('false');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Pod: web-abc"]')!
        .dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });
    expect(podNode?.dataset.active).toBe('true');

    await act(async () => {
      clear!.click();
      await Promise.resolve();
    });

    expect(podNode?.dataset.active).toBe('false');

    cleanup();
  });

  it('passes full object references for modifier-click actions', async () => {
    const onOpenPanel = vi.fn();
    const onNavigateView = vi.fn();
    const { container, cleanup } = await renderObjectMap({ onOpenPanel, onNavigateView });
    const pod = container.querySelector<HTMLButtonElement>('[aria-label="Pod: web-abc"]');

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

  it('collapses and expands older ReplicaSets', async () => {
    const { container, cleanup } = await renderObjectMap({ testPayload: collapsePayload });

    expect(container.querySelector('[aria-label="ReplicaSet: web-new"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="ReplicaSet: web-old"]')).toBeNull();

    const badge = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show 1 hidden ReplicaSet"]'
    );
    expect(badge).toBeTruthy();

    await act(async () => {
      badge!.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="ReplicaSet: web-old"]')).toBeTruthy();

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
    const node = container.querySelector<HTMLElement>('[data-testid="mock-node-deploy"]');
    const edge = container.querySelector<HTMLElement>('[data-testid="mock-edge-edge-1"]');
    const dragButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-drag-first-node"]'
    );
    const resetButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset layout"]'
    );

    expect(node).toBeTruthy();
    expect(edge).toBeTruthy();
    expect(dragButton).toBeTruthy();
    expect(resetButton).toBeTruthy();
    expect(resetButton?.disabled).toBe(true);

    const initialX = node!.dataset.x;
    const initialPath = edge!.dataset.path;

    await act(async () => {
      dragButton!.click();
      await Promise.resolve();
    });

    expect(node!.dataset.x).not.toBe(initialX);
    expect(edge!.dataset.path).not.toBe(initialPath);
    expect(resetButton?.disabled).toBe(false);

    await act(async () => {
      resetButton!.click();
      await Promise.resolve();
    });

    expect(node!.dataset.x).toBe(initialX);
    expect(edge!.dataset.path).toBe(initialPath);
    expect(resetButton?.disabled).toBe(true);

    cleanup();
  });
});
