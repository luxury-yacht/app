/**
 * frontend/src/modules/object-map/useObjectMapG6Viewport.test.tsx
 *
 * Tests object-map G6 viewport resize behavior.
 */

import type { Graph, GraphData } from '@antv/g6';
import { act } from 'react';
import React, { useRef } from 'react';
import ReactDOMClient from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useObjectMapG6Viewport } from './useObjectMapG6Viewport';
import type { ObjectMapG6Palette } from './objectMapG6Data';

type TestGraph = {
  destroyed: boolean;
  fitView: ReturnType<typeof vi.fn>;
  focusElement: ReturnType<typeof vi.fn>;
  getCanvas: ReturnType<typeof vi.fn>;
  getSize: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  zoomBy: ReturnType<typeof vi.fn>;
  zoomTo: ReturnType<typeof vi.fn>;
};

let resizeObserverCallback: ResizeObserverCallback | null = null;
let root: ReactDOMClient.Root | null = null;
let host: HTMLDivElement | null = null;

const data: GraphData = { nodes: [], edges: [] };
const palette: ObjectMapG6Palette = {
  accent: '#4096ff',
  accentBg: '#e6f4ff',
  background: '#fff',
  backgroundSecondary: '#f5f5f5',
  border: '#ddd',
  edgeDefault: '#999',
  edgeAggregates: '#999',
  edgeBinds: '#999',
  edgeDash: [4, 3],
  edgeDimmedOpacity: 0.2,
  edgeEndpoint: '#999',
  edgeFilteredPath: '#999',
  edgeGrants: '#999',
  edgeHoveredLineWidth: 4,
  edgeHighlightedLineWidth: 2.5,
  edgeLineWidth: 1.5,
  edgeMounts: '#999',
  edgeOwner: '#999',
  edgeRoutes: '#999',
  edgeScales: '#999',
  edgeSchedules: '#999',
  edgeSelector: '#999',
  edgeStorageClass: '#999',
  edgeUses: '#999',
  edgeVolumeBinding: '#999',
  fitViewPadding: 16,
  fontFamily: 'sans-serif',
  fullOpacity: 1,
  nodeConnectedLineWidth: 1,
  nodeDimmedBackgroundOpacity: 0.2,
  nodeDimmedForegroundOpacity: 0.2,
  nodeEdgeHoveredLineWidth: 2.5,
  nodeSelectedLineWidth: 1,
  statusDegraded: '#faad14',
  statusHealthy: '#52c41a',
  statusInactive: '#999',
  statusRefreshing: '#1677ff',
  statusUnhealthy: '#ff4d4f',
  text: '#111',
  textInverse: '#fff',
  textSecondary: '#555',
  textTertiary: '#777',
  tooltipArrowHeight: 6,
  tooltipArrowWidth: 12,
  tooltipBadgeGap: 6,
  tooltipBadgeMaxFontSize: 10,
  tooltipBadgeMaxWidth: 190,
  tooltipBadgePaddingX: 5,
  tooltipBadgePaddingY: 2,
  tooltipHeight: 64,
  tooltipHorizontalPadding: 12,
  tooltipMaxWidth: 800,
  tooltipNameFontSize: 11,
  tooltipNameFontWeight: 600,
  tooltipOffsetY: 6,
  tooltipRadius: 4,
  tooltipRelationshipBottomPadding: 2,
  tooltipRelationshipFontSize: 11,
  tooltipRelationshipFontWeight: 400,
  tooltipRelationshipY: -40,
  tooltipSourceY: -56,
  tooltipTargetY: -24,
};

const createGraph = (): TestGraph => {
  const canvasConfig = { devicePixelRatio: 1 };
  const layer = {
    context: {
      config: { devicePixelRatio: 1 },
    },
    devicePixelRatio: 1,
  };
  const canvas = {
    getConfig: vi.fn(() => canvasConfig),
    getLayers: vi.fn(() => ({ main: layer })),
    resize: vi.fn(),
  };
  return {
    destroyed: false,
    fitView: vi.fn(async () => undefined),
    focusElement: vi.fn(async () => undefined),
    getCanvas: vi.fn(() => canvas),
    getSize: vi.fn((): [number, number] => [100, 80]),
    getZoom: vi.fn(() => 1),
    setSize: vi.fn(),
    zoomBy: vi.fn(async () => undefined),
    zoomTo: vi.fn(async () => undefined),
  };
};

interface HarnessProps {
  appZoomLevel: number;
  graph: TestGraph;
  height: number;
  width: number;
}

const Harness: React.FC<HarnessProps> = ({ appZoomLevel, graph, height, width }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(graph as unknown as Graph);
  const paletteRef = useRef<ObjectMapG6Palette | null>(palette);
  const onUserViewportChangeRef = useRef<(() => void) | undefined>(undefined);
  const updateTooltipPositionRef = useRef(vi.fn());

  paletteRef.current = palette;
  graphRef.current = graph as unknown as Graph;

  useObjectMapG6Viewport({
    appZoomLevel,
    autoFit: true,
    containerRef,
    data,
    graphReady: true,
    graphRef,
    onUserViewportChangeRef,
    palette,
    paletteRef,
    updateTooltipPosition: updateTooltipPositionRef.current,
  });

  return (
    <div
      ref={(node) => {
        if (node) {
          Object.defineProperty(node, 'clientWidth', { configurable: true, value: width });
          Object.defineProperty(node, 'clientHeight', { configurable: true, value: height });
        }
        containerRef.current = node;
      }}
    />
  );
};

const renderHarness = async (props: HarnessProps) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = ReactDOMClient.createRoot(host);
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const rerenderHarness = async (props: HarnessProps) => {
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const triggerObservedResize = async () => {
  await act(async () => {
    resizeObserverCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useObjectMapG6Viewport', () => {
  beforeEach(() => {
    resizeObserverCallback = null;
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback;
        }

        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it('auto-fits ordinary container resizes', async () => {
    const graph = createGraph();
    await renderHarness({ appZoomLevel: 100, graph, height: 240, width: 320 });
    graph.fitView.mockClear();

    await triggerObservedResize();

    expect(graph.setSize).toHaveBeenCalledWith(320, 240);
    expect(graph.fitView).toHaveBeenCalledWith({ when: 'always', direction: 'both' }, false);
  });

  it('does not auto-fit resize notifications caused by app zoom changes', async () => {
    const graph = createGraph();
    await renderHarness({ appZoomLevel: 100, graph, height: 240, width: 320 });
    graph.fitView.mockClear();
    graph.setSize.mockClear();

    await rerenderHarness({ appZoomLevel: 125, graph, height: 240, width: 320 });
    await triggerObservedResize();

    expect(graph.setSize).toHaveBeenCalledWith(320, 240);
    expect(graph.fitView).not.toHaveBeenCalled();
  });

  it('updates the G6 canvas backing resolution when app zoom changes', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const canvasConfig = { devicePixelRatio: 2 };
    const layer = {
      context: {
        config: { devicePixelRatio: 2 },
      },
      devicePixelRatio: 2,
    };
    const canvas = {
      getConfig: vi.fn(() => canvasConfig),
      getLayers: vi.fn(() => ({ main: layer })),
      resize: vi.fn(),
    };
    const graph = createGraph();
    graph.getCanvas.mockReturnValue(canvas);

    await renderHarness({ appZoomLevel: 100, graph, height: 240, width: 320 });
    canvas.resize.mockClear();
    graph.fitView.mockClear();

    await rerenderHarness({ appZoomLevel: 125, graph, height: 240, width: 320 });

    expect(canvasConfig.devicePixelRatio).toBe(3);
    expect(layer.context.config.devicePixelRatio).toBe(3);
    expect(layer.devicePixelRatio).toBe(3);
    expect(canvas.resize).toHaveBeenCalledWith(100, 80);
    expect(graph.fitView).not.toHaveBeenCalled();
  });
});
