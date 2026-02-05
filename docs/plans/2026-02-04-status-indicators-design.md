# Status Indicators Design

## Overview

Replace the existing `RefreshStatusIndicator` with three independent status indicators in the app header: Connectivity, Metrics, and Port Forwards. Each is an instance of a shared `StatusIndicator` component.

## Shared StatusIndicator Component

A reusable component that renders:

- A colored dot driven by a `status` prop (one of five shared states)
- An optional pulse animation for transitional states
- A popover (appearing below the dot) triggered on click, with status details and an optional action
- A label for accessibility

## Shared Status States

All indicators map their domain logic to one of five shared states. Each state has a corresponding pair of CSS variables (`--status-<state>` and `--status-<state>-shadow`) defined in both dark and light theme files.

| State        | Color | Pulse | Usage                                                              |
|--------------|-------|-------|--------------------------------------------------------------------|
| `healthy`    | Green | No    | Connected, metrics collecting, all forwards active                 |
| `refreshing` | Green | Yes   | Refreshing connection                                              |
| `degraded`   | Amber | Yes   | Retrying/rebuilding, metrics stale, some forwards unhealthy        |
| `unhealthy`  | Red   | No    | Offline/auth failed, metrics unavailable, all forwards unhealthy   |
| `inactive`   | Gray  | No    | Disabled, no port forwards                                        |

## Indicator Instances

### Connectivity

- **Component:** `ConnectivityStatus`
- **Hook:** existing `useClusterHealthListener` + `useActiveClusterAuthState`
- **Always visible**
- **Click action:** Refresh cluster connection (or retry auth if auth failed)

State mapping (simplified from 7 to 4 visual states):

| Condition                | State        | Popover Text              |
|--------------------------|--------------|---------------------------|
| Healthy                  | `healthy`    | "Connected"               |
| Retrying / Rebuilding    | `degraded`   | "Reconnecting..."         |
| Offline / Auth Failed    | `unhealthy`  | "Disconnected" / "Auth failed" |
| Disabled                 | `inactive`   | "Paused"                  |

### Metrics

- **Component:** `MetricsStatus`
- **Hook:** existing `useClusterMetricsAvailability`
- **Always visible** (currently conditionally visible)
- **Click action:** None (informational popover only)

State mapping:

| Condition                              | State       | Popover Text                        |
|----------------------------------------|-------------|-------------------------------------|
| Collecting successfully                | `healthy`   | "Metrics available"                 |
| Stale / intermittent errors            | `degraded`  | Context-aware (reuse `getMetricsBannerInfo`) |
| Unavailable / not installed / no perms | `unhealthy` | Context-aware (reuse `getMetricsBannerInfo`) |

### Port Forwards

- **Component:** `PortForwardStatus`
- **Hook:** new `usePortForwardStatus`
- **Always visible**
- **Click action:** Open port forwards panel

State mapping:

| Condition             | State       | Popover Text                          |
|-----------------------|-------------|---------------------------------------|
| No forwards           | `inactive`  | "No port forwards"                    |
| All active             | `healthy`   | "N port forwards active"              |
| Some unhealthy         | `degraded`  | "N of M port forwards unhealthy"      |
| All unhealthy          | `unhealthy` | "All port forwards unhealthy"         |

## Popover Design

Shared structure, content varies per indicator:

```
  [dot]
    |
 ┌──────────────────────┐
 │  Title (bold)         │
 │  Status message       │
 │                       │
 │  [Action Button]      │  <- optional, right-aligned
 └──────────────────────┘
```

- Appears directly below the dot (pop-under)
- Dismisses on click outside or Escape
- Connectivity: title "Connectivity", action "Refresh" (or "Retry Auth")
- Metrics: title "Metrics", no action
- Port Forwards: title "Port Forwards", action "Manage" (opens panel)

## New usePortForwardStatus Hook

- Listens to existing `portforward:list` and `portforward:status` Wails events
- Filters sessions by `selectedClusterId` (multi-cluster aware)
- Computes aggregate status:
  - No sessions -> `inactive`
  - All `active` -> `healthy`
  - All `error`/`stopped` -> `unhealthy`
  - Mixed -> `degraded`
- Returns `{ status, totalCount, healthyCount, unhealthyCount }`

## File Changes

### New files

| File                                                      | Purpose                             |
|-----------------------------------------------------------|-------------------------------------|
| `frontend/src/components/status/StatusIndicator.tsx`      | Shared dot + popover component      |
| `frontend/src/components/status/StatusIndicator.css`      | Shared styling                      |
| `frontend/src/components/status/ConnectivityStatus.tsx`   | Connectivity indicator instance     |
| `frontend/src/components/status/MetricsStatus.tsx`        | Metrics indicator instance          |
| `frontend/src/components/status/PortForwardStatus.tsx`    | Port forward indicator instance     |
| `frontend/src/modules/port-forward/hooks/usePortForwardStatus.ts` | Aggregate port forward status hook |

### Modified files

| File                          | Change                                                            |
|-------------------------------|-------------------------------------------------------------------|
| `AppHeader.tsx`               | Replace `<RefreshStatusIndicator />` with three status components |
| `dark.css`                    | Add shared `--status-*` variables, remove old `--refresh-status-*` and `--refresh-metrics-*` variables |
| `light.css`                   | Same as dark.css                                                  |

### Removed files

| File                           | Reason                          |
|--------------------------------|---------------------------------|
| `RefreshStatusIndicator.tsx`   | Replaced by new components      |
| `RefreshStatusIndicator.css`   | Replaced by shared styling      |

### Kept as-is

- `useClusterHealthListener` hook
- `useClusterMetricsAvailability` hook
- `connectionStatus.tsx` context
- `getMetricsBannerInfo` utility (reused for metrics popover)
- `ClusterOverview` metrics banner (separate concern)
- All backend code (no changes needed, events already emitted)
