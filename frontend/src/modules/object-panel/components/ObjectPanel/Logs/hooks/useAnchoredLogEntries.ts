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
 * stay in place, including those the buffer has since evicted from its front,
 * so the viewport does not move. Rows the buffer dropped after that front (a
 * deleted pod's lines) leave, and entries not shown yet follow the shown rows,
 * even one the buffer inserted earlier in time; resuming shows the buffer's own
 * order. A buffer that shares no entry with the view (a replaced snapshot) is
 * matched by content instead.
 */
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

  const incoming = new Set(incomingEntries.map(entryIdentity));
  const firstHeld = currentEntries.findIndex((entry) => incoming.has(entryIdentity(entry)));
  if (firstHeld === -1) {
    return mergeByContent(currentEntries, incomingEntries);
  }
  const kept = currentEntries.filter(
    (entry, index) => index < firstHeld || incoming.has(entryIdentity(entry))
  );
  const shown = new Set(currentEntries.map(entryIdentity));
  const added = incomingEntries.filter((entry) => !shown.has(entryIdentity(entry)));
  if (added.length === 0 && kept.length === currentEntries.length) {
    return currentEntries;
  }
  return added.length === 0 ? kept : kept.concat(added);
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
