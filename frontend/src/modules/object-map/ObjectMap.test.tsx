/**
 * frontend/src/modules/object-map/ObjectMap.test.tsx
 *
 * Integration-style tests for the object-map shell with a mocked renderer.
 */

import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import { OBJECT_ACTION_IDS, objectActionLabel } from '@shared/actions/objectActionContract';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { act } from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import ObjectMap from './ObjectMap';
import type { ObjectMapViewportControls } from './objectMapRendererTypes';

const useShortNamesMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => useShortNamesMock(),
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: () => true,
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (
    kind: string,
    verb: string,
    namespace?: string | null,
    subresource?: string | null,
    clusterId?: string | null,
    group?: string | null,
    version?: string | null
  ) =>
    [
      clusterId ?? '',
      group ?? '',
      version ?? '',
      kind,
      namespace ?? '',
      verb,
      subresource ?? '',
    ].join('|'),
  queryKindPermissions: vi.fn(),
  useUserPermissions: () => {
    const permissions = new Map();
    permissions.get = () => ({ allowed: true, pending: false });
    return permissions;
  },
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@shared/components/ContextMenu', () => ({
  default: ({
    items,
  }: {
    items: Array<{
      actionId?: string;
      label?: string;
      onClick?: () => void;
      icon?: React.ReactNode;
      divider?: boolean;
      header?: boolean;
    }>;
  }) => (
    <div data-testid="mock-context-menu">
      {withStableListKeys(
        items,
        (item) => item.actionId ?? item.label ?? (item.divider ? 'divider' : 'header')
      ).map(({ key, value: item }) =>
        item.divider || item.header ? null : (
          <button
            key={key}
            type="button"
            data-context-action-id={item.actionId}
            onClick={item.onClick}
          >
            {!!item.icon && <span data-testid="mock-context-menu-icon">{item.icon}</span>}
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
    autoFit?: boolean;
    onUserViewportChange?: () => void;
    onNodeContextMenu?: (request: {
      ref: ObjectMapReference;
      position: { x: number; y: number };
    }) => void;
    onCanvasContextMenu?: (request: { position: { x: number; y: number } }) => void;
    onViewportControlsChange?: (controls: ObjectMapViewportControls | null) => void;
    debugMapId?: string;
    preserveViewportNodeId?: string | null;
    useShortResourceNames?: boolean;
  }) => {
    const firstNode = props.layout.nodes[0];

    return (
      <div
        data-testid="object-map-g6-mock"
        data-auto-fit={String(props.autoFit)}
        data-debug-map-id={props.debugMapId ?? ''}
        data-preserve-viewport-node-id={props.preserveViewportNodeId ?? ''}
        data-short-names={String(props.useShortResourceNames)}
      >
        <button type="button" data-testid="mock-clear-selection" onClick={props.onClearSelection}>
          clear
        </button>
        <button
          type="button"
          data-testid="mock-user-viewport-change"
          onClick={props.onUserViewportChange}
        >
          viewport
        </button>
        <button
          type="button"
          data-testid="mock-register-viewport-controls"
          onClick={() =>
            props.onViewportControlsChange?.({
              zoomOut: vi.fn(),
              zoomIn: vi.fn(),
              resetZoom: vi.fn(),
              fitToView: vi.fn(),
              focusNode: vi.fn(),
            })
          }
        >
          controls
        </button>
        <button
          type="button"
          data-testid="mock-canvas-context-menu"
          onContextMenu={(event) => {
            event.preventDefault();
            props.onCanvasContextMenu?.({
              position: { x: event.clientX, y: event.clientY },
            });
          }}
        >
          canvas menu
        </button>
        {!!firstNode && (
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
                    if (event.shiftKey) {
                      props.onOpenObjectMap?.(node.ref);
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

const shortNamesPayload: ObjectMapSnapshotPayload = {
  ...payload,
  seed: ref('service', 'Service', 'frontend', ''),
  nodes: [
    { id: 'service', depth: 0, ref: ref('service', 'Service', 'frontend', '') },
    { id: 'pod', depth: 1, ref: ref('pod', 'Pod', 'frontend-abc', '') },
  ],
  edges: [
    { id: 'edge-service', source: 'service', target: 'pod', type: 'selector', label: 'selects' },
  ],
};

const hpaManagedPayload: ObjectMapSnapshotPayload = {
  ...payload,
  nodes: [
    {
      id: 'hpa',
      depth: 1,
      ref: {
        ...ref('hpa', 'HorizontalPodAutoscaler', 'web', 'autoscaling', 'v2'),
        resource: 'horizontalpodautoscalers',
      },
    },
    {
      id: 'deploy',
      depth: 0,
      ref: {
        ...ref('deploy', 'Deployment', 'web', 'apps'),
        resource: 'deployments',
      },
      actionFacts: { hpaManaged: true, desiredReplicas: 3 },
    },
  ],
  edges: [
    { id: 'edge-hpa-deploy', source: 'hpa', target: 'deploy', type: 'scales', label: 'scales' },
  ],
};

const nonHpaManagedScalablePayload: ObjectMapSnapshotPayload = {
  ...payload,
  nodes: [
    {
      id: 'deploy',
      depth: 0,
      ref: {
        ...ref('deploy', 'Deployment', 'web', 'apps'),
        resource: 'deployments',
      },
      actionFacts: { hpaManaged: false, desiredReplicas: 3 },
    },
  ],
  edges: [],
};

const hpaManagedFactWithoutEdgePayload: ObjectMapSnapshotPayload = {
  ...nonHpaManagedScalablePayload,
  nodes: [
    {
      id: 'deploy',
      depth: 0,
      ref: {
        ...ref('deploy', 'Deployment', 'web', 'apps'),
        resource: 'deployments',
      },
      actionFacts: { hpaManaged: true, desiredReplicas: 3 },
    },
  ],
};

const unknownHpaManagedScalablePayload: ObjectMapSnapshotPayload = {
  ...nonHpaManagedScalablePayload,
  nodes: [
    {
      id: 'deploy',
      depth: 0,
      ref: {
        ...ref('deploy', 'Deployment', 'web', 'apps'),
        resource: 'deployments',
      },
    },
  ],
};

const transitiveKindFilterPayload: ObjectMapSnapshotPayload = {
  ...payload,
  seed: ref('service', 'Service', 'frontend', ''),
  nodes: [
    { id: 'service', depth: 0, ref: ref('service', 'Service', 'frontend', '') },
    {
      id: 'endpoint-slice',
      depth: 1,
      ref: ref('endpoint-slice', 'EndpointSlice', 'frontend-a', 'discovery.k8s.io'),
    },
    { id: 'pod', depth: 2, ref: ref('pod', 'Pod', 'frontend-abc', '') },
  ],
  edges: [
    {
      id: 'edge-service-endpoints',
      source: 'service',
      target: 'endpoint-slice',
      type: 'endpoint',
      label: 'has endpoints',
    },
    {
      id: 'edge-endpoints-pod',
      source: 'endpoint-slice',
      target: 'pod',
      type: 'routes',
      label: 'routes to',
    },
  ],
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
  onRefresh,
  isRefreshing = false,
}: {
  testPayload?: ObjectMapSnapshotPayload;
  onOpenPanel?: (ref: ObjectMapReference) => void;
  onNavigateView?: (ref: ObjectMapReference) => void;
  onOpenObjectMap?: (ref: ObjectMapReference) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
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
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
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

const pointerEvent = (
  type: string,
  init: MouseEventInit & { pointerId?: number } = {}
): MouseEvent => {
  const event = mouseEvent(type, init);
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  return event;
};

afterEach(() => {
  useShortNamesMock.mockReturnValue(false);
  document.body.innerHTML = '';
  vi.useRealTimers();
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
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="mock-node-deploy"]')?.dataset.active
    ).toBe('true');
    expect(podNode?.dataset.connected).toBe('true');
    expect(edge?.dataset.highlighted).toBe('true');

    await act(async () => {
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="mock-node-deploy"]')?.dataset.active
    ).toBe('false');
    expect(edge?.dataset.highlighted).toBe('false');

    await act(async () => {
      requireValue(
        container.querySelector<HTMLButtonElement>('[aria-label="Pod: web-abc"]'),
        'expected test value in ObjectMap.test.tsx'
      ).dispatchEvent(mouseEvent('click'));
      await Promise.resolve();
    });
    expect(podNode?.dataset.active).toBe('true');

    await act(async () => {
      requireValue(clear, 'expected test value in ObjectMap.test.tsx').click();
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
    const showAll = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Show all'
    );
    const hideAll = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Hide all'
    );

    expect(ownerToggle).toBeTruthy();
    expect(showAll).toBeTruthy();
    expect(hideAll).toBeTruthy();
    expect(showAll?.disabled).toBe(true);
    expect(hideAll?.disabled).toBe(false);
    const legend = container.querySelector<HTMLElement>('.object-map__legend');
    const legendText = legend?.textContent ?? '';
    expect(legendText).not.toContain('cmd+click');
    expect(legendText).not.toContain('alt+click');
    expect(container.querySelectorAll('.object-map__legend-separator').length).toBeGreaterThan(0);
    expect(container.querySelector('.object-map__legend-counts')?.textContent).toContain(
      '2Objects'
    );
    expect(container.querySelector('.object-map__legend-counts')?.textContent).toContain('1Links');
    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-abc"]')).toBeTruthy();

    await act(async () => {
      requireValue(hideAll, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeNull();
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-abc"]')).toBeTruthy();
    expect(container.querySelector('.object-map__legend-counts')?.textContent).toContain(
      '2Objects'
    );
    expect(container.querySelector('.object-map__legend-counts')?.textContent).toContain('0Links');
    expect(showAll?.disabled).toBe(false);
    expect(hideAll?.disabled).toBe(true);

    await act(async () => {
      requireValue(showAll, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeTruthy();
    expect(showAll?.disabled).toBe(true);
    expect(hideAll?.disabled).toBe(false);

    await act(async () => {
      requireValue(ownerToggle, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeNull();

    cleanup();
  });

  it('drags the legend without interfering with legend buttons', async () => {
    const { container, cleanup } = await renderObjectMap();
    const canvas = container.querySelector<HTMLElement>('.object-map__canvas');
    const legend = container.querySelector<HTMLElement>('.object-map__legend');
    const hideAll = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Hide all'
    );

    expect(canvas).toBeTruthy();
    expect(legend).toBeTruthy();
    expect(hideAll).toBeTruthy();

    requireValue(canvas, 'expected test value in ObjectMap.test.tsx').getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 0,
          top: 0,
          width: 500,
          height: 400,
          right: 500,
          bottom: 400,
        }) as DOMRect
    );
    requireValue(legend, 'expected test value in ObjectMap.test.tsx').getBoundingClientRect = vi.fn(
      () =>
        ({
          left: 380,
          top: 16,
          width: 100,
          height: 120,
          right: 480,
          bottom: 136,
        }) as DOMRect
    );

    await act(async () => {
      requireValue(legend, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        pointerEvent('pointerdown', { clientX: 400, clientY: 40 })
      );
      requireValue(legend, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        pointerEvent('pointermove', { clientX: 320, clientY: 70 })
      );
      requireValue(legend, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        pointerEvent('pointerup', { clientX: 320, clientY: 70 })
      );
      await Promise.resolve();
    });

    expect(requireValue(legend, 'expected test value in ObjectMap.test.tsx').style.left).toBe(
      '300px'
    );
    expect(requireValue(legend, 'expected test value in ObjectMap.test.tsx').style.top).toBe(
      '46px'
    );
    expect(requireValue(legend, 'expected test value in ObjectMap.test.tsx').style.right).toBe(
      'auto'
    );
    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeTruthy();

    await act(async () => {
      requireValue(hideAll, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeNull();
    expect(requireValue(legend, 'expected test value in ObjectMap.test.tsx').style.left).toBe(
      '300px'
    );

    cleanup();
  });

  it('closes the legend from the legend close button and explains how to reopen it', async () => {
    vi.useFakeTimers();
    const { container, cleanup } = await renderObjectMap();
    const legend = container.querySelector<HTMLElement>('.object-map__legend');
    const closeButton = container.querySelector<HTMLButtonElement>('[aria-label="Close legend"]');

    expect(legend).toBeTruthy();
    expect(closeButton).toBeTruthy();

    await act(async () => {
      requireValue(closeButton, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('mouseover')
      );
      vi.advanceTimersByTime(499);
    });

    expect(document.body.textContent).not.toContain(
      'Close the legend. You can open it again with the Legend button on the toolbar.'
    );

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(document.body.textContent).toContain(
      'Close the legend. You can open it again with the Legend button on the toolbar.'
    );
    expect(document.body.querySelector('.tooltip')?.getAttribute('data-placement')).toBeNull();

    await act(async () => {
      requireValue(closeButton, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(container.querySelector('.object-map__legend')).toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>('[aria-label="Toggle legend"]')
        ?.getAttribute('aria-pressed')
    ).toBe('false');

    cleanup();
  });

  it('turns off auto-fit after a manual viewport change', async () => {
    const { container, cleanup } = await renderObjectMap();
    const renderer = container.querySelector<HTMLElement>('[data-testid="object-map-g6-mock"]');
    const autoFitToggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle auto-fit"]'
    );
    const manualViewportChange = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-user-viewport-change"]'
    );

    expect(renderer).toBeTruthy();
    expect(autoFitToggle).toBeTruthy();
    expect(manualViewportChange).toBeTruthy();
    expect(renderer?.dataset.autoFit).toBe('true');
    expect(autoFitToggle?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      requireValue(manualViewportChange, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="object-map-g6-mock"]')?.dataset.autoFit
    ).toBe('false');
    expect(
      container.querySelector<HTMLElement>('[data-testid="object-map-g6-mock"]')?.dataset
        .preserveViewportNodeId
    ).toBe('deploy');
    expect(autoFitToggle?.getAttribute('aria-pressed')).toBe('false');

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
    const initialPodAX = requireValue(podANode, 'expected test value in ObjectMap.test.tsx').dataset
      .x;
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-b"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="ConfigMap: web-a-config"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Secret: web-a-secret"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-b"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-config"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-secret"]')).toBeTruthy();

    await act(async () => {
      requireValue(podA, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    await act(async () => {
      requireValue(focusToggle, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(focusToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(resetButton?.disabled).toBe(false);
    expect(container.querySelector('[aria-label="Deployment: web"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-a"]')).toBeTruthy();
    expect(container.querySelector<HTMLElement>('[data-testid="mock-node-pod-a"]')?.dataset.x).toBe(
      initialPodAX
    );
    expect(container.querySelector('[aria-label="ConfigMap: web-a-config"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Secret: web-a-secret"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Pod: web-b"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-edge-edge-a"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-config"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-secret"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-b"]')).toBeNull();

    await act(async () => {
      requireValue(resetButton, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(focusToggle?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[aria-label="Pod: web-b"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-b"]')).toBeTruthy();
    expect(resetButton?.disabled).toBe(true);

    cleanup();
  });

  it('does not preserve a selected node viewport anchor while focus mode is active', async () => {
    const { container, cleanup } = await renderObjectMap({ testPayload: focusModePayload });
    const focusToggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle focus mode"]'
    );
    const manualViewportChange = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-user-viewport-change"]'
    );
    const podA = container.querySelector<HTMLButtonElement>('[aria-label="Pod: web-a"]');

    expect(focusToggle).toBeTruthy();
    expect(manualViewportChange).toBeTruthy();
    expect(podA).toBeTruthy();

    await act(async () => {
      requireValue(manualViewportChange, 'expected test value in ObjectMap.test.tsx').click();
      requireValue(podA, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      requireValue(focusToggle, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="object-map-g6-mock"]')?.dataset
        .preserveViewportNodeId
    ).toBe('');

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
      requireValue(valueSetter, 'expected test value in ObjectMap.test.tsx').call(
        search,
        'web-abc'
      );
      requireValue(search, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        new InputEvent('input', { bubbles: true })
      );
      await Promise.resolve();
    });

    await act(async () => {
      requireValue(
        requireValue(search, 'expected test value in ObjectMap.test.tsx').form,
        'expected test value in ObjectMap.test.tsx'
      ).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(podNode?.dataset.active).toBe('true');
    expect(container.querySelector('.object-map__search-count')?.textContent).toBe('1/1');

    cleanup();
  });

  it('filters visible objects by kind', async () => {
    const { container, cleanup } = await renderObjectMap();
    const kindTrigger = container.querySelector<HTMLElement>('[aria-label="Filter map kinds"]');

    expect(kindTrigger).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-node-deploy"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-node-pod"]')).toBeTruthy();

    await act(async () => {
      requireValue(kindTrigger, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    const podOption = Array.from(container.querySelectorAll<HTMLElement>('.dropdown-option')).find(
      (option) => option.textContent?.includes('Pod')
    );
    expect(podOption).toBeTruthy();

    await act(async () => {
      requireValue(podOption, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-node-deploy"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-node-pod"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-edge-edge-1"]')).toBeNull();
    expect(kindTrigger?.textContent).toContain('Kinds (1)');

    cleanup();
  });

  it('preserves directed transitive relationships through kinds hidden by the filter', async () => {
    const { container, cleanup } = await renderObjectMap({
      testPayload: transitiveKindFilterPayload,
    });
    const kindTrigger = container.querySelector<HTMLElement>('[aria-label="Filter map kinds"]');

    expect(kindTrigger).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-node-service"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-node-endpoint-slice"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-node-pod"]')).toBeTruthy();

    await act(async () => {
      requireValue(kindTrigger, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    const optionByText = (text: string) =>
      Array.from(container.querySelectorAll<HTMLElement>('.dropdown-option')).find((option) =>
        option.textContent?.includes(text)
      );
    const podOption = optionByText('Pod');
    const serviceOption = optionByText('Service');

    expect(podOption).toBeTruthy();
    expect(serviceOption).toBeTruthy();

    await act(async () => {
      requireValue(serviceOption, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    const nextPodOption = optionByText('Pod');
    expect(nextPodOption).toBeTruthy();

    await act(async () => {
      requireValue(nextPodOption, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-node-service"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-node-pod"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-node-endpoint-slice"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-edge-edge-service-endpoints"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-edge-edge-endpoints-pod"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="mock-edge-filtered-path:service:pod"]')
    ).toBeTruthy();
    expect(container.querySelector('.object-map__legend')?.textContent).toContain('Filtered path');

    cleanup();
  });

  it('uses short resource names in map controls when the setting is enabled', async () => {
    useShortNamesMock.mockReturnValue(true);
    const { container, cleanup } = await renderObjectMap({ testPayload: shortNamesPayload });
    const renderer = container.querySelector<HTMLElement>('[data-testid="object-map-g6-mock"]');
    const kindTrigger = container.querySelector<HTMLElement>('[aria-label="Filter map kinds"]');
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search map objects"]');

    expect(renderer?.dataset.shortNames).toBe('true');
    expect(kindTrigger).toBeTruthy();
    expect(search).toBeTruthy();

    await act(async () => {
      requireValue(kindTrigger, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    const serviceOption = Array.from(
      container.querySelectorAll<HTMLElement>('.dropdown-option')
    ).find((option) => option.textContent?.includes('svc'));
    expect(serviceOption).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      requireValue(valueSetter, 'expected test value in ObjectMap.test.tsx').call(search, 'svc');
      requireValue(search, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        new InputEvent('input', { bubbles: true })
      );
      await Promise.resolve();
    });

    await act(async () => {
      requireValue(
        requireValue(search, 'expected test value in ObjectMap.test.tsx').form,
        'expected test value in ObjectMap.test.tsx'
      ).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>('[data-testid="mock-node-service"]')?.dataset.active
    ).toBe('true');

    cleanup();
  });

  it('passes full object references for modifier-click actions', async () => {
    const onOpenPanel = vi.fn();
    const onNavigateView = vi.fn();
    const onOpenObjectMap = vi.fn();
    const { container, cleanup } = await renderObjectMap({
      onOpenPanel,
      onNavigateView,
      onOpenObjectMap,
    });
    const pod = container.querySelector<HTMLButtonElement>('[aria-label="Pod: web-abc"]');

    expect(pod).toBeTruthy();

    await act(async () => {
      requireValue(pod, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click', { metaKey: true })
      );
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
      requireValue(pod, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click', { ctrlKey: true })
      );
      await Promise.resolve();
    });

    expect(onOpenPanel).toHaveBeenCalledTimes(2);

    await act(async () => {
      requireValue(pod, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click', { shiftKey: true })
      );
      await Promise.resolve();
    });

    expect(onOpenObjectMap).toHaveBeenCalledTimes(1);
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

    await act(async () => {
      requireValue(pod, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click', { altKey: true })
      );
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
      requireValue(pod, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 100, clientY: 120 })
      );
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    expect(menu?.textContent).toContain(objectActionLabel(OBJECT_ACTION_IDS.viewDetails));
    expect(menu?.textContent).toContain(objectActionLabel(OBJECT_ACTION_IDS.viewMap));
    expect(menu?.textContent).toContain(objectActionLabel(OBJECT_ACTION_IDS.goToTable));
    expect(menu?.textContent).toContain('Diff');
    expect(menu?.textContent).not.toContain('cmd');
    expect(menu?.textContent).not.toContain('shift');
    expect(menu?.textContent).not.toContain('alt');

    const openItem = requireValue(
      menu,
      'expected test value in ObjectMap.test.tsx'
    ).querySelector<HTMLButtonElement>(
      `[data-context-action-id="${OBJECT_ACTION_IDS.viewDetails}"]`
    );
    const mapItem = requireValue(
      menu,
      'expected test value in ObjectMap.test.tsx'
    ).querySelector<HTMLButtonElement>(`[data-context-action-id="${OBJECT_ACTION_IDS.viewMap}"]`);

    await act(async () => {
      requireValue(openItem, 'expected test value in ObjectMap.test.tsx').click();
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
      requireValue(pod, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 100, clientY: 120 })
      );
      await Promise.resolve();
    });

    const nextMenu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    const nextMapItem = requireValue(
      nextMenu,
      'expected test value in ObjectMap.test.tsx'
    ).querySelector<HTMLButtonElement>(`[data-context-action-id="${OBJECT_ACTION_IDS.viewMap}"]`);
    expect(mapItem).toBeTruthy();

    await act(async () => {
      requireValue(nextMapItem, 'expected test value in ObjectMap.test.tsx').click();
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

  it('shows HPA scale actions from node action facts', async () => {
    const { container, cleanup } = await renderObjectMap({ testPayload: hpaManagedPayload });
    const deploy = container.querySelector<HTMLButtonElement>('[aria-label="Deployment: web"]');
    expect(deploy).toBeTruthy();

    await act(async () => {
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 100, clientY: 120 })
      );
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scaleToZero}"]`
      )
    ).toBeTruthy();
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scale}"]`
      )
    ).toBeNull();

    cleanup();
  });

  it('shows HPA scale actions even when the scales edge is not visible', async () => {
    const { container, cleanup } = await renderObjectMap({
      testPayload: hpaManagedFactWithoutEdgePayload,
    });
    const deploy = container.querySelector<HTMLButtonElement>('[aria-label="Deployment: web"]');
    expect(deploy).toBeTruthy();

    await act(async () => {
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 100, clientY: 120 })
      );
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scaleToZero}"]`
      )
    ).toBeTruthy();
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scale}"]`
      )
    ).toBeNull();

    cleanup();
  });

  it('shows normal Scale for map workloads when action facts say no HPA manages them', async () => {
    const { container, cleanup } = await renderObjectMap({
      testPayload: nonHpaManagedScalablePayload,
    });
    const deploy = container.querySelector<HTMLButtonElement>('[aria-label="Deployment: web"]');
    expect(deploy).toBeTruthy();

    await act(async () => {
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 100, clientY: 120 })
      );
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scale}"]`
      )
    ).toBeTruthy();
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scaleToZero}"]`
      )
    ).toBeNull();

    cleanup();
  });

  it('hides scale actions for map workloads when HPA ownership is unknown', async () => {
    const { container, cleanup } = await renderObjectMap({
      testPayload: unknownHpaManagedScalablePayload,
    });
    const deploy = container.querySelector<HTMLButtonElement>('[aria-label="Deployment: web"]');
    expect(deploy).toBeTruthy();

    await act(async () => {
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 100, clientY: 120 })
      );
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scale}"]`
      )
    ).toBeNull();
    expect(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelector(
        `[data-context-action-id="${OBJECT_ACTION_IDS.scaleToZero}"]`
      )
    ).toBeNull();

    cleanup();
  });

  it('opens a canvas context menu with map controls', async () => {
    const onRefresh = vi.fn();
    const { container, cleanup } = await renderObjectMap({ onRefresh });
    const controls = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-register-viewport-controls"]'
    );
    const canvasMenu = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-canvas-context-menu"]'
    );

    expect(controls).toBeTruthy();
    expect(canvasMenu).toBeTruthy();

    await act(async () => {
      requireValue(controls, 'expected test value in ObjectMap.test.tsx').click();
      requireValue(canvasMenu, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 140, clientY: 160 })
      );
      await Promise.resolve();
    });

    const menu = container.querySelector<HTMLElement>('[data-testid="mock-context-menu"]');
    expect(menu?.textContent).toContain('Zoom out');
    expect(menu?.textContent).toContain('Zoom in');
    expect(menu?.textContent).toContain('Reset zoom');
    expect(menu?.textContent).toContain('Fit');
    expect(menu?.textContent).toContain('Auto-fit off');
    expect(menu?.textContent).toContain('Focus on');
    expect(menu?.textContent).toContain('Reset layout');
    expect(menu?.textContent).toContain('Refresh');
    expect(menu?.textContent).toContain('Hide legend');
    expect(container.querySelectorAll('[data-testid="mock-context-menu-icon"]')).toHaveLength(9);

    const autoFitItem = Array.from(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelectorAll('button')
    ).find((button) => button.textContent === 'Auto-fit off');
    const refreshItem = Array.from(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelectorAll('button')
    ).find((button) => button.textContent === 'Refresh');
    const legendItem = Array.from(
      requireValue(menu, 'expected test value in ObjectMap.test.tsx').querySelectorAll('button')
    ).find((button) => button.textContent === 'Hide legend');

    await act(async () => {
      requireValue(autoFitItem, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });
    expect(
      container.querySelector<HTMLElement>('[data-testid="object-map-g6-mock"]')?.dataset.autoFit
    ).toBe('false');

    await act(async () => {
      requireValue(canvasMenu, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('contextmenu', { clientX: 140, clientY: 160 })
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="mock-context-menu"]')?.textContent).toContain(
      'Auto-fit on'
    );

    await act(async () => {
      requireValue(refreshItem, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      requireValue(legendItem, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });
    expect(container.querySelector('.object-map__legend')).toBeNull();

    cleanup();
  });

  it('marks the refresh control as busy while a refresh is running', async () => {
    const onRefresh = vi.fn();
    const { container, cleanup } = await renderObjectMap({ onRefresh, isRefreshing: true });
    const refreshButton = container.querySelector<HTMLButtonElement>('[aria-label="Refreshing"]');

    expect(refreshButton).toBeTruthy();
    expect(refreshButton?.disabled).toBe(true);
    expect(refreshButton?.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton?.classList.contains('object-map__toolbar-button--refreshing')).toBe(true);

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
      requireValue(badge, 'expected test value in ObjectMap.test.tsx').click();
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
    expect(warned.container.querySelector('.object-map__status')).toBeNull();

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

    const initialX = requireValue(node, 'expected test value in ObjectMap.test.tsx').dataset.x;
    const initialPath = requireValue(edge, 'expected test value in ObjectMap.test.tsx').dataset
      .path;

    await act(async () => {
      requireValue(dragButton, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(requireValue(node, 'expected test value in ObjectMap.test.tsx').dataset.x).not.toBe(
      initialX
    );
    expect(requireValue(edge, 'expected test value in ObjectMap.test.tsx').dataset.path).not.toBe(
      initialPath
    );
    expect(resetButton?.disabled).toBe(false);

    await act(async () => {
      requireValue(resetButton, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    expect(requireValue(node, 'expected test value in ObjectMap.test.tsx').dataset.x).toBe(
      initialX
    );
    expect(requireValue(edge, 'expected test value in ObjectMap.test.tsx').dataset.path).toBe(
      initialPath
    );
    expect(resetButton?.disabled).toBe(true);

    cleanup();
  });

  it('allows selecting a different node immediately after dragging', async () => {
    const { container, cleanup } = await renderObjectMap();
    const dragButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-drag-first-node"]'
    );
    const deploy = container.querySelector<HTMLButtonElement>('[aria-label="Deployment: web"]');
    const pod = container.querySelector<HTMLButtonElement>('[aria-label="Pod: web-abc"]');
    const deployNode = container.querySelector<HTMLElement>('[data-testid="mock-node-deploy"]');
    const podNode = container.querySelector<HTMLElement>('[data-testid="mock-node-pod"]');

    expect(dragButton).toBeTruthy();
    expect(deploy).toBeTruthy();
    expect(pod).toBeTruthy();
    expect(deployNode).toBeTruthy();
    expect(podNode).toBeTruthy();

    await act(async () => {
      requireValue(dragButton, 'expected test value in ObjectMap.test.tsx').click();
      await Promise.resolve();
    });

    await act(async () => {
      requireValue(pod, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    expect(podNode?.dataset.active).toBe('true');
    expect(deployNode?.dataset.active).toBe('false');

    await act(async () => {
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    expect(deployNode?.dataset.active).toBe('true');
    expect(podNode?.dataset.active).toBe('false');

    cleanup();
  });

  it('allows selecting the dragged node after dragging when the renderer sends a real click', async () => {
    const { container, cleanup } = await renderObjectMap();
    const dragButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="mock-drag-first-node"]'
    );
    const deploy = container.querySelector<HTMLButtonElement>('[aria-label="Deployment: web"]');
    const deployNode = container.querySelector<HTMLElement>('[data-testid="mock-node-deploy"]');

    expect(dragButton).toBeTruthy();
    expect(deploy).toBeTruthy();
    expect(deployNode).toBeTruthy();

    await act(async () => {
      requireValue(dragButton, 'expected test value in ObjectMap.test.tsx').click();
      requireValue(deploy, 'expected test value in ObjectMap.test.tsx').dispatchEvent(
        mouseEvent('click')
      );
      await Promise.resolve();
    });

    expect(deployNode?.dataset.active).toBe('true');

    cleanup();
  });
});
