import { useMemo, useRef } from 'react';

const hasSameArrayItems = <T>(previous: T[], next: T[]): boolean =>
  previous.length === next.length &&
  previous.every((item, index) => areEquivalentValues(item, next[index]));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const areEquivalentValues = (previous: unknown, next: unknown): boolean => {
  if (Object.is(previous, next)) {
    return true;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    return hasSameArrayItems(previous, next);
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    return hasSameObjectFields(previous, next);
  }
  return false;
};

const hasSameObjectFields = (
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): boolean => {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every(
      (key) =>
        Object.getOwnPropertyDescriptor(next, key) !== undefined &&
        areEquivalentValues(previous[key], next[key])
    )
  );
};

const reusePreviousSelectionReference = <T>(previous: T | undefined, next: T): T => {
  return previous !== undefined && areEquivalentValues(previous, next) ? previous : next;
};

/**
 * Preserve a previous selected value reference when the next value is
 * equivalent, including nested arrays and objects. This keeps typed table feeds
 * from manufacturing fresh arrays/metadata objects on every provider render.
 */
export const useStableSelectedValue = <T>(value: T): T => {
  const previousRef = useRef<T | undefined>(undefined);

  return useMemo(() => {
    const stableValue = reusePreviousSelectionReference(previousRef.current, value);
    previousRef.current = stableValue;
    return stableValue;
  }, [value]);
};
