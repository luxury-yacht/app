# Tab Systems

Every tab strip in the Luxury Yacht frontend renders the single shared
`<Tabs>` base component at `frontend/src/shared/components/tabs/Tabs.tsx`.
Drag-capable strips (Cluster, Dockable) additionally consume the drag
coordinator hooks at `frontend/src/shared/components/tabs/dragCoordinator/`.

This document is the source of truth for the shared component's API, the
drag coordinator, and how each of the four in-app consumers is wired.

## TL;DR

| Consumer     | Wrapper file                                                                   | Drag                                | Close | Overflow |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------- | ----- | -------- |
| Object Panel | `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx` | no                                  | no    | no       |
| Diagnostics  | inline in `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`          | no                                  | no    | no       |
| Cluster      | `frontend/src/ui/layout/ClusterTabs.tsx`                                       | reorder                             | yes   | scroll   |
| Dockable     | `frontend/src/ui/dockable/DockableTabBar.tsx`                                  | reorder + cross-strip + empty-space | yes   | scroll   |

- **Base styles** live in `frontend/styles/components/tabs.css` (imported
  globally via `styles/index.css`). The base provides `.tab-strip`,
  `.tab-item`, `.tab-item--active`, `.tab-item--closeable`, sizing
  modifiers, overflow indicators, drop indicator, and the
  `.tab-strip--uppercase` variant.
- **Public API:** `import { Tabs, type TabsProps, type TabDescriptor } from '@shared/components/tabs'`.
- **Drag coordinator:** `import { TabDragProvider, useTabDragSource, useTabDragSourceFactory, useTabDropTarget } from '@shared/components/tabs/dragCoordinator'`.
- **`TabDragProvider` is mounted at the app root** in `App.tsx` around
  `DockablePanelProvider`. Consumers never mount a second one.

## Architecture

Composition — no class inheritance.

```
                     <Tabs>
                     Universal base. Renders the strip, owns ARIA,
                     manual-activation keyboard, roving tabindex,
                     overflow scrolling with auto-scroll-into-view,
                     close button overlay, drop-indicator rendering,
                     sizing modes, uppercase variant, dev-mode
                     reserved-key warning. Knows nothing about drag.
                            ▲
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
     used directly by:  used directly by:  wrapped by:
          │                 │                  │
   ObjectPanelTabs     Diagnostics    ┌────────┴────────┐
                         strip        │                 │
                                ClusterTabs        DockableTabBar
                                wraps <Tabs>;      wraps <Tabs>;
                                drag source +      drag source +
                                bar drop target    bar drop target
                                for cluster-tab    for dockable-tab
                                reorder;           reorder, cross-strip
                                persisted order;   moves; static custom
                                port-forward       drag preview via
                                confirmation       setDragImage; kind
                                modal;             color indicators;
                                auto-hide < 2      empty-space drop
                                clusters.          target mounted on
                                                   AppLayout's <main>.
```

The **drag coordinator** adds two hooks (`useTabDragSource` /
`useTabDragSourceFactory` for sources, `useTabDropTarget` for targets)
built on HTML5 native drag events. The provider holds per-drag state
and the drop-target registry.

## `<Tabs>` API

The component is **fully controlled** — `activeId` and `onActivate` come
from the consumer; the component holds no selection state of its own.

### `TabDescriptor`

```ts
interface TabDescriptor {
  /** Stable id. Used as the React key and the value passed to onActivate. */
  id: string;

  /** Visible content. Plain text in most cases; ReactNode for inline icons. */
  label: ReactNode;

  /** Slot rendered before the label. Always visible, contributes to sizing. */
  leading?: ReactNode;

  /**
   * If set, the base renders a hover-only close button overlaid on the
   * right edge of the tab. Click or pressing Delete/Backspace on the
   * focused tab invokes this callback.
   */
  onClose?: () => void;

  /**
   * Optional custom content for the close button. Default is a plain
   * `×` text character. Pass a ReactNode (e.g. an SVG icon component)
   * when the consumer needs its own visual.
   */
  closeIcon?: ReactNode;

  /**
   * Optional aria-label override for the close button. Defaults to
   * "Close". Per-tab labels like "Close my-context-name" are more
   * informative for screen reader users.
   */
  closeAriaLabel?: string;

  /** Disabled tabs are skipped by keyboard nav and don't fire onActivate. */
  disabled?: boolean;

  /** Linked content panel id, applied as aria-controls. Optional. */
  ariaControls?: string;

  /**
   * Override the accessible name. By default the tab's accessible name
   * is its text content (label). Only set this when label contains no
   * text — e.g. an icon-only tab.
   */
  ariaLabel?: string;

  /**
   * Escape hatch for wrapper components to attach drag handlers, custom
   * data attributes, etc. Spread onto each tab's root element (a
   * `<div role="tab">`) BEFORE the base's reserved props, so reserved
   * keys can't be silently overridden. The base warns in dev mode when
   * extraProps contains a reserved key — see "Reserved keys" below.
   */
  extraProps?: HTMLAttributes<HTMLElement>;
}
```

### `TabsProps`

```ts
interface TabsProps {
  tabs: TabDescriptor[];
  activeId: string | null;
  onActivate: (id: string) => void;

  /** Required, for screen readers. Per-consumer values listed below. */
  "aria-label": string;

  /**
   * Overflow behavior. Default 'scroll'. When 'scroll', the strip measures
   * itself and, when content exceeds container width, renders BOTH ◀ ▶
   * scroll chevrons together as sticky children. Each chevron greys out
   * via the native `disabled` attribute when its direction is exhausted.
   * Clicking advances one tab at a time via a manual rAF animation
   * (250ms ease-out-cubic). The active tab is auto-scrolled into view on
   * activation. Set to 'none' to disable overflow entirely.
   */
  overflow?: "scroll" | "none";

  /**
   * - 'fit' (default): each tab takes its content width, clamped between
   *   minTabWidth and maxTabWidth. Long labels truncate with ellipsis.
   * - 'equal': all tabs share the strip width equally (flex: 1 1 0),
   *   each clamped between minTabWidth and maxTabWidth.
   */
  tabSizing?: "fit" | "equal";

  /**
   * Floor for tab width. Mode-specific default:
   * - 'fit' mode: defaults to 0 so short labels like "YAML" size tightly.
   * - 'equal' mode: defaults to 80px so tabs sharing a strip stay readable.
   * Closeable tabs in 'fit' mode additionally get an 80px floor enforced
   * by CSS so the overlay close button has room.
   */
  minTabWidth?: number;

  /** Default 240px. Labels longer than this truncate with ellipsis. */
  maxTabWidth?: number;

  /**
   * The only legitimate per-system visual variation. Default 'none'.
   * Object Panel and Diagnostics use 'uppercase'; Cluster and Dockable
   * use 'none'. Implemented via a modifier class on the strip root.
   */
  textTransform?: "none" | "uppercase";

  /** Merged onto the root <div className="tab-strip">. */
  className?: string;

  /** Optional id for the root tablist element. */
  id?: string;

  /**
   * When set to an integer in [0, tabs.length], a thin vertical drop
   * indicator bar is rendered at that flex position inside the strip.
   * 0 places it before the first tab, tabs.length after the last. Used by
   * drag-and-drop wrappers (see useTabDropTarget) to show where a dragged
   * tab will land if released. Pair with the hook's dropInsertIndex
   * return value.
   */
  dropInsertIndex?: number | null;

  /**
   * When true, every tab gets tabIndex={-1} regardless of active state or
   * the fallback focus rule. Use this when the surrounding component
   * implements its own focus management and does not want the tabs to
   * participate in the browser's native Tab-key order. Keyboard arrow
   * navigation and Enter/Space activation still work — they're driven by
   * the component's own handleKeyDown, which moves focus explicitly via
   * .focus() regardless of tabindex.
   *
   * Used by ObjectPanelTabs and DiagnosticsPanel because both panels run
   * their own focus walkers (querySelectorAll over a data-* marker).
   *
   * Default: false.
   */
  disableRovingTabIndex?: boolean;
}
```

### Required `aria-label` per consumer

| Consumer          | `aria-label`               |
| ----------------- | -------------------------- |
| `ObjectPanelTabs` | `"Object Panel Tabs"`      |
| Diagnostics strip | `"Diagnostics Panel Tabs"` |
| `ClusterTabs`     | `"Cluster Tabs"`           |
| `DockableTabBar`  | `"Object Tabs"`            |

### Reserved keys

`extraProps` is a freeform `HTMLAttributes<HTMLElement>` pass-through
merged onto each tab's root element. The base reserves these keys for
itself:

```
role, aria-selected, aria-controls, aria-disabled, aria-label,
tabIndex, id, onClick, onKeyDown
```

In dev mode (`process.env.NODE_ENV !== 'production'`), the base warns
when `extraProps` contains any reserved key. Production builds skip the
check entirely. The base spreads `extraProps` _first_, then its own
reserved props on top, so even if a wrapper accidentally sets one of
these keys the base's value still wins at the DOM level — the warning
fires but ARIA stays correct (defense in depth).

### DOM structure

Each tab's root is `<div role="tab">`, **not** `<button role="tab">`.
This lets the close affordance be a real nested `<button type="button">`
without violating HTML's ban on interactive content inside a `<button>`.
The roving tabindex gives the `<div>` keyboard focusability; the
explicit `handleKeyDown` implements Enter/Space activation that a
`<div>` would otherwise lack. The close `<button>` is reached by pointer
only (hover/focus-visible reveals it via CSS) or by pressing
Delete/Backspace on the focused tab; it has `tabIndex={-1}` so it isn't
a separate Tab stop.

### Behavior contracts

- **Keyboard (roving tabindex):** WAI-ARIA manual activation pattern.
  Exactly one tab at a time has `tabIndex={0}`; all others have
  `tabIndex={-1}`. Normally that's the active tab. When no tab matches
  `activeId`, the first non-disabled tab receives `tabIndex={0}` as a
  fallback so the strip remains reachable via Tab.
  - Arrow Left/Right move focus between tabs without changing active
    selection.
  - Home/End jump to first/last non-disabled tab.
  - Enter or Space activates the focused tab.
  - Delete or Backspace on the focused tab invokes its `onClose` if set.
  - Disabled tabs are skipped during arrow navigation.
  - Consumers that implement their own focus management pass
    `disableRovingTabIndex={true}`. Arrow nav and Enter/Space still work.

- **Click:** Activates immediately, calls `onActivate(id)`. Disabled
  tabs swallow the click.

- **Overflow scrolling:** When `overflow='scroll'` (default), the
  component measures itself with `ResizeObserver`. When
  `scrollWidth > clientWidth`, BOTH ◀ ▶ chevrons render together as
  sticky flex children of the strip. Each is greyed out via the native
  `disabled` attribute when its direction is exhausted. Clicking a
  chevron scrolls one tab at a time via a manual `requestAnimationFrame`
  animation (250ms ease-out-cubic). Rapid clicks accumulate via
  `pendingScrollTargetRef` so N clicks always advance N tabs, and the
  animation is guaranteed to reach its target — no reliance on
  browser-level smooth scroll, which is unreliable cross-browser. Both
  chevrons stay mounted simultaneously (no per-side conditional
  rendering) so tab positions don't shift across clicks. When `activeId`
  changes, the active tab is `scrollIntoView({ inline: 'nearest',
behavior: 'smooth' })`-ed automatically.

- **Drop indicator:** When `dropInsertIndex` is a number, a thin
  accent-colored vertical bar is rendered as a flex child at that
  position to show the drop landing site during a drag. Used by the
  `useTabDropTarget` hook's companion return value.

- **Empty `tabs`:** Renders the container, no tabs inside. No crash.

- **Invalid `activeId`:** If `activeId` doesn't match any tab, no tab
  gets `aria-selected={true}`, and the roving-tabindex fallback keeps
  the strip reachable.

### Layout model

The tab is a flex container internally. The min/max width applies to
the entire `<div role="tab">` root element, not the label.

```
              ┌─ position: absolute, hover/focus-within: opacity 1 ─┐
              │                                                     │
┌─────────────┼─────────────────────────────────────────────────────┼─┐
│ [leading] [label (full width minus leading minus reserved padding)] [×]│
└─────────────┴─────────────────────────────────────────────────────┴─┘
  ←—————————————— minTabWidth..maxTabWidth ——————————————→
```

- `leading` is `flex: 0 0 auto` — takes its natural width and
  contributes to sizing.
- `label` is `flex: 1 1 auto` with `min-width: 0; overflow: hidden;
text-overflow: ellipsis; white-space: nowrap`. It's the only element
  that shrinks and the only element that truncates.
- The close button (when `onClose` is set) is `position: absolute; right:
1px` and hover-revealed. It's reserved space inside the tab via
  `padding-right: 1.2rem` on the `tab-item--closeable` modifier, so the
  label never sits underneath the button.
- **Consequence:** closeable tabs have ~17px less label area than
  non-closeable tabs at the same outer width. In `'equal'` mode mixing
  closeable and non-closeable tabs in the same strip, the closeable ones
  truncate slightly earlier — but none of the four consumers mix them in
  practice (Cluster + Dockable are 100% closeable; Object Panel +
  Diagnostics are 100% non-closeable).

## Drag coordinator

Lives in `frontend/src/shared/components/tabs/dragCoordinator/`. Built
on HTML5 native drag events under the hood, exposed via React hooks.
The transport choice is encapsulated so the coordinator can switch to
pointer events later without changing wrapper-side code.

### Drag/drop scenarios supported today

| #   | Source       | Target                                                         | Action                              | Cluster | Dockable |
| --- | ------------ | -------------------------------------------------------------- | ----------------------------------- | :-----: | :------: |
| 1   | Tab in strip | Another tab in the **same** strip                              | Reorder within strip                |    ✓    |    ✓     |
| 2   | Tab in strip | Another tab in a **different** strip (same dockable container) | Move tab between dock groups        |    ✗    |    ✓     |
| 3   | Tab in strip | **Empty space** in the dockable container                      | Create a new floating dock group    |    ✗    |    ✓     |
| 4   | Tab in strip | **Outside the source strip and outside the window bounds**     | Tear off into a new window (future) |   ⏳    |    ⏳    |

### Payload type (discriminated union)

```ts
// frontend/src/shared/components/tabs/dragCoordinator/types.ts
type TabDragPayload =
  | { kind: "cluster-tab"; clusterId: string }
  | { kind: "dockable-tab"; panelId: string; sourceGroupId: string };

type TabDragKind = TabDragPayload["kind"];

// Wire format key for DataTransfer. Namespaced so it doesn't collide
// with anything the OS or other apps put in the clipboard during drag.
const TAB_DRAG_DATA_TYPE = "application/x-luxury-yacht-tab";
```

This is the load-bearing type that makes cross-system drops **impossible
by construction**. Cluster tabs and Dockable tabs are different kinds;
every drop target declares which kind(s) it accepts; the compiler
refuses to call a `'dockable-tab'`-only handler with a `'cluster-tab'`
payload.

### Hooks

```ts
/**
 * Source: turn an element into a drag source. Returns props the consumer
 * spreads onto the tab via `extraProps` on the descriptor. Pass `null`
 * to make the tab non-draggable.
 */
function useTabDragSource(
  payload: TabDragPayload | null,
  options?: {
    /**
     * Optional custom drag preview. Invoked synchronously at dragstart.
     * Return the element + cursor offset to use as the drag image, or
     * null to fall back to the browser's default (a translucent
     * screenshot of the source). The element MUST already be in the DOM
     * when this is called — the browser screenshots it once and never
     * re-reads it.
     */
    getDragImage?: () => {
      element: HTMLElement;
      offsetX: number;
      offsetY: number;
    } | null;
  },
): TabDragSourceProps;
```

```ts
/**
 * Factory variant for consumers that render an unbounded number of
 * draggable tabs. Calls useContext exactly ONCE per render, then returns
 * a plain factory function safe to call inside `.map()` — no
 * rules-of-hooks workaround and no upper bound on tab count. The
 * returned factory has a new identity on every render; do NOT pass it
 * as a useMemo / useEffect dependency directly.
 */
function useTabDragSourceFactory(): (
  payload: TabDragPayload | null,
  options?: UseTabDragSourceOptions,
) => TabDragSourceProps;
```

```ts
/**
 * Target: turn an element into a drop zone for one or more drag kinds.
 * The narrow generic on `accepts` types the `onDrop` payload precisely.
 *
 * Returns:
 * - ref: attach to the drop zone root element
 * - isDragOver: boolean for hover styling
 * - dropInsertIndex: number | null — computed from the horizontal
 *   midpoint of each [role="tab"] child. Pass this to <Tabs> as
 *   dropInsertIndex so the drop-position indicator renders at the
 *   correct flex position.
 */
function useTabDropTarget<K extends TabDragKind>(opts: {
  accepts: K[];
  onDrop: (
    payload: Extract<TabDragPayload, { kind: K }>,
    event: DragEvent,
    insertIndex: number,
  ) => void;
  onDragEnter?: (payload: Extract<TabDragPayload, { kind: K }>) => void;
  onDragLeave?: () => void;
}): {
  ref: RefCallback<HTMLElement>;
  isDragOver: boolean;
  dropInsertIndex: number | null;
};
```

```ts
/**
 * Mounted ONCE at the app root, wrapping DockablePanelProvider. All
 * sources and targets share a single provider scope. Do NOT mount a
 * second one inside a wrapper component — that creates a nested scope
 * that shadows the outer one and silently splits drag state.
 *
 * onTearOff is a future seam: fires when a drag ends with dropEffect ===
 * 'none' AND the cursor is outside the window bounds. Currently no
 * consumer wires it.
 */
function TabDragProvider(props: {
  children: ReactNode;
  onTearOff?: (
    payload: TabDragPayload,
    cursor: { x: number; y: number },
  ) => void;
}): JSX.Element;
```

### Which drag-source hook to use

| Hook                      | Use when                                                                                | `useContext` calls |
| ------------------------- | --------------------------------------------------------------------------------------- | ------------------ |
| `useTabDragSource`        | One draggable element per component instance (e.g., a single stand-alone tab component) | 1 per instance     |
| `useTabDragSourceFactory` | Consumer renders a dynamic-length list of draggable tabs via `.map()`                   | 1 per render       |

**Always use `useTabDragSourceFactory` in ClusterTabs and
DockableTabBar.** Users routinely open 20+ kubeconfig contexts or
panels, and an unrolled-hook workaround would silently cap drag support
at whatever constant was picked.

Typical usage:

```tsx
// Inside ClusterTabs / DockableTabBar render:
const makeDragSource = useTabDragSourceFactory();

// Per-render allocation is fine — do NOT wrap .map() in useMemo with
// makeDragSource as a dep; the factory has new identity each render.
const tabDescriptors: TabDescriptor[] = tabs.map((tab) => ({
  id: tab.id,
  label: tab.label,
  extraProps: {
    ...makeDragSource({ kind: "cluster-tab", clusterId: tab.id }),
  } as HTMLAttributes<HTMLElement>,
}));
```

`createTabDragSourceProps` is also exported for unit-testing and for any
consumer that manages the context reference itself.

### Implementation notes

- **HTML5 native under the hood.** The hooks generate the event handlers
  and the `draggable` boolean; consumers spread them via `extraProps` on
  each tab descriptor. The browser handles the drag image, cursor, and
  (eventually) cross-window awareness for free.

- **Payload survives the round trip.** On `dragstart` the source writes
  JSON to `event.dataTransfer.setData('application/x-luxury-yacht-tab',
...)`. On `drop` the target reads it back. This means the payload
  travels even if React state was wiped — important for the future
  tear-off case where the drop happens in a different window context.

- **Provider holds the registry.** A React context with `currentDrag:
TabDragPayload | null` plus a Map of target registrations keyed by
  element ref. The provider updates `currentDrag` on
  `dragstart`/`dragend` and matches targets against `currentDrag.kind`
  when `dragenter` fires.

- **Custom preview via `setDragImage`.** Wrappers that want a styled
  preview render an offscreen DOM element (positioned `top: -9999px;
left: -9999px`) and provide `getDragImage` returning a ref to it. The
  hook calls `event.dataTransfer.setDragImage(element, offsetX, offsetY)`
  at dragstart time. The browser takes a snapshot right then and renders
  that snapshot at the cursor for the rest of the drag. No pointermove
  listener, no CSS variable updates, no per-frame state. **This
  intentionally replaces the legacy live cursor-following preview.**

- **Nested drop targets and `stopPropagation`.** When a consumer nests
  one `useTabDropTarget` inside another (for example, the per-strip
  drop target inside a container-level empty-space drop target), the
  inner target consumes the drop and calls `event.stopPropagation()` so
  the ancestor does not also fire. The same `stopPropagation` applies in
  `handleDragOver` so the ancestor's hover state doesn't flicker while
  the cursor is over the inner target. **Rejected drops** (payload kind
  not in the target's `accepts` list) still bubble normally — only drops
  that are actually consumed stop propagation. The Dockable migration
  relies on this contract so a drop on a tab bar routes to the bar's
  `onDrop` (reorder / cross-strip move) while a drop in empty space
  between bars routes to the container's `onDrop` (create floating
  group).

- **Shift compensation for same-group reorder.** When the drop target
  splices a reorder into an array that contains the dragged source, the
  `insertIndex` returned by the drop target is computed against the
  pre-removal layout. Removing the source first shifts every later
  position left by one, so the adjusted insert index is:

  ```ts
  const adjustedInsert =
    sourceIdx >= 0 && sourceIdx < insertIndex ? insertIndex - 1 : insertIndex;
  if (adjustedInsert === sourceIdx) return; // no-op drop on self
  ```

  Both `ClusterTabs` and the Dockable provider's `movePanel` adapter
  apply this compensation. Cross-group moves do **not** need it because
  source and target live in different arrays.

- **Tear-off seam.** The provider attaches a global `dragend` listener
  that checks `event.dataTransfer.dropEffect === 'none'` AND the cursor
  coordinates fall outside `window.innerWidth/innerHeight`. If both, it
  fires `onTearOff` with the payload. Currently no consumer wires this.

## Styling

### Where the rules live

| File                                                        | Role                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/styles/components/tabs.css`                       | Base — `.tab-strip`, `.tab-item`, `.tab-item--active`, `.tab-item--closeable`, sizing modifiers, overflow indicators, drop indicator, `.tab-strip--uppercase`. Imported globally.                                                 |
| `frontend/src/ui/layout/ClusterTabs.css`                    | Layout override — `.cluster-tabs { padding: 0 6px; grid-column: 1 / -1; grid-row: 2; }`                                                                                                                                           |
| `frontend/src/ui/dockable/DockablePanel.css`                | `.dockable-tab-bar-shell`, `.dockable-tab-bar`, `.dockable-tab__kind-indicator.kind-badge` (color dot in the leading slot), and the `.dockable-tab-drag-preview*` block (the permanently-mounted `setDragImage` snapshot source). |
| `frontend/src/modules/object-panel/.../ObjectPanel.css`     | Layout integration — `.object-panel-body > .tab-strip { flex-shrink: 0 }`                                                                                                                                                         |
| `frontend/src/core/refresh/components/DiagnosticsPanel.css` | Layout integration — `.diagnostics-tabs { padding: ... }` wrapper                                                                                                                                                                 |

### Per-system variation

Only three real variations, all expressed uniformly:

1. **Text case.** `textTransform="uppercase"` prop on `<Tabs>`. Object
   Panel and Diagnostics pass it; Cluster and Dockable don't. The base
   CSS adds `.tab-strip--uppercase .tab-item { text-transform: uppercase }`.

2. **Min/max tab width.** Set via `minTabWidth` / `maxTabWidth` props.
   The component forwards them as CSS custom properties
   (`--tab-item-min-width`, `--tab-item-max-width`) via inline style on
   the root; base CSS reads them inside the sizing-mode selectors.

3. **Drag-state visuals (drag preview, drop target highlight, drop
   indicator).** The drop-indicator bar lives in the base
   (`.tab-strip__drop-indicator`). The drag-preview element is a
   permanently-mounted DOM node in `DockablePanelProvider` with its own
   styling in `DockablePanel.css` (rounded card with kind badge and
   label text, positioned offscreen by default). `setDragImage`
   screenshots it at dragstart.

## Consumers

### ObjectPanelTabs (`frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx`)

Thinnest wrapper. No drag, no close, no overflow. Maps the panel's
`(tabs, activeTab, onSelect)` props to `TabDescriptor[]` via a small
`useMemo` and renders:

```tsx
<Tabs
  aria-label="Object Panel Tabs"
  tabs={descriptors}
  activeId={activeTab}
  onActivate={(id) => onSelect(id as ViewType)}
  textTransform="uppercase"
  disableRovingTabIndex
/>
```

Every descriptor carries
`extraProps: { 'data-object-panel-focusable': 'true' }` so the
ObjectPanel's custom focus walker (queries
`[data-object-panel-focusable="true"]`) finds every tab.
`disableRovingTabIndex` forces every tab to `tabIndex={-1}` so the tab
strip stays out of the panel's own focus scope. The
`'data-object-panel-focusable'` marker is load-bearing — if it stops
being forwarded through `extraProps`, the panel's Escape/Arrow keyboard
navigation silently breaks. There is a regression test for this at
`ObjectPanelTabs.test.tsx`.

**Tab registry & filtering** (unchanged from before the shared-component
migration):

- Static `TABS` list at `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`.
- Per-kind / per-capability filtering in `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.ts`.
- Tabs (in source order): Details, Pods, Jobs, Logs, Events, YAML,
  Shell, Manifest, Values, Maintenance. Each has its own kind
  allowlists and/or capability gates.

### Diagnostics panel tabs (inline in `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`)

Four fixed tabs rendered inline inside the larger DiagnosticsPanel
component. Defined as a module-level constant (not a `useMemo`, because
the list is fully static):

```tsx
const DIAGNOSTICS_FOCUSABLE_PROPS = {
  "data-diagnostics-focusable": "true",
} as HTMLAttributes<HTMLElement>;

const DIAGNOSTICS_TAB_DESCRIPTORS: TabDescriptor[] = [
  {
    id: "refresh-domains",
    label: "Refresh Domains",
    extraProps: DIAGNOSTICS_FOCUSABLE_PROPS,
  },
  { id: "streams", label: "Streams", extraProps: DIAGNOSTICS_FOCUSABLE_PROPS },
  {
    id: "capability-checks",
    label: "Capabilities Checks",
    extraProps: DIAGNOSTICS_FOCUSABLE_PROPS,
  },
  {
    id: "effective-permissions",
    label: "Effective Permissions",
    extraProps: DIAGNOSTICS_FOCUSABLE_PROPS,
  },
];
```

Rendered as:

```tsx
<div className="diagnostics-tabs">
  <Tabs
    aria-label="Diagnostics Panel Tabs"
    tabs={DIAGNOSTICS_TAB_DESCRIPTORS}
    activeId={activeTab}
    onActivate={(id) => setActiveTab(id as DiagnosticsTabId)}
    textTransform="uppercase"
    disableRovingTabIndex
  />
</div>
```

The wrapping `<div className="diagnostics-tabs">` is kept so the
existing `.diagnostics-tabs { padding: ... }` layout rule applies. The
`data-diagnostics-focusable="true"` marker is the hook for the
panel's custom focus walker (`querySelectorAll('[data-diagnostics-focusable="true"]')`)
and, like the Object Panel marker, is load-bearing with a dedicated
regression test.

Labels are **natural case** — the shared component's
`textTransform="uppercase"` handles uppercase via CSS, so source strings
can stay readable and searchable. This pattern applies to all consumers
that use `textTransform="uppercase"`.

### ClusterTabs (`frontend/src/ui/layout/ClusterTabs.tsx`)

First drag-capable wrapper. Owns:

- Ordered-tab state with persistence via `setClusterTabOrder` at
  `frontend/src/core/persistence/clusterTabOrder.ts`.
- Label-collision fallback — when two kubeconfigs share a display name,
  the second one's label falls back to its `path:context` id.
- Close button with a port-forward confirmation modal (via
  `ConfirmationModal` from `@shared/components/modals`).
- `ResizeObserver` that publishes `--cluster-tabs-height` on `<html>`
  so dockable panels can offset correctly.
- Auto-hide: if `orderedTabs.length < 2` the component returns `null`.

Drag wiring:

```tsx
const makeDragSource = useTabDragSourceFactory();

const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
  accepts: ["cluster-tab"],
  onDrop: (payload, _event, insertIndex) => {
    const sourceIdx = mergedOrder.indexOf(payload.clusterId);
    if (sourceIdx < 0) return;
    const adjustedInsert =
      sourceIdx < insertIndex ? insertIndex - 1 : insertIndex;
    if (adjustedInsert === sourceIdx) return; // no-op drop on self
    const nextOrder = [...mergedOrder];
    nextOrder.splice(sourceIdx, 1);
    nextOrder.splice(adjustedInsert, 0, payload.clusterId);
    if (!ordersMatch(nextOrder, mergedOrder)) {
      setClusterTabOrder(nextOrder);
    }
  },
});

// tabsRef is read by the height observer; dropRef is the drop zone.
// Compose them so a single wrapper <div> serves both.
const assignRootRef = useCallback(
  (el: HTMLDivElement | null) => {
    tabsRef.current = el;
    dropRef(el);
  },
  [dropRef],
);
```

```tsx
<>
  <div ref={assignRootRef} className="cluster-tabs-wrapper">
    <Tabs
      aria-label="Cluster Tabs"
      tabs={tabDescriptors}
      activeId={activeTabId}
      onActivate={(id) => {
        const tab = tabsById.get(id);
        if (tab) handleTabClick(tab.selection);
      }}
      dropInsertIndex={dropInsertIndex}
      className="cluster-tabs"
    />
  </div>
  <ConfirmationModal ... />
</>
```

Each tab descriptor carries `title` (tooltip for truncated labels),
`closeIcon: <CloseIcon width={10} height={10} />`,
`closeAriaLabel: \`Close ${tab.label}\``, `onClose`, and the drag source
props spread into `extraProps`.

**Important**: `makeDragSource` has a new identity on every render. Do
NOT wrap `tabDescriptors.map()` in `useMemo` with `makeDragSource` as a
dep — doing so would bust the memo every render. Per-render allocation
is fine for the expected tab counts. `React.memo(ClusterTabs)` at
export still guards against parent re-renders.

**Hook ordering**: `assignRootRef` (a `useCallback`) must be declared
BEFORE the `orderedTabs.length < 2 → return null` early return, or
React throws a rules-of-hooks error.

**Legacy**: the old `moveTab(order, sourceId, targetId)` helper was
deleted as part of the migration. Its `(sourceId, targetId)` signature
doesn't round-trip correctly with `insertIndex` — for forward drags it
lands one slot too far right because it splices at the target's
original index in the already-reduced array. The inline shift
compensation above is correct for every source/insert combination.

### DockableTabBar (`frontend/src/ui/dockable/DockableTabBar.tsx`)

Most complex wrapper. Reads `dragPreviewRef` and `movePanel` from
`useDockablePanelContext()`. See `docs/development/UI/dockable-panels.md`
for the full dockable subsystem — this section only covers the tab
strip.

```tsx
const { dragPreviewRef, movePanel, closeTab } = useDockablePanelContext();
const makeDragSource = useTabDragSourceFactory();

const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
  accepts: ["dockable-tab"],
  onDrop: (payload, _event, insertIndex) => {
    movePanel(payload.panelId, payload.sourceGroupId, groupKey, insertIndex);
  },
});

const tabDescriptors: TabDescriptor[] = tabs.map((tab) => {
  const dragProps = makeDragSource(
    { kind: "dockable-tab", panelId: tab.panelId, sourceGroupId: groupKey },
    {
      getDragImage: () => {
        // Write label + kind class into the provider's always-mounted
        // preview element BEFORE setDragImage screenshots it.
        const previewEl = dragPreviewRef.current;
        if (!previewEl) return null;
        const labelEl = previewEl.querySelector<HTMLSpanElement>(
          ".dockable-tab-drag-preview__label",
        );
        if (labelEl) labelEl.textContent = tab.title;
        const kindEl = previewEl.querySelector<HTMLSpanElement>(
          ".dockable-tab-drag-preview__kind",
        );
        if (kindEl) {
          kindEl.className = `dockable-tab-drag-preview__kind kind-badge${tab.kindClass ? ` ${tab.kindClass}` : ""}`;
        }
        return { element: previewEl, offsetX: 14, offsetY: 16 };
      },
    },
  );
  return {
    id: tab.panelId,
    label: tab.title,
    leading: tab.kindClass ? (
      <span
        className={`dockable-tab__kind-indicator kind-badge ${tab.kindClass}`}
        aria-hidden="true"
      />
    ) : undefined,
    closeIcon: <CloseIcon width={10} height={10} />,
    closeAriaLabel: `Close ${tab.title}`,
    onClose: () => closeTab(tab.panelId),
    extraProps: {
      "data-panel-id": tab.panelId,
      ...dragProps,
    } as HTMLAttributes<HTMLElement>,
  };
});

return (
  <div
    ref={dropRef as (el: HTMLDivElement | null) => void}
    className="dockable-tab-bar-shell"
  >
    <Tabs
      aria-label="Object Tabs"
      tabs={tabDescriptors}
      activeId={activeTab}
      onActivate={onTabClick}
      dropInsertIndex={dropInsertIndex}
      className="dockable-tab-bar"
    />
  </div>
);
```

The per-tab `leading` slot renders the color dot (kind indicator) using
`.dockable-tab__kind-indicator.kind-badge ${tab.kindClass}` — this is
the one piece of dockable-specific visual still in `DockablePanel.css`.

### Dockable empty-space drop target

Scenario #3 (drop on empty space → create new floating group) is wired
via a small hook at
`frontend/src/ui/dockable/DockablePanelContentArea.tsx`:

```tsx
export function useDockablePanelEmptySpaceDropTarget() {
  const { createFloatingGroupWithPanel } = useDockablePanelContext();
  return useTabDropTarget({
    accepts: ["dockable-tab"],
    onDrop: (payload, event) => {
      createFloatingGroupWithPanel(payload.panelId, payload.sourceGroupId, {
        x: event.clientX,
        y: event.clientY,
      });
    },
  });
}
```

`AppLayout.tsx` calls the hook and **merges the returned ref onto its
existing `<main>` element** — no new wrapper, no `display: contents`:

```tsx
const { ref: emptySpaceDropRef } = useDockablePanelEmptySpaceDropTarget();

return (
  <div className="app-container">
    <AppHeader ... />
    <ClusterTabs />
    <main
      ref={emptySpaceDropRef as (el: HTMLElement | null) => void}
      className={`app-main ${hasActiveClusters ? '' : 'app-main-inactive'}`}
    >
      <Sidebar />
      {/* dockable panel content */}
    </main>
  </div>
);
```

Why not attach the drop target to `.dockable-panel-layer`? Because that
element has `pointer-events: none` (so clicks fall through to the app
content beneath it), and the browser will not route drag/drop events to
it. Attaching to `<main>` gives the drop target a real bounding rect
for hit-testing. **Never put `display: contents` on a drop-target
element** — it deletes the element's hit area entirely.

Native HTML5 drag events bubble. A drop that lands inside a
`DockableTabBar`'s drop target is consumed there and
`event.stopPropagation()` prevents it from reaching the container
target. A drop that lands on bare `<main>` reaches the container target
and spawns a new floating group.

### `DockablePanelProvider` — drag-related context surface

The dockable provider exposes the drag-related fields below on its
context value. See `dockable-panels.md` for the full provider contract.

| Field                                                           | Role                                                                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dragPreviewRef`                                                | `React.RefObject<HTMLDivElement>` pointing at the always-mounted `.dockable-tab-drag-preview` element. Consumed by `DockableTabBar`'s `getDragImage`.                                        |
| `movePanel(panelId, sourceGroupId, targetGroupId, insertIndex)` | Adapter called from `DockableTabBar`'s `onDrop`. Dispatches between `reorderTabInGroup` (same group, with shift compensation via `getGroupTabs`) and `movePanelBetweenGroups` (cross group). |
| `createFloatingGroupWithPanel(panelId, sourceGroupId, cursor)`  | Adapter called from the container-level empty-space drop target. Wraps `movePanelBetweenGroups(panelId, 'floating')` + `setPanelFloatingPositionById`.                                       |

The `getGroupTabs(state, groupKey)` helper in
`frontend/src/ui/dockable/tabGroupState.ts` handles the asymmetric
`TabGroupState` shape correctly: `state.right.tabs` and
`state.bottom.tabs` are keyed children, but `state.floating` is an
**array** of `FloatingTabGroup` objects, each with its own runtime
`groupId`. Naive `state[groupKey]` lookup returns `undefined` for every
floating group id and silently skips the shift compensation — the exact
bug `getGroupTabs` exists to prevent. Use the helper, not direct
property access.

## Test inventory

| File                                                                                | What it covers                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/shared/components/tabs/Tabs.test.tsx`                                 | Base component: ARIA, keyboard nav, roving tabindex, `disableRovingTabIndex`, sizing, overflow, close button, `closeIcon`/`closeAriaLabel`, reserved-key warning, empty tabs, invalid activeId.                                         |
| `frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx`      | Drag coordinator: source props, `useTabDragSourceFactory` usable inside `.map()` for unbounded lists, target kind filtering, `setDragImage` via `getDragImage`, nested drop target `stopPropagation`, `isDragOver`, payload round-trip. |
| `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.test.tsx` | Wrapper behavior + the `data-object-panel-focusable` regression test.                                                                                                                                                                   |
| `frontend/src/core/refresh/components/DiagnosticsPanel.test.ts`                     | DiagnosticsPanel tab wiring + the `data-diagnostics-focusable` regression test.                                                                                                                                                         |
| `frontend/src/ui/layout/ClusterTabs.test.tsx`                                       | Cluster tab wrapper: ordering, persistence, tab click, close, conditional rendering.                                                                                                                                                    |
| `frontend/src/ui/dockable/DockableTabBar.test.tsx`                                  | Dockable tab bar rendering, activation, close.                                                                                                                                                                                          |
| `frontend/src/ui/dockable/DockableTabBar.drag.test.tsx`                             | Dockable tab bar drag source + drop target integration with the shared coordinator.                                                                                                                                                     |
| `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`                           | Provider state, `movePanel` adapter (including floating-group shift compensation via `getGroupTabs`), container-level empty-space drop target.                                                                                          |

Storybook also carries non-test interactive coverage:

- `frontend/src/shared/components/tabs/Tabs.stories.tsx` — base
  component in isolation (default, uppercase, close buttons, leading
  slot, long labels, narrow/wide clamps, overflow with many tabs,
  disabled tabs, empty tabs, invalid activeId, keyboard nav demo).
- `frontend/src/shared/components/tabs/TabsWithDrag.stories.tsx` —
  drag coordinator stories (within-strip reorder, cross-strip drag,
  empty-space drop, type safety demo, tear-off seam).
- `ClusterTabsPreview.stories.tsx`, `ObjectPanelTabsPreview.stories.tsx`,
  `ObjectTabsPreview.stories.tsx` — Phase 1 prototype stories retained
  for isolated design exploration and as reference implementations for
  future drag-coordinator refactors.

## Design decisions (accepted compromises)

Recorded here so they don't get re-opened:

- **Object Panel number-key 1–9 shortcuts are gone.** They had ambiguous
  semantics when multiple tab strips were open simultaneously.
- **Vertical tab orientation is not supported.** All four current
  systems are horizontal; adding a vertical mode is YAGNI.
- **Live cursor-following drag previews are not supported.** The legacy
  `.dockable-tab-drag-preview` element that followed the cursor via
  pointermove + CSS custom properties was replaced by a _static_ preview
  captured once at `dragstart` via `setDragImage`. Visual styling is
  preserved; only the cursor-tracking mechanism changed (the browser
  now owns it). This fixes cross-browser flicker issues and eliminates a
  whole class of pointer-tracking edge cases.
- **Cross-strip drag for Cluster tabs is disallowed by construction.**
  The discriminated-union payload type makes accidental cross-system
  drops unrepresentable at compile time.
- **Tear-off (drag tab into a separate window) is not implemented.**
  The `onTearOff` seam on `TabDragProvider` exists but no consumer wires
  it. When Wails v3 multi-window lands, both Cluster and Dockable will
  hook into it, with a floating-panel fallback for pre-v3.

## Cross-references

- `docs/development/UI/dockable-panels.md` — full dockable subsystem:
  panel registry, group state, layout persistence, content area, z-index
  rules. The drag-specific notes there now reference the shared
  coordinator described above.
- `docs/development/UI/component-structure.md` — general frontend
  component layout conventions.
