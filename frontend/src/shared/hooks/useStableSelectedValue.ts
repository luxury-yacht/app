import { useMemo, useRef } from 'react';

const hasSameArrayItems = <T>(previous: T[], next: T[]): boolean =>
  previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasSameShallowObjectShape = (
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): boolean => {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(next, key) && Object.is(previous[key], next[key])
    )
  );
};

export const reusePreviousSelectionReference = <T>(previous: T | undefined, next: T): T => {
  if (previous === undefined || Object.is(previous, next)) {
    return previous ?? next;
  }
  if (Array.isArray(previous) && Array.isArray(next) && hasSameArrayItems(previous, next)) {
    return previous as T;
  }
  if (isPlainObject(previous) && isPlainObject(next) && hasSameShallowObjectShape(previous, next)) {
    return previous as T;
  }
  return next;
};

/**
 * Preserve a previous selected value reference when the next value is
 * shallowly identical. This keeps typed table feeds from manufacturing
 * fresh arrays/metadata objects on every provider render.
 */
export const useStableSelectedValue = <T>(value: T): T => {
  const previousRef = useRef<T | undefined>(undefined);

  return useMemo(() => {
    const stableValue = reusePreviousSelectionReference(previousRef.current, value);
    previousRef.current = stableValue;
    return stableValue;
  }, [value]);
};
