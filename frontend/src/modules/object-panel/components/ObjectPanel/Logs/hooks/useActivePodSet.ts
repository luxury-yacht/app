/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useActivePodSet.ts
 *
 * The workload pods whose lines Container Logs shows: lines of pods the workload
 * no longer has are hidden once its pod list is known. The list applies only
 * once it is known, and an empty list hides every line only after pods were
 * seen, so the first, still-loading list does not blank the view.
 */

import { compareUtf16Strings } from '@shared/utils/sort';
import { useEffect, useMemo, useRef } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';

// The pods the Pods dropdown offers: the workload's pod list and the pods with
// lines, which stream before the list names them, less the hidden pods.
export const getWorkloadPodNames = (
  sourcePods: readonly string[],
  activePods: string[] | null,
  hiddenPods: Set<string> | null
): string[] => {
  const names = new Set(activePods ?? []);
  for (const pod of sourcePods) {
    if (pod && !hiddenPods?.has(pod)) {
      names.add(pod);
    }
  }
  return Array.from(names).sort(compareUtf16Strings);
};

export const filterEntriesForHiddenPods = (
  entries: ContainerLogsEntry[],
  hiddenPods: Set<string> | null
): ContainerLogsEntry[] =>
  hiddenPods === null || hiddenPods.size === 0
    ? entries
    : entries.filter((entry) => !hiddenPods.has(entry.pod));

const podsMissingFrom = (entries: ContainerLogsEntry[], activePods: Set<string>): Set<string> => {
  const missing = new Set<string>();
  for (const entry of entries) {
    if (!activePods.has(entry.pod)) {
      missing.add(entry.pod);
    }
  }
  return missing;
};

/**
 * The pods whose lines are hidden: those that had lines when the workload's
 * latest pod list arrived but are not in it. The list is refreshed every few
 * seconds and can lag a pod that just started, so a pod whose first line
 * arrives after the list stays visible until the next list decides.
 */
export const useHiddenPods = (
  entries: ContainerLogsEntry[],
  activePods: Set<string> | null
): Set<string> | null => {
  const judgedRef = useRef<{ activePods: Set<string> | null; hidden: Set<string> | null }>({
    activePods: null,
    hidden: null,
  });
  // Judged during render only when a new list arrives, so each batch of lines
  // does not rescan the buffer.
  if (judgedRef.current.activePods !== activePods) {
    judgedRef.current = {
      activePods,
      hidden: activePods === null ? null : podsMissingFrom(entries, activePods),
    };
  }
  return judgedRef.current.hidden;
};

const NO_ACTIVE_PODS = new Set<string>();

const normalizeActivePodNames = (activePodNames: string[] | null): string[] | null =>
  activePodNames === null
    ? null
    : activePodNames
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter((name) => name.length > 0);

export const useActivePodSet = (
  activePodNames: string[] | null,
  enabled: boolean,
  scope: string | null
): Set<string> | null => {
  const seenPodsRef = useRef<{ scope: string | null; seen: boolean }>({ scope, seen: false });
  // Reset during render, like syncContainerLogsScope, so a new scope never
  // inherits the previous one's history.
  if (seenPodsRef.current.scope !== scope) {
    seenPodsRef.current = { scope, seen: false };
  }
  const names = useMemo(() => normalizeActivePodNames(activePodNames), [activePodNames]);
  const activePods = useMemo(() => (names && names.length > 0 ? new Set(names) : null), [names]);
  useEffect(() => {
    if (enabled && activePods) {
      seenPodsRef.current.seen = true;
    }
  }, [activePods, enabled]);
  if (!enabled || names === null) {
    return null;
  }
  return activePods ?? (seenPodsRef.current.seen ? NO_ACTIVE_PODS : null);
};
