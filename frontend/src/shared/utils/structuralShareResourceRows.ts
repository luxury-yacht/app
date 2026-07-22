import type { CanonicalResourceRef } from '@/core/refresh/types';

export type ResourceRowSharingMode = 'ref-only' | 'row-and-ref';

interface CanonicalResourceRow {
  ref: CanonicalResourceRef;
}

const canonicalRefKey = (ref: CanonicalResourceRef): string =>
  [
    ref.clusterId,
    ref.group,
    ref.version,
    ref.kind,
    ref.resource,
    ref.namespace ?? '',
    ref.name,
  ].join('\0');

const canonicalRefsEqual = (left: CanonicalResourceRef, right: CanonicalResourceRef): boolean =>
  left.clusterId === right.clusterId &&
  left.group === right.group &&
  left.version === right.version &&
  left.kind === right.kind &&
  left.resource === right.resource &&
  left.namespace === right.namespace &&
  left.name === right.name &&
  left.uid === right.uid;

const enumerableValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => enumerableValuesEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) => rightKeys.includes(key) && enumerableValuesEqual(leftRecord[key], rightRecord[key])
  );
};

export const structuralShareResourceRows = <T extends CanonicalResourceRow>(
  previous: readonly T[],
  incoming: T[],
  mode: ResourceRowSharingMode
): T[] => {
  if (previous.length === 0 || incoming.length === 0) {
    return incoming;
  }

  const previousByKey = new Map<string, T | null>();
  previous.forEach((row) => {
    const key = canonicalRefKey(row.ref);
    previousByKey.set(key, previousByKey.has(key) ? null : row);
  });
  const consumedKeys = new Set<string>();
  if (mode === 'ref-only') {
    incoming.forEach((row) => {
      const key = canonicalRefKey(row.ref);
      const candidate = consumedKeys.has(key) ? null : previousByKey.get(key);
      consumedKeys.add(key);
      if (candidate && canonicalRefsEqual(candidate.ref, row.ref)) {
        row.ref = candidate.ref;
      }
    });
    return incoming;
  }

  let sameOrder = previous.length === incoming.length;
  const shared = incoming.map((row, index) => {
    const key = canonicalRefKey(row.ref);
    const candidate = consumedKeys.has(key) ? null : previousByKey.get(key);
    consumedKeys.add(key);
    if (!candidate || !canonicalRefsEqual(candidate.ref, row.ref)) {
      sameOrder = false;
      return row;
    }

    row.ref = candidate.ref;
    if (enumerableValuesEqual(candidate, row)) {
      if (previous[index] !== candidate) {
        sameOrder = false;
      }
      return candidate;
    }
    sameOrder = false;
    return row;
  });

  return sameOrder ? (previous as T[]) : shared;
};
