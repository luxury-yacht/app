/**
 * frontend/src/modules/port-forward/hooks/usePortForwardStatus.ts
 *
 * Hook that aggregates port forward session status for the active cluster.
 * Listens to portforward:list and portforward:status Wails events.
 * Returns a shared status state and summary counts for the header indicator.
 */

import { useState, useEffect, useMemo } from 'react';
import { EventsOn } from '@wailsjs/runtime/runtime';
import { ListPortForwards } from '@wailsjs/go/backend/App';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type { StatusState } from '@/components/status/StatusIndicator';

/** Mirrors the backend PortForwardSession struct (subset of fields we need). */
interface PortForwardSession {
  id: string;
  clusterId: string;
  status: string;
}

/** Status event payload from the backend. */
interface PortForwardStatusEvent {
  sessionId: string;
  status: string;
}

export interface PortForwardStatusResult {
  /** Shared status state for the indicator dot. */
  status: StatusState;
  /** Total number of sessions for the active cluster. */
  totalCount: number;
  /** Number of sessions in 'active' status. */
  healthyCount: number;
  /** Number of sessions not in 'active' status. */
  unhealthyCount: number;
}

/**
 * Returns aggregate port forward status for the active cluster.
 */
export function usePortForwardStatus(): PortForwardStatusResult {
  const { selectedClusterId } = useKubeconfig();
  const [sessions, setSessions] = useState<PortForwardSession[]>([]);

  // Load initial session list on mount.
  useEffect(() => {
    const load = async () => {
      try {
        const list = await ListPortForwards();
        setSessions(list || []);
      } catch {
        // Silently ignore — sessions will populate via events.
      }
    };
    void load();
  }, []);

  // Subscribe to Wails events for session updates.
  useEffect(() => {
    const handleList = (list: PortForwardSession[]) => {
      setSessions(list || []);
    };

    const handleStatus = (event: PortForwardStatusEvent) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === event.sessionId ? { ...s, status: event.status } : s
        )
      );
    };

    // EventsOn returns a cancel function — use it instead of EventsOff
    // to avoid removing listeners registered by other components.
    const cancelList = EventsOn('portforward:list', handleList);
    const cancelStatus = EventsOn('portforward:status', handleStatus);

    return () => {
      cancelList();
      cancelStatus();
    };
  }, []);

  // Compute aggregate status for the active cluster.
  return useMemo(() => {
    // Filter to sessions for the active cluster only.
    const clusterSessions = selectedClusterId
      ? sessions.filter((s) => s.clusterId === selectedClusterId)
      : sessions;

    const totalCount = clusterSessions.length;
    const healthyCount = clusterSessions.filter((s) => s.status === 'active').length;
    const unhealthyCount = totalCount - healthyCount;

    let status: StatusState;
    if (totalCount === 0) {
      status = 'inactive';
    } else if (healthyCount === totalCount) {
      status = 'healthy';
    } else if (healthyCount === 0) {
      status = 'unhealthy';
    } else {
      status = 'degraded';
    }

    return { status, totalCount, healthyCount, unhealthyCount };
  }, [sessions, selectedClusterId]);
}
