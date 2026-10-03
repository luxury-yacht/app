import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import { findLogOverlap } from '../logOverlap';
import { filterEntriesForHiddenPods } from './useActivePodSet';

const entryContentKey = (entry: ContainerLogsEntry): string =>
  JSON.stringify([
    entry.timestamp,
    entry.pod,
    entry.container,
    entry.line,
    entry.isInit,
    Boolean(entry.isEphemeral),
  ]);

const mergeByContent = (
  currentEntries: ContainerLogsEntry[],
  incomingEntries: ContainerLogsEntry[]
): ContainerLogsEntry[] => {
  const overlap = findLogOverlap(currentEntries, incomingEntries, entryContentKey);
  if (overlap === incomingEntries.length) {
    return currentEntries;
  }
  return [...currentEntries, ...incomingEntries.slice(overlap)];
};

// An entry keeps its sequence number while it stays in the buffer.
const entryIdentity = (entry: ContainerLogsEntry): unknown => entry._seq ?? entry;

/**
 * The rows a paused view shows after the buffer changes. Rows already shown
 * stay in place, including those the buffer has since evicted: eviction goes
 * by time, and a late line shown after the others can be the first evicted.
 * Entries not shown yet follow them, even one earlier in time; resuming shows
 * the buffer's own order. Only explicit removal takes rows away: the lines of
 * hidden pods, which the workload's pod list no longer has. A buffer that
 * shares no entry with the view (a replaced snapshot) is matched by content.
 */
export const mergeAnchoredLogEntries = (
  currentEntries: ContainerLogsEntry[],
  incomingEntries: ContainerLogsEntry[],
  hiddenPods: Set<string> | null = null
): ContainerLogsEntry[] => {
  const kept = filterEntriesForHiddenPods(currentEntries, hiddenPods);
  const visible = filterEntriesForHiddenPods(incomingEntries, hiddenPods);
  if (kept.length === 0) {
    return visible;
  }
  if (visible.length === 0) {
    return kept;
  }
  const shown = new Set(kept.map(entryIdentity));
  if (!visible.some((entry) => shown.has(entryIdentity(entry)))) {
    return mergeByContent(kept, visible);
  }
  const added = visible.filter((entry) => !shown.has(entryIdentity(entry)));
  return added.length === 0 ? kept : kept.concat(added);
};

export const useAnchoredLogEntries = (
  entries: ContainerLogsEntry[],
  hiddenPods: Set<string> | null,
  isTailFollowing: boolean,
  sourceKey: string
): ContainerLogsEntry[] => {
  const anchoredEntriesRef = useRef(entries);
  const sourceKeyRef = useRef(sourceKey);

  const displayEntries = useMemo(() => {
    if (sourceKeyRef.current !== sourceKey || isTailFollowing) {
      return filterEntriesForHiddenPods(entries, hiddenPods);
    }

    return mergeAnchoredLogEntries(anchoredEntriesRef.current, entries, hiddenPods);
  }, [entries, hiddenPods, isTailFollowing, sourceKey]);

  useLayoutEffect(() => {
    sourceKeyRef.current = sourceKey;
    anchoredEntriesRef.current = displayEntries;
  }, [displayEntries, sourceKey]);

  return displayEntries;
};
