### Added

- Drop zones for docking panel tabs
  - While you drag an object panel tab, empty right and bottom dock edges show a drop zone. Drop the tab there to dock it.
  - Hovering over a drop zone previews where the dock will appear and how large it will be.
  - Tabs dragged from another window of the same cluster can also be dropped on an empty dock edge.
- Browse and the Custom views show a partial-data notice when your role can list a resource type but not watch it. Those rows refresh periodically instead of live.

### Changed

- Simplified docked panels
  - Each dock now manages its own size and controls, while each tab keeps its own content. This removes the special "leader tab" arrangement.
  - Docks keep their size when tabs close, move, or reorder.
  - A dock remembers its size after its last tab closes, so the next panel opens at the same size.
- Custom resources put less load on the cluster
  - Each custom resource type is watched once, by the same system that watches built-in kinds like Pods and Deployments.
  - Catalog refreshes read custom resources from that watch instead of listing each type from the API again.
  - Routine CRD updates, such as label, status, or schema changes, no longer trigger catalog rediscovery.
- Live changes update only the affected Browse catalog entries instead of rebuilding the whole catalog for each object change.

### Fixed

- Cluster tabs close immediately and stay closed during rapid opening, closing, and switching. Closed clusters release their connections and disappear from K8s API diagnostics; closing a sibling no longer causes a catalog error toast.
- A failed cluster connection no longer interrupts healthy clusters opened alongside it or leaves failed tabs stuck connecting after another tab closes.
- Unsaved YAML edits are no longer lost when another tab in the same dock opens, closes, moves, or is reordered. An error in one tab no longer discards work in the other tabs.
- Moving a cluster tab to a new window keeps its docked panels, tab order, and selected views.
- Custom resource views update immediately when custom resources change.
- New CRDs appear in Browse and the Custom views as soon as they are established. Previously they waited for the periodic catalog refresh, which could take up to five minutes.
- Browse and the Custom views now load for users who cannot list ReplicaSets, HorizontalPodAutoscalers, or Events across the whole cluster, such as users limited to specific namespaces. Previously the catalog could wait indefinitely for data when permissions were insufficient.
- One slow or failing resource type no longer holds up the Browse catalog. Each list request times out after 30 seconds, and a failure no longer cancels collection of the other types. The failed type keeps its last known rows.
