# Tabs Contract

Every tab strip uses the shared `Tabs` base component. Drag-capable tab strips
also use the shared drag coordinator.

## Agent Contract

- Use `frontend/src/shared/components/tabs/Tabs.tsx` for tab rendering.
- Do not create feature-local tab components for standard tab behavior.
- Tab selection is controlled by the consumer; the base component does not own
  active state.
- Shared tab styles live in `frontend/styles/components/tabs.css`.
- Drag-capable consumers use the shared drag coordinator provider/hooks.
- Do not mount a second drag provider.
- Keep tab ids stable; they may be persisted, used as React keys, and used for
  drag/drop identity.

## Consumers

| Consumer | Wrapper | Drag |
| --- | --- | --- |
| Object Panel | `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx` | no |
| Diagnostics | `frontend/src/core/refresh/components/DiagnosticsPanel.tsx` | no |
| Cluster tabs | `frontend/src/ui/layout/ClusterTabs.tsx` | reorder |
| Dockable tabs | `frontend/src/ui/dockable/DockableTabBar.tsx` | reorder and cross-strip moves |

## Base Tab Rules

- Provide an accessible `aria-label` for every tab strip.
- Use stable tab ids and clear labels.
- Use close callbacks only when the consumer owns close lifecycle.
- Keep keyboard navigation on the WAI-ARIA manual activation pattern.
- Use shared overflow behavior instead of custom scroll controls.
- Do not override reserved ARIA, focus, or keyboard props through escape-hatch
  props.

## Drag Rules

- `DockablePanelProvider` mounts one `TabDragProvider` per native document so
  dockable and cluster tabs in that document share one coordinator. Consumers
  must not add a nested provider around it.
- Drag payloads must identify the source kind and stable tab id. Dockable
  cross-window payloads also carry source window/group, immutable owner,
  cluster, complete object identity, and active view.
- Cross-document dragover uses kind and owner/cluster MIME markers because
  protected HTML drag data exposes types but not payload values. Only compatible
  panel groups show a drop indicator; cluster tabs accept local reorders only.
  The destination validates the complete payload again at drop time. MIME
  markers control the preview, not native transfer authorization.
- Reorder, cross-strip move, and empty-space drop behavior belongs in the
  consumer wrapper, not the base `Tabs` component.
- Dockable tab movement must preserve panel identity, group membership, active
  tab state, and cluster/object identity. Local drops apply immediately;
  cross-window drops use the acknowledged native-panel transfer transaction.

## Global Workspace Tab

The cluster strip prepends a synthetic `__global__` tab only while more than
one cluster is open. It uses the shared `Tabs` renderer but is not part of
persisted cluster ordering, close behavior, or drag payloads. DOM drop indices
must be translated past this synthetic tab before updating cluster order.

When Global is active, no cluster tab is selected. Clicking a cluster tab exits
Global before changing the foreground kubeconfig; clicking Global preserves the
foreground kubeconfig and restores the last Global view. See
[navigation.md](navigation.md).

## Change Checklist

When changing tabs:

1. Decide whether the behavior belongs in the base component, drag coordinator,
   or one consumer wrapper.
2. Check keyboard, close, overflow, drag, and accessibility behavior.
3. Preserve tab ids and persisted ordering.
4. Update object-panel, diagnostics, cluster, and dockable tests if shared
   behavior changes.

## Validation

Run targeted tab/consumer Vitest tests and typecheck. For drag/drop changes,
verify manually in the app.
