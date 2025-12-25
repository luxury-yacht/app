/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceGC.ts
 *
 * UI component for gridTablePersistenceGC.
 * Handles rendering and interactions for the shared components.
 */

import { computeClusterHash } from '@shared/components/tables/persistence/gridTablePersistence';
import { listRegisteredGridTableViews } from '@shared/components/tables/persistence/gridTableViewRegistry';

const STORAGE_PREFIX = 'gridtable';
const STORAGE_VERSION = 1;

interface ParsedKey {
  version: number;
  clusterHash: string;
  viewId: string;
  namespace: string | null;
}

const parseStorageKey = (key: string): ParsedKey | null => {
  if (!key.startsWith(`${STORAGE_PREFIX}:`)) {
    return null;
  }
  const match = key.match(/^gridtable:v(\d+):([^:]+):([^:]+?)(?::(.*))?$/);
  if (!match) {
    return null;
  }
  const version = Number(match[1]);
  if (!Number.isFinite(version)) {
    return null;
  }
  try {
    const clusterHash = decodeURIComponent(match[2]);
    const viewId = decodeURIComponent(match[3]);
    const namespace = match[4] && match[4].length > 0 ? decodeURIComponent(match[4]) : null;
    return { version, clusterHash, viewId, namespace };
  } catch {
    return null;
  }
};

export interface GridTableGCOptions {
  storage?: Storage | null;
  activeClusterHashes?: string[];
  registeredViews?: string[];
}

export interface GridTableGCResult {
  removed: string[];
  kept: string[];
}

export const runGridTableGC = (options: GridTableGCOptions = {}): GridTableGCResult => {
  const storage =
    options.storage ??
    (() => {
      try {
        return typeof window !== 'undefined' ? window.localStorage : null;
      } catch {
        return null;
      }
    })();

  if (!storage) {
    return { removed: [], kept: [] };
  }

  const activeHashes = new Set(
    (options.activeClusterHashes ?? []).map((value) => value?.trim()).filter(Boolean) as string[]
  );
  const registeredViews = new Set(
    (options.registeredViews ?? listRegisteredGridTableViews()).map((value) => value?.trim())
  );

  const removed: string[] = [];
  const kept: string[] = [];

  // Copy keys first to avoid mutating while iterating storage
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key) {
      keys.push(key);
    }
  }

  keys.forEach((key) => {
    const parsed = parseStorageKey(key);
    if (!parsed) {
      storage.removeItem(key);
      removed.push(key);
      return;
    }

    if (parsed.version !== STORAGE_VERSION) {
      storage.removeItem(key);
      removed.push(key);
      return;
    }

    if (registeredViews.size > 0 && !registeredViews.has(parsed.viewId)) {
      storage.removeItem(key);
      removed.push(key);
      return;
    }

    if (activeHashes.size > 0 && !activeHashes.has(parsed.clusterHash)) {
      storage.removeItem(key);
      removed.push(key);
      return;
    }

    kept.push(key);
  });

  return { removed, kept };
};

export const computeClusterHashes = async (clusterIdentities: string[]): Promise<string[]> => {
  const hashes: string[] = [];
  for (const identity of clusterIdentities) {
    if (!identity || identity.trim().length === 0) {
      continue;
    }
    const hash = await computeClusterHash(identity);
    if (hash) {
      hashes.push(hash);
    }
  }
  return Array.from(new Set(hashes));
};
