# Status Indicators Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single `RefreshStatusIndicator` with three independent status indicators (Connectivity, Metrics, Port Forwards), each built on a shared `StatusIndicator` component with popover support.

**Architecture:** A shared `StatusIndicator` component provides the dot + popover UI. Three wrapper components (`ConnectivityStatus`, `MetricsStatus`, `PortForwardStatus`) map domain-specific logic to five shared status states (`healthy`, `refreshing`, `degraded`, `unhealthy`, `inactive`). CSS variables for these states are defined once in theme files. A new `usePortForwardStatus` hook aggregates port forward session state per cluster.

**Tech Stack:** React, TypeScript, CSS custom properties, Wails runtime events

**Design doc:** `docs/plans/2026-02-04-status-indicators-design.md`

---

### Task 1: Add shared status CSS variables to theme files

Replace the old per-indicator `--refresh-status-*` and `--refresh-metrics-*` variables with five shared `--status-*` variable pairs in both theme files.

**Files:**
- Modify: `frontend/styles/themes/dark.css:254-268`
- Modify: `frontend/styles/themes/light.css:253-267`

**Step 1: Replace variables in dark.css**

Find the `/* Refresh indicators */` block (lines 254-268) and replace with:

```css
  /* Status indicator states */
  --status-healthy: #4ade80;
  --status-healthy-shadow: rgba(74, 222, 128, 0.5);
  --status-refreshing: #4ade80;
  --status-refreshing-shadow: rgba(74, 222, 128, 0.7);
  --status-degraded: var(--color-gold-400);
  --status-degraded-shadow: rgba(251, 191, 36, 0.7);
  --status-unhealthy: #f87171;
  --status-unhealthy-shadow: rgba(248, 113, 113, 0.8);
  --status-inactive: var(--color-gray-500);
  --status-inactive-shadow: none;
```

**Step 2: Replace variables in light.css**

Find the `/* Refresh indicators */` block (lines 253-267) and replace with:

```css
  /* Status indicator states */
  --status-healthy: #22c55e;
  --status-healthy-shadow: rgba(34, 197, 94, 0.5);
  --status-refreshing: #22c55e;
  --status-refreshing-shadow: rgba(34, 197, 94, 0.7);
  --status-degraded: #f59e0b;
  --status-degraded-shadow: rgba(245, 158, 11, 0.6);
  --status-unhealthy: #ef4444;
  --status-unhealthy-shadow: rgba(239, 68, 68, 0.6);
  --status-inactive: var(--color-gray-400);
  --status-inactive-shadow: none;
```

**Step 3: Verify no other files reference the old variables**

Run: `cd /Volumes/git/luxury-yacht/app && grep -r "refresh-status-\|refresh-metrics-dot" frontend/src frontend/styles --include="*.css" --include="*.tsx" --include="*.ts" -l`

Expected: Only `RefreshStatusIndicator.css` and `RefreshStatusIndicator.tsx` (which will be deleted later). If other files reference them, update those too.

---

### Task 2: Create the shared StatusIndicator component

Build the reusable dot + popover component that all three indicators will use.

**Files:**
- Create: `frontend/src/components/status/StatusIndicator.tsx`
- Create: `frontend/src/components/status/StatusIndicator.css`

**Step 1: Create StatusIndicator.css**

```css
/* Shared status indicator dot + popover */

.status-indicator {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  padding: 4px;
}

.status-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: all 0.3s ease;
}

/* State: healthy - solid green */
.status-indicator-dot[data-status="healthy"] {
  background-color: var(--status-healthy);
  box-shadow: 0 0 4px var(--status-healthy-shadow);
}

/* State: refreshing - green with pulse */
.status-indicator-dot[data-status="refreshing"] {
  background-color: var(--status-refreshing);
  box-shadow: 0 0 6px var(--status-refreshing-shadow);
  animation: status-pulse 1s infinite;
}

/* State: degraded - amber with pulse */
.status-indicator-dot[data-status="degraded"] {
  background-color: var(--status-degraded);
  box-shadow: 0 0 4px var(--status-degraded-shadow);
  animation: status-pulse 1.2s infinite;
}

/* State: unhealthy - red */
.status-indicator-dot[data-status="unhealthy"] {
  background-color: var(--status-unhealthy);
  box-shadow: 0 0 6px var(--status-unhealthy-shadow);
}

/* State: inactive - gray, no shadow */
.status-indicator-dot[data-status="inactive"] {
  background-color: var(--status-inactive);
  box-shadow: var(--status-inactive-shadow);
}

@keyframes status-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

/* Popover - appears below the dot */
.status-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  max-width: 260px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-sm);
  box-shadow: var(--tooltip-shadow);
  padding: 10px 12px;
  z-index: 1000;
  font-size: 12px;
}

.status-popover-title {
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
}

.status-popover-message {
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.status-popover-action {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.status-popover-action button {
  font-size: 11px;
  padding: 2px 8px;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.status-popover-action button:hover {
  background: var(--hover-bg);
  color: var(--color-text);
}
```

**Step 2: Create StatusIndicator.tsx**

```tsx
/**
 * frontend/src/components/status/StatusIndicator.tsx
 *
 * Shared status indicator component.
 * Renders a colored dot with an optional popover that appears below.
 * All three header indicators (Connectivity, Metrics, Port Forwards) use this.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './StatusIndicator.css';

/** The five shared status states. */
export type StatusState = 'healthy' | 'refreshing' | 'degraded' | 'unhealthy' | 'inactive';

export interface StatusIndicatorProps {
  /** Current status state — drives the dot color and animation. */
  status: StatusState;
  /** Popover title (e.g., "Connectivity"). */
  title: string;
  /** Popover status message (e.g., "Connected"). */
  message: string;
  /** Optional action button label (e.g., "Refresh"). Omit to hide the button. */
  actionLabel?: string;
  /** Called when the action button is clicked. */
  onAction?: () => void;
  /** Accessible label for screen readers. */
  ariaLabel: string;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  title,
  message,
  actionLabel,
  onAction,
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /** Close the popover when clicking outside or pressing Escape. */
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleClickOutside, handleKeyDown]);

  return (
    <div
      className="status-indicator"
      ref={ref}
      onClick={() => setIsOpen((prev) => !prev)}
      aria-label={ariaLabel}
      role="button"
      tabIndex={0}
    >
      <div className="status-indicator-dot" data-status={status} />
      {isOpen && (
        <div className="status-popover">
          <div className="status-popover-title">{title}</div>
          <div className="status-popover-message">{message}</div>
          {actionLabel && onAction && (
            <div className="status-popover-action">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAction();
                }}
              >
                {actionLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(StatusIndicator);
```

**Step 3: Verify the component compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors related to StatusIndicator files.

---

### Task 3: Create ConnectivityStatus component

Wraps `StatusIndicator` with connectivity-specific logic. Replaces the connectivity half of `RefreshStatusIndicator`.

**Files:**
- Create: `frontend/src/components/status/ConnectivityStatus.tsx`

**Step 1: Create ConnectivityStatus.tsx**

```tsx
/**
 * frontend/src/components/status/ConnectivityStatus.tsx
 *
 * Connectivity status indicator for the app header.
 * Maps cluster health and auth state to shared status states.
 * Click action: refresh cluster connection or retry auth.
 */

import React, { useEffect, useState, useCallback } from 'react';
import StatusIndicator, { type StatusState } from './StatusIndicator';
import { refreshOrchestrator } from '@/core/refresh';
import { useClusterHealthListener } from '@/hooks/useWailsRuntimeEvents';
import { useAuthError, useActiveClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';

const ConnectivityStatus: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const { selectedClusterId } = useKubeconfig();
  const { getActiveClusterHealth } = useClusterHealthListener(selectedClusterId);
  const { handleRetry } = useAuthError();
  const authState = useActiveClusterAuthState(selectedClusterId);

  useEffect(() => {
    setIsPaused(!getAutoRefreshEnabled());

    const unsubStart = eventBus.on('refresh:start', () => setIsRefreshing(true));
    const unsubComplete = eventBus.on('refresh:complete', () => setIsRefreshing(false));
    const unsubAutoRefresh = eventBus.on('settings:auto-refresh', (enabled) => {
      setIsPaused(!enabled);
    });

    return () => {
      unsubStart();
      unsubComplete();
      unsubAutoRefresh();
    };
  }, []);

  const health = getActiveClusterHealth();

  /** Map domain state to shared status state. */
  const getStatus = (): StatusState => {
    if (isPaused) return 'inactive';
    if (authState.hasError && authState.isRecovering) return 'degraded';
    if (authState.hasError) return 'unhealthy';
    if (health === 'degraded') return 'unhealthy';
    if (isRefreshing) return 'refreshing';
    return 'healthy';
  };

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (isPaused) return 'Auto-refresh paused';
    if (authState.hasError && authState.isRecovering) return 'Retrying authentication...';
    if (authState.hasError) return authState.reason || 'Authentication failed';
    if (health === 'degraded') return 'Connection lost';
    if (isRefreshing) return 'Refreshing...';
    return 'Connected';
  };

  /** Determine the action button label. */
  const getActionLabel = (): string | undefined => {
    if (isPaused) return undefined;
    if (authState.hasError && !authState.isRecovering) return 'Retry Auth';
    if (authState.hasError && authState.isRecovering) return undefined;
    if (health === 'degraded') return undefined;
    return 'Refresh';
  };

  /** Handle the action button click. */
  const handleAction = useCallback(() => {
    if (authState.hasError && !authState.isRecovering && selectedClusterId) {
      void handleRetry(selectedClusterId);
      return;
    }
    void refreshOrchestrator.triggerManualRefreshForContext();
  }, [authState, selectedClusterId, handleRetry]);

  const status = getStatus();
  const actionLabel = getActionLabel();

  return (
    <StatusIndicator
      status={status}
      title="Connectivity"
      message={getMessage()}
      actionLabel={actionLabel}
      onAction={actionLabel ? handleAction : undefined}
      ariaLabel={`Connectivity: ${getMessage()}`}
    />
  );
};

export default React.memo(ConnectivityStatus);
```

**Step 2: Verify compilation**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

---

### Task 4: Create MetricsStatus component

Wraps `StatusIndicator` with metrics-specific logic. Replaces the metrics half of `RefreshStatusIndicator`.

**Files:**
- Create: `frontend/src/components/status/MetricsStatus.tsx`

**Step 1: Create MetricsStatus.tsx**

```tsx
/**
 * frontend/src/components/status/MetricsStatus.tsx
 *
 * Metrics status indicator for the app header.
 * Always visible. Maps metrics availability to shared status states.
 * No click action — popover is informational only.
 */

import React from 'react';
import StatusIndicator, { type StatusState } from './StatusIndicator';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';

const MetricsStatus: React.FC = () => {
  const metricsInfo = useClusterMetricsAvailability();

  /** Map metrics state to shared status state. */
  const getStatus = (): StatusState => {
    if (!metricsInfo) return 'inactive';

    const bannerInfo = getMetricsBannerInfo(metricsInfo);

    // No banner info means metrics are healthy.
    if (!bannerInfo) return 'healthy';

    // Has an error — distinguish degraded (stale/intermittent) vs unhealthy (unavailable).
    if (metricsInfo.lastError) return 'unhealthy';
    if (metricsInfo.stale) return 'degraded';

    return 'degraded';
  };

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (!metricsInfo) return 'Awaiting metrics data...';

    const bannerInfo = getMetricsBannerInfo(metricsInfo);
    if (!bannerInfo) return 'Metrics available';

    return bannerInfo.message;
  };

  return (
    <StatusIndicator
      status={getStatus()}
      title="Metrics"
      message={getMessage()}
      ariaLabel={`Metrics: ${getMessage()}`}
    />
  );
};

export default React.memo(MetricsStatus);
```

**Step 2: Verify compilation**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

---

### Task 5: Create usePortForwardStatus hook

Aggregates port forward session state per cluster using existing Wails events.

**Files:**
- Create: `frontend/src/modules/port-forward/hooks/usePortForwardStatus.ts`

**Step 1: Create the hook**

```ts
/**
 * frontend/src/modules/port-forward/hooks/usePortForwardStatus.ts
 *
 * Hook that aggregates port forward session status for the active cluster.
 * Listens to portforward:list and portforward:status Wails events.
 * Returns a shared status state and summary counts for the header indicator.
 */

import { useState, useEffect, useMemo } from 'react';
import { EventsOn, EventsOff } from '@wailsjs/runtime/runtime';
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

    EventsOn('portforward:list', handleList);
    EventsOn('portforward:status', handleStatus);

    return () => {
      EventsOff('portforward:list');
      EventsOff('portforward:status');
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
```

**Step 2: Verify compilation**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

---

### Task 6: Create PortForwardStatus component

Wraps `StatusIndicator` with port-forward-specific logic. Opens the port forward panel on click.

**Files:**
- Create: `frontend/src/components/status/PortForwardStatus.tsx`

**Step 1: Create PortForwardStatus.tsx**

```tsx
/**
 * frontend/src/components/status/PortForwardStatus.tsx
 *
 * Port forward status indicator for the app header.
 * Always visible. Gray when no forwards exist, color-coded otherwise.
 * Click action: open the port forwards panel.
 */

import React, { useCallback } from 'react';
import StatusIndicator from './StatusIndicator';
import { usePortForwardStatus } from '@modules/port-forward/hooks/usePortForwardStatus';
import { usePortForwardsPanel } from '@modules/port-forward/PortForwardsPanel';

const PortForwardStatus: React.FC = () => {
  const { status, totalCount, healthyCount, unhealthyCount } = usePortForwardStatus();
  const panel = usePortForwardsPanel();

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (totalCount === 0) return 'No port forwards';
    if (unhealthyCount === 0) {
      return `${totalCount} port forward${totalCount === 1 ? '' : 's'} active`;
    }
    if (healthyCount === 0) {
      return `All ${totalCount} port forward${totalCount === 1 ? '' : 's'} unhealthy`;
    }
    return `${unhealthyCount} of ${totalCount} port forward${totalCount === 1 ? '' : 's'} unhealthy`;
  };

  const handleAction = useCallback(() => {
    panel.setOpen(true);
  }, [panel]);

  const message = getMessage();

  return (
    <StatusIndicator
      status={status}
      title="Port Forwards"
      message={message}
      actionLabel={totalCount > 0 ? 'Manage' : undefined}
      onAction={totalCount > 0 ? handleAction : undefined}
      ariaLabel={`Port Forwards: ${message}`}
    />
  );
};

export default React.memo(PortForwardStatus);
```

**Step 2: Verify compilation**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

---

### Task 7: Wire up indicators in AppHeader and remove old component

Replace `RefreshStatusIndicator` with the three new components in `AppHeader`. Delete the old files.

**Files:**
- Modify: `frontend/src/ui/layout/AppHeader.tsx`
- Delete: `frontend/src/components/refresh/RefreshStatusIndicator.tsx`
- Delete: `frontend/src/components/refresh/RefreshStatusIndicator.css`

**Step 1: Update AppHeader.tsx imports**

Replace the import on line 10:
```tsx
import RefreshStatusIndicator from '@components/refresh/RefreshStatusIndicator';
```
With:
```tsx
import ConnectivityStatus from '@components/status/ConnectivityStatus';
import MetricsStatus from '@components/status/MetricsStatus';
import PortForwardStatus from '@components/status/PortForwardStatus';
```

**Step 2: Update AppHeader.tsx render**

Replace line 70:
```tsx
        <RefreshStatusIndicator />
```
With:
```tsx
        <ConnectivityStatus />
        <MetricsStatus />
        <PortForwardStatus />
```

**Step 3: Delete old files**

Delete `frontend/src/components/refresh/RefreshStatusIndicator.tsx` and `frontend/src/components/refresh/RefreshStatusIndicator.css`.

**Step 4: Verify no remaining references to old component**

Run: `cd /Volumes/git/luxury-yacht/app && grep -r "RefreshStatusIndicator" frontend/src --include="*.ts" --include="*.tsx" --include="*.css"`

Expected: No matches.

**Step 5: Verify compilation**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

**Step 6: Verify app runs**

Run: `cd /Volumes/git/luxury-yacht/app && wails dev`

Expected: App starts, three dots visible in the header to the left of the kubeconfig selector. Each dot shows a popover on click. No console errors.

---

### Task 8: Update the plan doc

**Files:**
- Modify: `docs/plans/todos.md`

**Step 1: Mark completed items**

Update the status indicators section in `docs/plans/todos.md` to mark completed items with checkmarks as work progresses.
