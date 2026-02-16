/**
 * frontend/src/modules/shell-session/hooks/useShellSessionStatus.ts
 *
 * Aggregates shell session status for the active cluster.
 */

import { useEffect, useMemo, useState } from 'react';
import { ListShellSessions } from '@wailsjs/go/backend/App';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type { StatusState } from '@/components/status/StatusIndicator';

interface ShellSessionInfo {
  sessionId: string;
  clusterId: string;
}

export interface ShellSessionStatusResult {
  status: StatusState;
  totalCount: number;
}

export function useShellSessionStatus(): ShellSessionStatusResult {
  const { selectedClusterId } = useKubeconfig();
  const [sessions, setSessions] = useState<ShellSessionInfo[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const list = await ListShellSessions();
        setSessions(list || []);
      } catch {
        // Ignore initial load errors; events will eventually update state.
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const handleList = (...args: unknown[]) => {
      const list = args[0] as ShellSessionInfo[] | undefined;
      setSessions(list || []);
    };

    const cancel = runtime.EventsOn('object-shell:list', handleList) as unknown as
      | (() => void)
      | undefined;
    return () => {
      cancel?.();
    };
  }, []);

  return useMemo(() => {
    const clusterSessions = selectedClusterId
      ? sessions.filter((session) => session.clusterId === selectedClusterId)
      : sessions;
    const totalCount = clusterSessions.length;
    return {
      status: totalCount > 0 ? 'healthy' : 'inactive',
      totalCount,
    };
  }, [sessions, selectedClusterId]);
}
