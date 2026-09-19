import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import { findLogOverlap } from '../logOverlap';

const entryContentKey = (entry: ContainerLogsEntry): string =>
  JSON.stringify([
    entry.timestamp,
    entry.pod,
    entry.container,
    entry.line,
    entry.isInit,
    Boolean(entry.isEphemeral),
  ]);

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

  const overlap = findLogOverlap(currentEntries, incomingEntries, entryContentKey);
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
