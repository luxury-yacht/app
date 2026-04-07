# Tab Systems

A map of every place "tabs" appear in the Luxury Yacht frontend. Use this
to decide which existing system to extend (or which to consult for
prior art) before adding a new tab UI.

## TL;DR

Four distinct tab implementations live side-by-side. They share base CSS
classes (`.tab-strip`, `.tab-item`, `.tab-item--active`) from
`frontend/styles/components/tabs.css`, but **there is no shared React
component** — every tab strip is hand-rolled JSX over the shared
classes. The barrel at `frontend/src/shared/components/tabs/Tabs/index.tsx`
is a vestigial backward-compat shim (`useTabStyles() => true`) left from
a refactor that moved styles to the global stylesheet.

| System       | Strip component                  | ARIA | Drag-reorder         | Overflow handling               |
| ------------ | -------------------------------- | ---- | -------------------- | ------------------------------- |
| Object Panel | `ObjectPanelTabs.tsx`            | none | no                   | none (assumes fit)              |
| Dockable     | `DockableTabBar.tsx`             | full | yes (custom preview) | scroll buttons + overflow badge |
| Cluster      | `ClusterTabs.tsx`                | full | yes (HTML5 native)   | `overflow-x: auto`              |
| Diagnostics  | inline in `DiagnosticsPanel.tsx` | none | no                   | none                            |

## 1. Object Panel content tabs

The horizontal tab strip at the top of every object detail panel
(Details / YAML / Events / Logs / Pods / etc.).

- **Strip component:**
  `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx`
- **Static registry:**
  `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`
  — exports the `TABS` array
- **Filter logic:**
  `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.ts`
  — filters the static list per object kind + capabilities
- **Mounted by:** `ObjectPanel.tsx` (one strip per panel instance, dockable
  bottom/right/floating)

**Tabs (in source order):**

1. Details — always
2. Pods — Node, Deployment, DaemonSet, StatefulSet, Job, ReplicaSet
3. Jobs — CronJob
4. Logs — capability-gated (`hasLogs`)
5. Events — always; hidden for Helm releases and Event objects
6. YAML — always; hidden for Helm releases and Event objects
7. Shell — Pod only, capability-gated (`hasShell`)
8. Manifest — Helm releases only
9. Values — Helm releases only
10. Maintenance — Node only

**Conditionals:** kind allowlists, Helm vs. non-Helm, results from
`useObjectPanelCapabilities` for logs/shell.

**Styling:** shared base + `ObjectPanel.css` overrides.

**Keyboard:** custom number-key shortcuts (1–9) wired through
`useObjectPanelTabs`.

**ARIA:** none. Items use `role="button"`; no `tablist`/`tab`/`aria-selected`.

**Tests:** `ObjectPanelTabs.test.tsx`, `ObjectPanel.test.tsx`.

## 2. Dockable panel tab bar

The tab strip in the header of any dock group (bottom dock, right dock,
floating). Used to switch between Logs / Terminals / Port Forwards /
Diagnostics / etc. that have been opened into the same dock.

- **Strip component:** `frontend/src/ui/dockable/DockableTabBar.tsx`
- **Source of truth:** `frontend/src/ui/dockable/DockablePanelProvider.tsx`
  (panel registry, group state)
- **Registration:** dynamic — any code that opens a dockable panel via
  the provider becomes a tab in its dock group

**Tabs:** runtime-determined by which panels are currently open in that
group.

**Features:**

- Drag-and-drop reordering between groups (custom drag preview)
- Scroll overflow indicators with overflow-count badges
- Close button per tab
- Kind/color indicators

**Styling:** shared base + `DockablePanel.css` (`.dockable-tab*` modifiers).

**ARIA:** full — `role="tablist"`, `role="tab"`, `aria-selected`, focus
management.

**Tests:** `DockableTabBar.test.tsx`.

**Deeper docs:** see `docs/development/UI/dockable-panels.md` for the full
panel-layout / tab-group state model. That document is the source of
truth for the dockable subsystem; this one only summarizes the tab
strip.

## 3. Cluster tabs (multi-cluster top nav)

The strip in the app chrome that switches between open clusters /
kubeconfigs.

- **Strip component:** `frontend/src/ui/layout/ClusterTabs.tsx`
- **Mounted by:** `AppLayout.tsx` (grid row 2 in the main shell)
- **Source of truth:** `selectedKubeconfigs` from `KubeconfigContext`;
  tab order persisted in `@core/persistence/clusterTabOrder` (localStorage)

**Tabs:** one per selected kubeconfig. Label is the cluster name with
`path:context` disambiguation on collision.

**Features:**

- Native HTML5 drag-and-drop reorder
- Persisted order across sessions
- Close-with-confirmation when port forwards are active
- Auto-hide when fewer than 2 clusters are open
  (`ClusterTabs.tsx` — `if (orderedTabs.length < 2) return null`)

**Styling:** shared base + `ClusterTabs.css` (`.cluster-tabs`,
`.cluster-tab--dragging`, `.cluster-tab--drop-target`).

**ARIA:** full — `role="tablist"`, `role="tab"`, `aria-selected`.

**Tests:** `ClusterTabs.test.tsx`.

## 4. Diagnostics panel tabs

The four sub-views inside the Diagnostics dockable panel.

- **Inline in:** `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`
  (no separate strip file; tab strip is rendered inline. Content
  components are imported from `core/refresh/components/diagnostics/`.)
- **Registration:** local state union
  `'refresh-domains' | 'streams' | 'capability-checks' | 'effective-permissions'`

**Tabs (fixed order):**

1. Refresh Domains (default)
2. Streams
3. Capability Checks
4. Effective Permissions

**Styling:** shared base + `core/refresh/components/diagnostics/DiagnosticsPanel.css`
(`.diagnostics-tabs`).

**ARIA:** none. Uses a custom `data-diagnostics-focusable` attribute and
`tabIndex=-1` instead of `role="tab"`.

**Tests:** `DiagnosticsPanel.test.ts`.

## Cross-cutting observations

### Shared infrastructure

- **Stylesheet:** `frontend/styles/components/tabs.css` provides
  `.tab-strip`, `.tab-item`, `.tab-item--active`, `.tab-item--closeable`.
  Imported globally via `styles/index.css`.
- **No shared React component.** The barrel at
  `frontend/src/shared/components/tabs/Tabs/index.tsx` is just
  `useTabStyles() => true`, kept for backward compatibility with
  consumers that used to import the shared component module.

### ARIA compliance is split

| System       | role="tablist" | role="tab" | aria-selected | Keyboard                 |
| ------------ | -------------- | ---------- | ------------- | ------------------------ |
| Object Panel | ✗              | ✗          | ✗             | Custom number keys (1–9) |
| Dockable     | ✓              | ✓          | ✓             | Native focus             |
| Cluster      | ✓              | ✓          | ✓             | Native focus             |
| Diagnostics  | ✗              | ✗          | ✗             | Click only               |

The two systems with drag-and-drop (Dockable, Cluster) are also the two
with full ARIA. The two without (Object Panel, Diagnostics) skip both.

### Drag-and-drop

Two different implementations, no shared abstraction:

- **Dockable** uses a custom drag-preview implementation with cross-group
  drop targets (see `dockable-panels.md` for details).
- **Cluster** uses HTML5 native `draggable`/`ondragover`/`ondrop` events.

### Overflow handling

Only DockableTabBar handles tab overflow gracefully (scroll buttons plus
overflow-count badge). Cluster relies on plain `overflow-x: auto`. Object
Panel and Diagnostics assume their fixed set always fits the available
width.

### Nesting

The Dockable tab bar can host an Object Panel, which has its own
content-tab strip — that is the only real nested case in the app. Within
an Object Panel tab's content, sub-views like `DetailsTabData` /
`DetailsTabContainers` are stacked sections, not nested tabs.

### Where tabs are NOT used

There are no tab UIs in modals, settings drawers, the kubeconfig editor,
port-forward dialogs, or the sidebar. (The sidebar's
`.panel-debug-tree__tab-item` class is a tree-view leaf node modifier,
not a tab strip.)

## File inventory

| Path                                                                                   | Role                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `frontend/styles/components/tabs.css`                                                  | Shared base styles for all four systems             |
| `frontend/src/shared/components/tabs/Tabs/index.tsx`                                   | Vestigial `useTabStyles()` shim — no real component |
| `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx`         | Object Panel strip                                  |
| `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`                | `TABS` registry                                     |
| `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.ts` | Per-kind / per-capability filter                    |
| `frontend/src/ui/dockable/DockableTabBar.tsx`                                          | Dockable strip                                      |
| `frontend/src/ui/dockable/DockablePanelProvider.tsx`                                   | Dockable group state                                |
| `frontend/src/ui/dockable/DockablePanel.css`                                           | Dockable strip styling                              |
| `frontend/src/ui/layout/ClusterTabs.tsx`                                               | Cluster nav strip                                   |
| `frontend/src/ui/layout/ClusterTabs.css`                                               | Cluster nav styling                                 |
| `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`                            | Diagnostics strip (inline)                          |
| `frontend/src/core/refresh/components/diagnostics/DiagnosticsPanel.css`                | Diagnostics strip styling                           |
