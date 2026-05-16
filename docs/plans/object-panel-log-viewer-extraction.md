# Object Panel Log Viewer Extraction Plan

## Overview

The object panel is a convergence point for details, YAML, events, logs,
shell, maps, Helm content, and actions. The log workflows are especially large:
container logs and node logs each own transport, local UI state, filtering,
parsed JSON display, copy/export behavior, terminal coloring, scroll
restoration, and keyboard interactions.

Container logs have stream-backed refresh behavior and a manual fallback.
Node logs use direct node log discovery/fetch calls and local auto-refresh.
Those transports are different, but the viewer behavior above the transport is
largely shared.

This plan extracts reusable log-viewer infrastructure while preserving the
current workflows.

## Goals

- Share log filtering, regex validation, parsed JSON display, copy/export,
  scroll restoration, ANSI handling, and terminal theme behavior.
- Keep container logs and node logs transport adapters separate.
- Move direct read calls behind the app's data-access/app-state-access
  boundaries where appropriate.
- Reduce component size in `LogViewer.tsx` and `NodeLogsTab.tsx`.
- Make future log workflows cheaper to build and test.

## Non-Goals

- Do not redesign the log viewer UI.
- Do not change container log stream payloads.
- Do not change node log backend behavior.
- Do not remove the container log stream fallback.
- Do not merge node logs into the container logs refresh domain unless a later
  backend design explicitly chooses that.
- Do not change object-panel tab behavior or panel lifecycle.

## Current Hotspots

- `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx`
  - Panel-scoped preference writeback
  - Container log stream/fallback coordination
  - Manual log fetch and refresh-store writes
  - Filter state and selected container/pod filters
  - Parsed JSON table construction
  - CSV generation and copy behavior
  - Raw/parsed scroll restoration
  - Terminal theme observation
  - Rendering and toolbar assembly
- `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab.tsx`
  - Node log source selection
  - Direct node log fetch and local auto-refresh
  - Regex filtering and highlight behavior
  - Parsed JSON table construction
  - CSV generation and copy behavior
  - Scroll restoration
  - Terminal theme observation
- `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi.ts`
  - Direct runtime access to Wails methods
  - Local discovery cache and inflight tracking

## Design Direction

Create a shared log viewer layer with two boundaries:

- A transport adapter provides log entries, loading/error state, refresh
  actions, source/filter metadata, warnings, and optional stream/fallback state.
- A shared viewer core owns display behavior: search, parsed mode, raw mode,
  copy/export, ANSI rendering, keyboard shortcuts, terminal theme, and scroll
  restoration.

The shared viewer should be built out of hooks and small components rather than
a single large generic component. Container logs and node logs can keep
workflow-specific shells around the shared core.

## Phase 1: Extract Pure Log Utilities

- [ ] Move duplicated regex construction into a shared log search utility.
- [ ] Move CSV escaping/export helpers into a shared log export utility.
- [ ] Move parsed JSON column/key derivation into a shared parsed-log utility.
- [ ] Move raw/pretty JSON copy formatting into the parsed-log utility.
- [ ] Add focused tests for regex modes, invalid regex behavior, CSV escaping,
      parsed column ordering, and JSON formatting.

## Phase 2: Shared Terminal And Scroll Hooks

- [ ] Extract terminal theme observation into a shared hook.
- [ ] Extract raw/parsed scroll restoration into a shared hook.
- [ ] Keep panel-specific cache keys supplied by the caller.
- [ ] Add tests for cache read/write behavior and restoration decisions where
      practical.
- [ ] Verify both container logs and node logs still restore scroll position
      across tab switches and cluster switches.

## Phase 3: Shared Parsed Log Table

- [ ] Create a reusable parsed log table component using `GridTable`.
- [ ] Accept parsed rows, expanded row state, column width config, and copy
      behavior as props.
- [ ] Keep styles in the existing log viewer stylesheet or move them to a
      shared adjacent stylesheet.
- [ ] Replace parsed table construction in container logs.
- [ ] Replace parsed table construction in node logs.
- [ ] Add component tests for row expansion, keyboard activation, copy text,
      empty state, and column rendering.

## Phase 4: Shared Raw Log Viewer

- [ ] Create a raw log viewer component for ANSI-rendered lines, highlighting,
      wrapping, selection, and virtualization.
- [ ] Preserve container-log pod color behavior as an optional capability.
- [ ] Preserve node-log source behavior outside the raw viewer.
- [ ] Add tests for highlighted text, ANSI segments, selection copy, and
      virtualization threshold behavior.

## Phase 5: Transport Adapter Cleanup

- [ ] Keep container logs stream/fallback orchestration in a container logs
      adapter hook.
- [ ] Keep node log discovery/fetch/autorefresh in a node logs adapter hook.
- [ ] Move node log discovery and fetch reads behind `appStateAccess` or
      `dataAccess`, depending on the final classification.
- [ ] Move container log fallback reads behind `dataAccess`.
- [ ] Preserve complete cluster identity in every read and refresh scope.
- [ ] Add diagnostics labels for direct log reads so the Diagnostics panel can
      explain them consistently.

## Phase 6: Component Shrink And Workflow Tests

- [ ] Reduce `LogViewer.tsx` to transport wiring, preference wiring, and shared
      viewer composition.
- [ ] Reduce `NodeLogsTab.tsx` to source selection, node-log transport wiring,
      and shared viewer composition.
- [ ] Keep existing workflow tests and update them to assert behavior, not
      implementation structure.
- [ ] Add regression tests for:
      stream fallback activation,
      previous container logs,
      active pod filtering,
      node log incremental append,
      invalid regex,
      parsed/raw mode toggling,
      copy/export.

## Validation

Targeted checks while implementing:

```bash
npm run test -- src/modules/object-panel/components/ObjectPanel/Logs
npm run test -- src/modules/object-panel/components/ObjectPanel/NodeLogs
npm run test -- src/modules/object-panel/components/ObjectPanel/ObjectPanel.test.tsx
npm run typecheck
```

Before considering non-documentation implementation complete:

```bash
mage qc:prerelease
```

## Rollout Notes

Start with pure utilities and the parsed table. Those changes are easy to test
and reduce duplication without touching transport behavior. Transport cleanup
should come later, after the shared viewer is already covered.
