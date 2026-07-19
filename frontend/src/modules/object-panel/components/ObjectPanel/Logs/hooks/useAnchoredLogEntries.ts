import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';

const entryContentKey = (entry: ContainerLogsEntry): string =>
  JSON.stringify([
    entry.timestamp,
    entry.pod,
    entry.container,
    entry.line,
    entry.isInit,
    Boolean(entry.isEphemeral),
  ]);

const longestSuffixPrefixOverlap = (
  currentEntries: ContainerLogsEntry[],
  incomingEntries: ContainerLogsEntry[]
): number => {
  if (currentEntries.length === 0 || incomingEntries.length === 0) {
    return 0;
  }

  const pattern = incomingEntries.map(entryContentKey);
  const prefixLengths = new Uint32Array(pattern.length);
  // Build a prefix table so a rolling buffer can be matched in linear time,
  // even when fallback refreshes regenerate the entries' render sequences.
  for (let index = 1, matched = 0; index < pattern.length; index += 1) {
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = prefixLengths[matched - 1];
    }
    if (pattern[index] === pattern[matched]) {
      matched += 1;
    }
    prefixLengths[index] = matched;
  }

  let matched = 0;
  const comparisonStart = Math.max(0, currentEntries.length - incomingEntries.length);
  for (let index = comparisonStart; index < currentEntries.length; index += 1) {
    const key = entryContentKey(currentEntries[index]);
    while (matched > 0 && key !== pattern[matched]) {
      matched = prefixLengths[matched - 1];
    }
    if (key === pattern[matched]) {
      matched += 1;
    }
    if (matched === pattern.length && index < currentEntries.length - 1) {
      matched = prefixLengths[matched - 1];
    }
  }

  return matched;
};

export const mergeAnchoredLogEntries = (
  currentEntries: ContainerLogsEntry[],
  incomingEntries: ContainerLogsEntry[]
): ContainerLogsEntry[] => {
  if (currentEntries.length === 0) {
    return incomingEntries;
  }
  if (incomingEntries.length === 0) {
    return currentEntries;
  }

  const overlap = longestSuffixPrefixOverlap(currentEntries, incomingEntries);
  if (overlap === incomingEntries.length) {
    return currentEntries;
  }
  return [...currentEntries, ...incomingEntries.slice(overlap)];
};

export const useAnchoredLogEntries = (
  entries: ContainerLogsEntry[],
  isTailFollowing: boolean,
  sourceKey: string
): ContainerLogsEntry[] => {
  const anchoredEntriesRef = useRef(entries);
  const sourceKeyRef = useRef(sourceKey);

  const displayEntries = useMemo(() => {
    if (sourceKeyRef.current !== sourceKey || isTailFollowing) {
      return entries;
    }

    return mergeAnchoredLogEntries(anchoredEntriesRef.current, entries);
  }, [entries, isTailFollowing, sourceKey]);

  useLayoutEffect(() => {
    sourceKeyRef.current = sourceKey;
    anchoredEntriesRef.current = displayEntries;
  }, [displayEntries, sourceKey]);

  return displayEntries;
};
