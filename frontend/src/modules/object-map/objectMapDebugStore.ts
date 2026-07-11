/**
 * frontend/src/modules/object-map/objectMapDebugStore.ts
 *
 * Lightweight external store for object-map debug overlay snapshots.
 */

import type { ObjectMapReference } from '@core/refresh/types';
import { useSyncExternalStore } from 'react';
import type {
  ObjectMapG6CardDetailLevel,
  ObjectMapG6EdgeDetailLevel,
} from './objectMapG6Constants';
import type { ObjectMapLayout } from './objectMapLayout';

export interface ObjectMapRendererDebugSnapshot {
  graphReady: boolean;
  renderedNodeCount: number;
  renderedEdgeCount: number;
  cardDetailLevel: ObjectMapG6CardDetailLevel;
  edgeDetailLevel: ObjectMapG6EdgeDetailLevel;
  viewport: {
    zoom: number;
    position: [number, number];
    size: [number, number];
  } | null;
  timings: {
    g6DataMs: number | null;
    graphDataApplyMs: number | null;
    graphDataApplyMode: 'initial-render' | 'update' | null;
    selectionStateApplyMs: number | null;
  };
  updatedAt: number;
}

export interface ObjectMapDebugSnapshot {
  id: string;
  clusterId: string;
  clusterName?: string;
  seedRef: ObjectMapReference;
  seedNodeId: string;
  activeNodeId: string | null;
  focusMode: boolean;
  autoFit: boolean;
  selectedKinds: string[];
  enabledEdgeTypes: string[] | null;
  preserveViewportNodeId: string | null;
  payload: {
    nodes: number;
    edges: number;
    maxDepth: number;
    maxNodes: number;
    truncated: boolean;
    warnings: number;
  };
  layout: Pick<ObjectMapLayout, 'bounds'> & {
    nodes: number;
    edges: number;
  };
  visibleLayout: Pick<ObjectMapLayout, 'bounds'> & {
    nodes: number;
    edges: number;
  };
  search: {
    query: string;
    matches: number;
  };
  timings: {
    modelMs: number;
    visibleStateMs: number;
  };
  renderer: ObjectMapRendererDebugSnapshot | null;
  updatedAt: number;
}

const listeners = new Set<() => void>();
const overlayVisibilityListeners = new Set<() => void>();
const snapshots = new Map<string, ObjectMapDebugSnapshot>();
let snapshotCache: ObjectMapDebugSnapshot[] = [];
let nextId = 1;
let isDebugOverlayVisible = false;

const emit = () => {
  snapshotCache = Array.from(snapshots.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  listeners.forEach((listener) => {
    listener();
  });
};

export const createObjectMapDebugId = (): string => {
  const id = `object-map-${nextId}`;
  nextId += 1;
  return id;
};

export const publishObjectMapDebugSnapshot = (snapshot: ObjectMapDebugSnapshot): void => {
  const previous = snapshots.get(snapshot.id);
  snapshots.set(snapshot.id, {
    ...snapshot,
    renderer: previous?.renderer ?? snapshot.renderer,
  });
  emit();
};

export const publishObjectMapRendererDebugSnapshot = (
  id: string,
  renderer: ObjectMapRendererDebugSnapshot
): void => {
  const previous = snapshots.get(id);
  if (!previous) {
    return;
  }
  snapshots.set(id, { ...previous, renderer, updatedAt: Date.now() });
  emit();
};

export const removeObjectMapDebugSnapshot = (id: string): void => {
  if (!snapshots.delete(id)) {
    return;
  }
  emit();
};

export const setObjectMapDebugOverlayVisible = (isVisible: boolean): void => {
  if (isDebugOverlayVisible === isVisible) {
    return;
  }
  isDebugOverlayVisible = isVisible;
  overlayVisibilityListeners.forEach((listener) => {
    listener();
  });
};

const subscribeObjectMapDebugSnapshots = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getObjectMapDebugSnapshots = (): ObjectMapDebugSnapshot[] => snapshotCache;

const subscribeObjectMapDebugOverlayVisible = (listener: () => void): (() => void) => {
  overlayVisibilityListeners.add(listener);
  return () => {
    overlayVisibilityListeners.delete(listener);
  };
};

const getObjectMapDebugOverlayVisible = (): boolean => isDebugOverlayVisible;

export const useObjectMapDebugSnapshots = (): ObjectMapDebugSnapshot[] =>
  useSyncExternalStore(
    subscribeObjectMapDebugSnapshots,
    getObjectMapDebugSnapshots,
    getObjectMapDebugSnapshots
  );

export const useObjectMapDebugOverlayVisible = (): boolean =>
  useSyncExternalStore(
    subscribeObjectMapDebugOverlayVisible,
    getObjectMapDebugOverlayVisible,
    getObjectMapDebugOverlayVisible
  );
