export interface StableListEntry<T> {
  key: string;
  value: T;
}

export const withStableListKeys = <T>(
  values: readonly T[],
  getBaseKey: (value: T) => string
): StableListEntry<T>[] => {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const baseKey = getBaseKey(value);
    const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
    occurrences.set(baseKey, occurrence);
    return {
      key: occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`,
      value,
    };
  });
};
