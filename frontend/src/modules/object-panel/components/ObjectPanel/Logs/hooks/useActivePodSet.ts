/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useActivePodSet.ts
 *
 * The workload pods whose lines Container Logs shows: lines of pods the workload
 * no longer has are hidden once its pod list is known.
 */

import { compareUtf16Strings } from '@shared/utils/sort';
import { useEffect, useMemo, useRef } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';

export const getWorkloadPodNames = (
  entries: ContainerLogsEntry[],
  activePods: string[] | null
): string[] =>
  (activePods ?? Array.from(new Set(entries.map((entry) => entry.pod).filter(Boolean))))
    .slice()
    .sort(compareUtf16Strings);

// Lines of pods the workload no longer has are hidden. The filter applies only
// once the pod list is known, and an empty list hides every line only after
// pods were seen, so the first, still-loading list does not blank the view.
export const filterEntriesForActivePods = (
  entries: ContainerLogsEntry[],
  activePods: Set<string> | null
): ContainerLogsEntry[] =>
  activePods === null ? entries : entries.filter((entry) => activePods.has(entry.pod));

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
