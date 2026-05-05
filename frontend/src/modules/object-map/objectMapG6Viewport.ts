/**
 * frontend/src/modules/object-map/objectMapG6Viewport.ts
 *
 * Viewport helpers for G6 map zooming, fit-to-view padding, and wheel modifier
 * behavior.
 */

const OBJECT_MAP_WHEEL_ZOOM_DELTA_LIMIT = 50;
const OBJECT_MAP_WHEEL_ZOOM_SENSITIVITY = 1;

export interface ObjectMapG6ViewportGraph {
  destroyed: boolean;
  fitView: (options: { when: 'always'; direction: 'both' }, animation: boolean) => Promise<void>;
  getSize: () => [number, number];
  zoomBy: (ratio: number, animation: boolean, origin?: [number, number]) => Promise<void>;
  zoomTo: (zoom: number, animation: boolean, origin?: [number, number]) => Promise<void>;
}

export const isObjectMapMacPlatform = (platform?: string): boolean => {
  const value = platform ?? (typeof navigator === 'undefined' ? '' : navigator.platform);
  return /Mac|iPhone|iPad|iPod/.test(value);
};

export const isObjectMapZoomWheelEvent = (
  event: Pick<WheelEvent, 'ctrlKey' | 'metaKey'>,
  platform?: string
): boolean => {
  if (isObjectMapMacPlatform(platform)) {
    return event.metaKey || event.ctrlKey;
  }
  return event.ctrlKey;
};

export const objectMapWheelZoomRatio = (event: Pick<WheelEvent, 'deltaX' | 'deltaY'>): number => {
  const dominantDelta =
    Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  const clampedDelta = Math.max(
    -OBJECT_MAP_WHEEL_ZOOM_DELTA_LIMIT,
    Math.min(OBJECT_MAP_WHEEL_ZOOM_DELTA_LIMIT, -dominantDelta)
  );
  return 1 + (clampedDelta * OBJECT_MAP_WHEEL_ZOOM_SENSITIVITY) / 100;
};

export const fitObjectMapG6GraphToView = async (
  graph: ObjectMapG6ViewportGraph,
  padding: number
): Promise<void> => {
  if (graph.destroyed) return;
  await graph.fitView({ when: 'always', direction: 'both' }, false);
  if (graph.destroyed || padding <= 0) return;
  const [width, height] = graph.getSize();
  if (width <= 0 || height <= 0) return;
  const widthRatio = Math.max(0.01, (width - padding * 2) / width);
  const heightRatio = Math.max(0.01, (height - padding * 2) / height);
  const zoomRatio = Math.min(widthRatio, heightRatio);
  if (zoomRatio < 1) {
    await graph.zoomBy(zoomRatio, false);
  }
};

export const resetObjectMapG6GraphZoom = async (graph: ObjectMapG6ViewportGraph): Promise<void> => {
  if (graph.destroyed) return;
  const [width, height] = graph.getSize();
  await graph.zoomTo(1, false, [width / 2, height / 2]);
};
