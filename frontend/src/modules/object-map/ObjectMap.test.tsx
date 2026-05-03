import ReactDOMClient from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import ObjectMap from './ObjectMap';

vi.mock('@shared/components/ContextMenu', () => ({
  default: ({
    items,
  }: {
    items: Array<{ label?: string; onClick?: () => void; divider?: boolean; header?: boolean }>;
  }) => (
    <div data-testid="mock-context-menu">
      {items.map((item, index) =>
        item.divider || item.header ? null : (
          <button key={index} type="button" onClick={item.onClick}>
            {item.label}
          </button>
        )
      )}
    </div>
  ),
}));

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
    onOpenObjectMap?: (ref: ObjectMapReference) => void;
    onNodeContextMenu?: (request: {
      ref: ObjectMapReference;
      position: { x: number; y: number };
    }) => void;
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
                  onContextMenu={(event) => {
                    event.preventDefault();
                    props.onNodeContextMenu?.({
                      ref: node.ref,
                      position: { x: event.clientX, y: event.clientY },
                    });
                  }}
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

const rolloutReplicaSetPayload: ObjectMapSnapshotPayload = {
  ...payload,
  nodes: [
    { id: 'deploy', depth: 0, ref: ref('deploy', 'Deployment', 'web', 'apps') },
    { id: 'rs-current', depth: 1, ref: ref('rs-current', 'ReplicaSet', 'web-zzz', 'apps') },
    { id: 'rs-old', depth: 1, ref: ref('rs-old', 'ReplicaSet', 'web-aaa', 'apps') },
    { id: 'pod-current', depth: 2, ref: ref('pod-current', 'Pod', 'web-zzz-abc', '') },
    { id: 'pod-old', depth: 2, ref: ref('pod-old', 'Pod', 'web-aaa-def', '') },
    { id: 'node-old', depth: 3, ref: ref('node-old', 'Node', 'worker-a', '') },
  ],
  edges: [
    { id: 'edge-current-rs', source: 'deploy', target: 'rs-current', type: 'owner', label: 'owns' },
    { id: 'edge-old-rs', source: 'deploy', target: 'rs-old', type: 'owner', label: 'owns' },
    {
      id: 'edge-current-pod',
      source: 'rs-current',
      target: 'pod-current',
      type: 'owner',
      label: 'owns',
    },
    { id: 'edge-old-pod', source: 'rs-old', target: 'pod-old', type: 'owner', label: 'owns' },
    {
      id: 'edge-old-node',
      source: 'pod-old',
      target: 'node-old',
      type: 'schedules',
      label: 'schedules',
    },
  ],
};

const focusModePayload: ObjectMapSnapshotPayload = {
  ...payload,
  nodes: [
    { id: 'deploy', depth: 0, ref: ref('deploy', 'Deployment', 'web', 'apps') },
    { id: 'pod-a', depth: 1, ref: ref('pod-a', 'Pod', 'web-a', '') },
    { id: 'pod-b', depth: 1, ref: ref('pod-b', 'Pod', 'web-b', '') },
    { id: 'config-a', depth: 2, ref: ref('config-a', 'ConfigMap', 'web-a-config', '') },
    { id: 'secret-a', depth: 3, ref: ref('secret-a', 'Secret', 'web-a-secret', '') },
  ],
  edges: [
    { id: 'edge-a', source: 'deploy', target: 'pod-a', type: 'owner', label: 'owns' },
    { id: 'edge-b', source: 'deploy', target: 'pod-b', type: 'owner', label: 'owns' },
    { id: 'edge-config', source: 'pod-a', target: 'config-a', type: 'uses', label: 'uses' },
    { id: 'edge-secret', source: 'config-a', target: 'secret-a', type: 'uses', label: 'uses' },
  ],
};

const renderObjectMap = async ({
  testPayload = payload,
  onOpenPanel,
  onNavigateView,
  onOpenObjectMap,
}: {
  testPayload?: ObjectMapSnapshotPayload;
  onOpenPanel?: (ref: ObjectMapReference) => void;
  onNavigateView?: (ref: ObjectMapReference) => void;
  onOpenObjectMap?: (ref: ObjectMapReference) => void;
} = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  await act(async () => {
    root.render(
      <ObjectMap
        payload={testPayload}
        onOpenPanel={onOpenPanel}
        onNavigateView={onNavigateView}
        onOpenObjectMap={onOpenObjectMap}
      />
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

  it('filters relationships from the legend without removing objects', async () => {
    const { container, cleanup } = await renderObjectMap();
    const ownerToggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Ownership'
    );

    expect(ownerToggle).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-abc"]')).toBeTruthy();

    await act(async () => {
      ownerToggle!.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeNull();
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-abc"]')).toBeTruthy();
    expect(container.querySelector('.object-map__status')?.textContent).toContain(
      '2 objects / 0 relationships'
    );

    cleanup();
  });

  it('toggles focus mode to redraw all recursively related objects', async () => {
    const { container, cleanup } = await renderObjectMap({ testPayload: focusModePayload });
    const focusToggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle focus mode"]'
    );
    const resetButton = container.querySelector<HTMLButtonElement>('[aria-label="Reset layout"]');
    const podA = container.querySelector<HTMLButtonElement>('[aria-label="Pod: web-a"]');
    const podANode = container.querySelector<HTMLElement>('[data-testid="mock-node-pod-a"]');

    expect(focusToggle).toBeTruthy();
    expect(resetButton).toBeTruthy();
    expect(resetButton?.disabled).toBe(true);
    expect(podA).toBeTruthy();
    expect(podANode).toBeTruthy();
    const initialPodAX = podANode!.dataset.x;
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-b"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="ConfigMap: web-a-config"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Secret: web-a-secret"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-b"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-config"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-secret"]')).toBeTruthy();

    await act(async () => {
      podA!.dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });

    await act(async () => {
      focusToggle!.click();
      await Promise.resolve();
    });

    expect(focusToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(resetButton?.disabled).toBe(false);
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-a"]')).toBeTruthy();
    expect(
      container.querySelector<HTMLElement>('[data-testid="mock-node-pod-a"]')?.dataset.x
    ).not.toBe(initialPodAX);
    expect(container.querySelector('[aria-label="ConfigMap: web-a-config"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Secret: web-a-secret"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-b"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-edge-edge-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-config"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-secret"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-b"]')).toBeNull();
    expect(container.querySelector('.object-map__status')?.textContent).toContain(
      '4 objects / 3 relationships'
    );

    await act(async () => {
      resetButton!.click();
      await Promise.resolve();
    });

    expect(focusToggle?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[aria-label="Pod: web-b"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-b"]')).toBeTruthy();
    expect(container.querySelector('.object-map__status')?.textContent).toContain(
      '5 objects / 4 relationships'
    );
    expect(resetButton?.disabled).toBe(true);

    cleanup();
  });

  it('searches and focuses matching objects', async () => {
    const { container, cleanup } = await renderObjectMap();
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search map objects"]');
    const podNode = container.querySelector<HTMLElement>('[data-testid="mock-node-pod"]');

    expect(search).toBeTruthy();
    expect(podNode?.dataset.active).toBe('false');

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter!.call(search, 'web-abc');
      search!.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      search!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(podNode?.dataset.active).toBe('true');
    expect(container.querySelector('.object-map__search-count')?.textContent).toBe('1/1');

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

  it('opens the shared object context menu for mapped objects', async () => {
    const onOpenPanel = vi.fn();
    const onOpenObjectMap = vi.fn();
    const { container, cleanup } = await renderObjectMap({ onOpenPanel, onOpenObjectMap });
    const pod = container.querySelector<HTMLButtonElement>('[aria-label="Pod: web-abc"]');

    expect(pod).toBeTruthy();

    await act(async () => {
      pod!.dispatchEvent(mouseEvent('contextmenu', { clientX: 100, clientY: 120 }));
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    expect(menu?.textContent).toContain('Open');
    expect(menu?.textContent).toContain('Map');
    expect(menu?.textContent).toContain('Diff');

    const openItem = Array.from(menu!.querySelectorAll('button')).find(
      (button) => button.textContent === 'Open'
    );
    const mapItem = Array.from(menu!.querySelectorAll('button')).find(
      (button) => button.textContent === 'Map'
    );

    await act(async () => {
      openItem!.click();
      await Promise.resolve();
    });

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
      pod!.dispatchEvent(mouseEvent('contextmenu', { clientX: 100, clientY: 120 }));
      await Promise.resolve();
    });

    const nextMenu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    const nextMapItem = Array.from(nextMenu!.querySelectorAll('button')).find(
      (button) => button.textContent === 'Map'
    );
    expect(mapItem).toBeTruthy();

    await act(async () => {
      nextMapItem!.click();
      await Promise.resolve();
    });

    expect(onOpenObjectMap).toHaveBeenCalledWith(
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

  it('keeps ReplicaSets and dependencies visible while they still own Pods', async () => {
    const { container, cleanup } = await renderObjectMap({
      testPayload: rolloutReplicaSetPayload,
    });

    expect(container.querySelector('[aria-label="ReplicaSet: web-zzz"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-zzz-abc"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="ReplicaSet: web-aaa"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-aaa-def"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Node: worker-a"]')).toBeTruthy();

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
    expect(warned.container.querySelector('.object-map__status')?.textContent).toContain(
      '2 objects / 1 relationships / truncated'
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
