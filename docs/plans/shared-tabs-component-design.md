# Shared Tabs Component — Design

**Status:** Design (pending implementation)
**Author:** Brainstormed with Claude, 2026-04-07
**Related:** [`docs/development/UI/tabs.md`](../development/UI/tabs.md) — current-state map of the four tab systems

## Goal

Replace the four hand-rolled tab implementations in the frontend (Object Panel, Diagnostics, Cluster, Dockable) with a single shared `<Tabs>` base component plus two thin wrappers for the systems that need drag-and-drop. Centralize tab CSS so the entire app shares one visual treatment by construction. Validate the abstraction interactively in Storybook before migrating any real consumers.

## Why

Today there are four tab systems with materially different ARIA support, keyboard handling, drag-and-drop implementations, overflow handling, and CSS class drift between them. The audit in `docs/development/UI/tabs.md` documents the current state. Concretely:

- Two systems (Object Panel, Diagnostics) have **no ARIA roles** — `tablist`/`tab`/`aria-selected` are missing entirely. Screen reader users can't navigate them as tabs.
- Two systems (Object Panel, Diagnostics) have **no keyboard navigation**. Object Panel had number-key 1–9 shortcuts that we're explicitly killing as part of this work because they conflict when multiple tab strips are open.
- The two systems with drag-and-drop (Cluster, Dockable) have **two unrelated drag implementations** with different UX, different drag previews, and different drop-target logic.
- ~190 lines of `DockablePanel.css` and ~10 lines of `ObjectPanel.css` re-implement or override base behaviors that should live in one place. Separator rendering, hover styling, focus rings, and the close-button overlay pattern are mostly correct in the shared base CSS already, but each consumer has drift on top.

The user has explicitly said tab styling should be visually identical across systems, with **text case (uppercase vs not)** as the only legitimate variation.

## Compromises taken

These were discussed during brainstorming and accepted as cost-reduction measures. Listing them here so future readers don't reopen them.

- **Number-key 1–9 shortcuts in Object Panel are killed.** They had ambiguous semantics when multiple tab strips were open.
- **Vertical tab orientation is not supported.** All four current systems are horizontal; adding a vertical mode is YAGNI.
- **Custom *live* drag previews are not supported.** The existing `.dockable-tab-drag-preview` portal that follows the cursor via mousemove is replaced by a *static* preview captured once at `dragstart` via `event.dataTransfer.setDragImage()`. The visual look is preserved (the user wanted to keep the existing styled badge); only the live cursor-tracking is dropped.
- **Cross-strip drag for Cluster tabs is explicitly disallowed by construction.** Cluster tabs only ever participate in within-strip reorder. The discriminated-union payload type makes accidental cross-system drops unrepresentable.
- **Tear-off (drag tab into a separate window) is planned for but not implemented now.** The drag coordinator exposes an `onTearOff` seam that fires when a drag ends outside any registered drop target *and* outside the window bounds. The seam is wired but no consumer implements it yet. Future Wails v3 multi-window work will hook into it.

## Architecture

Three components, composition-based (no class inheritance — React idiom):

```
                       <Tabs>
                       Universal base. Renders strip, owns ARIA, owns
                       manual-activation keyboard, owns optional overflow
                       scrolling. Knows nothing about drag, persistence,
                       or system-specific quirks.
                              ▲
                              │
            ┌─────────────────┼──────────────────┐
            │                 │                  │
       used directly by:  used directly by:  wrapped by:
            │                 │                  │
   ObjectPanelTabs       Diagnostics    ┌────────┴────────┐
                                        │                 │
                                  <ClusterTabs>     <DockableTabs>
                                  wraps <Tabs>;     wraps <Tabs>;
                                  HTML5 drag        HTML5 drag for
                                  for within-       within-strip and
                                  strip reorder;    cross-strip moves;
                                  port-forward      drop on empty
                                  warning on        space → new floating
                                  close;            panel; static custom
                                  persisted order;  preview via
                                  auto-hide < 2     setDragImage; kind
                                  clusters.         color indicators.
```

The four current consumers map cleanly:

| Today | Tomorrow |
|---|---|
| `ObjectPanelTabs.tsx` | Renders `<Tabs>` directly. Number-key shortcut effect deleted. |
| Diagnostics inline strip in `DiagnosticsPanel.tsx` | Extracted into a small local component that renders `<Tabs>` directly. |
| `ClusterTabs.tsx` | Wrapper around `<Tabs>` (file stays at the same path). Internals collapse from ~350 lines to "wrap `<Tabs>` + add HTML5 drag handlers + add port-forward warning + auto-hide guard". |
| `DockableTabBar.tsx` | Renamed to `DockableTabs.tsx` for symmetry. Wraps `<Tabs>`, adds drag for within-strip and cross-strip moves, registers the empty-space drop target on the dockable container. |

## Base `<Tabs>` API surface

The component is **fully controlled** — `activeId` and `onActivate` come from the consumer; the component holds no selection state of its own.

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
   * focused tab invokes this callback. The button is absolutely
   * positioned in space reserved by `padding-right` on the closeable
   * tab modifier — see Styling section.
   */
  onClose?: () => void;

  /** Disabled tabs are skipped by keyboard nav and don't fire onActivate. */
  disabled?: boolean;

  /**
   * Linked content panel id, applied as `aria-controls`. Optional —
   * Cluster tabs don't have a sibling tabpanel because clicking a
   * cluster tab changes global state rather than swapping a panel.
   */
  ariaControls?: string;

  /**
   * Override the accessible name. By default the tab's accessible name
   * is its text content (label), which is what every text-labeled tab
   * gets for free. Only set this when label contains no text — e.g. an
   * icon-only tab. Becomes aria-label on the tab's root element.
   */
  ariaLabel?: string;

  /**
   * Escape hatch for wrapper components (ClusterTabs, DockableTabs) to
   * attach drag handlers, custom data attributes, etc. Spread onto each
   * tab's root element (a `<div role="tab">`) BEFORE the base props, so
   * reserved keys can't be silently overridden. The base warns in dev
   * mode if extraProps contains a reserved key — see "Reserved keys"
   * below.
   */
  extraProps?: HTMLAttributes<HTMLElement>;
}

interface TabsProps {
  tabs: TabDescriptor[];
  activeId: string | null;
  onActivate: (id: string) => void;

  /** Required, for screen readers. Per-system values listed below. */
  'aria-label': string;

  /**
   * Overflow behavior. Default 'scroll'. When 'scroll', the strip
   * measures itself and, when content exceeds the container width,
   * renders BOTH ◀ ▶ scroll chevrons together (sticky children of the
   * strip). Each chevron greys out via the native `disabled` attribute
   * when its direction is exhausted (scrollLeft at 0 or max). Clicking
   * advances one tab at a time via a manual requestAnimationFrame
   * animation (250ms ease-out-cubic). The active tab is auto-scrolled
   * into view on activation. Set to 'none' to disable overflow entirely.
   */
  overflow?: 'scroll' | 'none';

  /**
   * How tabs are sized within the strip:
   * - 'fit' (default): each tab takes its content width, clamped between
   *   minTabWidth and maxTabWidth. Long labels truncate with ellipsis.
   * - 'equal': all tabs share the strip width equally (flex: 1 1 0),
   *   each clamped between minTabWidth and maxTabWidth.
   */
  tabSizing?: 'fit' | 'equal';

  /**
   * Floor for tab width. Mode-specific default:
   * - `'fit'` mode: defaults to `0` so short labels like "YAML" size
   *   tightly to their content without being bloated to a floor.
   * - `'equal'` mode: defaults to `80px` so tabs sharing a strip don't
   *   collapse below a readable width.
   * Closeable tabs in `'fit'` mode additionally get an 80px floor
   * enforced by CSS so the overlay close button has room.
   */
  minTabWidth?: number;

  /** Default 240px. Labels longer than this truncate with ellipsis. */
  maxTabWidth?: number;

  /**
   * The only legitimate per-system visual variation. Default 'none'.
   * Object Panel and Diagnostics use 'uppercase'; Cluster and Dockable
   * use 'none'. Implemented via a modifier class on the strip root.
   */
  textTransform?: 'none' | 'uppercase';

  /** Merged onto the root <div className="tab-strip">. */
  className?: string;

  /** Optional id for the root tablist element. */
  id?: string;

  /**
   * When set to an integer in `[0, tabs.length]`, a thin vertical drop
   * indicator bar is rendered at that flex position inside the strip:
   * `0` places it before the first tab, `tabs.length` after the last.
   * Used by drag-and-drop wrappers (see `useTabDropTarget`) to show
   * where a dragged tab will land if released. Pair with the companion
   * hook's `dropInsertIndex` return value to wire this up.
   */
  dropInsertIndex?: number | null;
}
```

### Required `aria-label` per consumer

| Consumer | `aria-label` |
|---|---|
| `ObjectPanelTabs` | `"Object Panel Tabs"` |
| Diagnostics strip | `"Diagnostics Panel Tabs"` |
| `ClusterTabs` | `"Cluster Tabs"` |
| `DockableTabs` | `"Object Tabs"` |

### Reserved keys

`extraProps` is a freeform `HTMLAttributes<HTMLElement>` pass-through merged onto each tab's root element (a `<div role="tab">`). The base reserves these keys for itself:

```
role, aria-selected, aria-controls, aria-disabled, aria-label,
tabIndex, id, onClick, onKeyDown
```

In dev mode (`process.env.NODE_ENV !== 'production'`), the base warns when `extraProps` contains any reserved key. Production builds skip the check entirely (zero runtime cost). The base spreads `extraProps` *first*, then its own reserved props on top, so even if a wrapper accidentally sets `tabIndex`, the base's tabIndex wins at the DOM level — the warning fires but ARIA stays correct (defense in depth).

### DOM structure

Each tab's root element is `<div role="tab">`, NOT `<button role="tab">`. This lets the close affordance be a real nested `<button type="button">` without violating HTML's ban on interactive content inside a `<button>`. The roving tabindex below gives the `<div>` keyboard focusability; the explicit `handleKeyDown` implements Enter/Space activation that a `<div>` would otherwise lack. The close `<button>` is reached by pointer only (hover/focus-visible reveals it via CSS) or by pressing Delete/Backspace on the focused tab; it has `tabIndex={-1}` so it isn't a separate Tab stop.

### Behavior contracts

- **Keyboard (roving tabindex):** WAI-ARIA manual activation pattern. Exactly one tab at a time has `tabIndex=0`; all others have `tabIndex=-1`. Normally that's the active tab. When no tab matches `activeId` (either `activeId === null` or it points to a nonexistent tab), the first non-disabled tab receives `tabIndex=0` as a fallback so the strip remains reachable via Tab. This makes browser Tab key step *into* the strip (focusing the active — or fallback — tab) and step *out* to the next focusable element. Within the strip, Left/Right arrows move focus between tabs without changing the active selection; Home/End jump to first/last; Enter or Space activates the focused tab; Delete or Backspace on the focused tab invokes its `onClose` if set. Disabled tabs are skipped during arrow navigation.
- **Click:** Activates immediately, calls `onActivate(id)`. Disabled tabs swallow the click.
- **Overflow:** When `overflow='scroll'` (default), the component measures itself with `ResizeObserver`. When `scrollWidth > clientWidth`, BOTH ◀ ▶ chevrons render together as sticky flex children of the strip. Each chevron is greyed out (via the native `disabled` attribute) when its direction is exhausted — left at `scrollLeft <= 0`, right at `scrollLeft >= maxScrollLeft - 1`. Clicking a chevron scrolls one tab at a time via a manual `requestAnimationFrame` animation (250ms ease-out-cubic); rapid clicks accumulate via `pendingScrollTargetRef` so N clicks always advance N tabs, and the animation is always guaranteed to reach its target (no reliance on browser-level smooth scroll, which is unreliable cross-browser). There is no count badge — the design intentionally keeps both chevrons mounted simultaneously instead of per-side conditional rendering, which guarantees tab positions stay stable across clicks (no layout shifts to compensate for). When `activeId` changes, the active tab is `scrollIntoView({ inline: 'nearest', behavior: 'smooth' })`-ed automatically.
- **Drop indicator:** When `dropInsertIndex` is a number, a thin accent-colored vertical bar is rendered as a flex child at that position to show the drop landing site during a drag. Used by the `useTabDropTarget` hook's companion return value.
- **Empty `tabs`:** Renders the container, no tabs inside. No crash.
- **Invalid `activeId`:** If `activeId` doesn't match any tab, no tab gets `aria-selected={true}` and the roving-tabindex fallback described above keeps the strip reachable. Arrow nav focuses the next non-disabled tab from whichever tab currently holds the focus stop.

### Layout model

The tab is a flex container internally. The min/max width applies to the entire `<div role="tab">` root element, not the label.

```
                ┌─ position: absolute, hover/focus-within: opacity 1 ─┐
                │                                                     │
┌───────────────┼─────────────────────────────────────────────────────┼─┐
│ [leading]  [label (full width minus leading minus reserved padding)] [×]│
└───────────────┴─────────────────────────────────────────────────────┴─┘
  ←—————————————— minTabWidth..maxTabWidth ——————————————→
```

- `leading` is `flex: 0 0 auto` — takes its natural width and contributes to sizing.
- `label` is `flex: 1 1 auto` with `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. It's the only element that shrinks and the only element that truncates.
- The close button (when `onClose` is set) is `position: absolute; right: 1px` and hover-revealed (`opacity: 0` → `1`). It's reserved space inside the tab via `padding-right: 1.2rem` on the `tab-item--closeable` modifier — so the label never sits underneath the button regardless of hover state.
- **Consequence of the reserved-padding model:** closeable tabs have ~17px less label area than non-closeable tabs at the same outer width. In `'equal'` mode mixing closeable and non-closeable tabs in the same strip, the closeable ones truncate slightly earlier — but none of our four consumers mix them in practice (Cluster + Dockable are 100% closeable; Object Panel + Diagnostics are 100% non-closeable).

## Drag coordinator

Lives in `frontend/src/shared/components/tabs/dragCoordinator/`. Built on HTML5 native drag events under the hood, exposed via React hooks. The transport choice is intentionally encapsulated so the coordinator can switch to pointer events later without changing wrapper-side code.

### Drag/drop scenarios

| # | Source | Target | Action | Cluster | Dockable |
|---|---|---|---|:---:|:---:|
| 1 | Tab in strip | Another tab in the **same** strip | Reorder within strip | ✓ | ✓ |
| 2 | Tab in strip | Another tab in a **different** strip (same dockable container) | Move tab between dock groups | ❌ | ✓ |
| 3 | Tab in strip | **Empty space** in the dockable container | Create a new dock group | ❌ | ✓ |
| 4 | Tab in strip | **Outside the source strip and outside any current container** | Tear off into a new floating panel (now) → into a new OS window (future Wails v3) | ⏳ | ⏳ |

### Payload type

```ts
// Discriminated union — a drop target declares which kinds it accepts,
// and TypeScript guarantees no other kind can leak in.
type TabDragPayload =
  | { kind: 'cluster-tab'; clusterId: string }
  | { kind: 'dockable-tab'; panelId: string; sourceGroupId: string };

type TabDragKind = TabDragPayload['kind'];
```

This is the load-bearing type that makes cross-system drops impossible by construction. Cluster tabs and Dockable tabs are different kinds; every drop target declares which kind(s) it accepts; the compiler refuses to call a `'dockable-tab'`-only handler with a `'cluster-tab'` payload.

### Hooks

```ts
/**
 * Source: turn an element into a drag source. Returns props the consumer
 * spreads onto the tab via `extraProps` on the descriptor.
 *
 * Pass `null` to make the tab non-draggable.
 */
function useTabDragSource(
  payload: TabDragPayload | null,
  options?: {
    /**
     * Optional custom drag preview. Invoked synchronously at dragstart
     * time. Return the element + cursor offset to use as the drag image
     * (via dataTransfer.setDragImage), or null/undefined to fall back to
     * the browser's default (a translucent screenshot of the source).
     *
     * The element MUST already be in the DOM when this is called — the
     * browser screenshots it once and never re-reads it. If the wrapper
     * needs dynamic content, it should set the element's content
     * imperatively inside this callback (don't rely on React state —
     * state updates won't have flushed yet).
     */
    getDragImage?: () => { element: HTMLElement; offsetX: number; offsetY: number } | null;
  }
): {
  draggable: boolean;
  onDragStart: DragEventHandler<HTMLElement>;
  onDragEnd: DragEventHandler<HTMLElement>;
};

/**
 * Target: turn an element into a drop zone for one or more drag kinds.
 * The narrow generic on `accepts` types the `onDrop` payload precisely.
 */
function useTabDropTarget<K extends TabDragKind>(opts: {
  accepts: K[];
  onDrop: (payload: Extract<TabDragPayload, { kind: K }>, event: DragEvent) => void;
  onDragEnter?: (payload: Extract<TabDragPayload, { kind: K }>) => void;
  onDragLeave?: () => void;
}): {
  ref: RefCallback<HTMLElement>;
  isDragOver: boolean; // for hover styling on the target
};

/**
 * Provider that scopes a single drag operation. Wraps any component tree
 * that contains drag sources and/or drop targets. Holds the current drag
 * state and the target registry. Attaches a global `dragend` listener
 * for the tear-off seam.
 */
function TabDragProvider(props: {
  children: ReactNode;
  /**
   * Future. Fires when a drag ends with no target consuming it AND the
   * cursor is outside the app window bounds. Wrappers can implement this
   * to spawn a new window (Wails v3) or fall back to a floating panel.
   * Stubbed but not currently wired by any consumer.
   */
  onTearOff?: (payload: TabDragPayload, cursor: { x: number; y: number }) => void;
}): JSX.Element;
```

### Implementation notes

- **HTML5 native under the hood.** The hooks generate the event handlers and the `draggable` boolean; consumers spread them via `extraProps` on each tab descriptor. The browser handles the drag image, cursor, and (eventually) cross-window awareness for free.
- **Payload survives the round trip.** On `dragstart` the source writes JSON to `event.dataTransfer.setData('application/x-luxury-yacht-tab', ...)`. On `drop` the target reads it back. This means the payload travels even if React state was wiped — important for the future tear-off case where the drop happens in a different window context.
- **Provider holds the registry.** A React context with `currentDrag: TabDragPayload | null` plus a Map of target registrations keyed by element ref. The provider updates `currentDrag` on `dragstart`/`dragend` and matches targets against `currentDrag.kind` when `dragenter` fires.
- **Custom preview via `setDragImage`.** Wrappers that want a styled preview render an offscreen DOM element (positioned `top: -9999px; left: -9999px`) and provide `getDragImage` returning a ref to it. The hook calls `event.dataTransfer.setDragImage(element, offsetX, offsetY)` at dragstart time. Cluster doesn't need this (the browser default — a translucent copy of the source — is appropriate for within-strip reorder). Dockable uses it to preserve its existing drag-preview look.
- **Tear-off seam.** The provider attaches a global `dragend` listener that checks `event.dataTransfer.dropEffect === 'none'` (no target accepted the drop) AND the cursor coordinates fall outside `window.innerWidth/innerHeight`. If both, it fires `onTearOff` with the payload. Currently no consumer wires this — the seam is reserved for future Wails v3 multi-window work.

### How each system uses it

**ClusterTabs (#1 only — and #4 future):**

```tsx
function ClusterTab({ cluster }: { cluster: Cluster }) {
  const dragSourceProps = useTabDragSource({ kind: 'cluster-tab', clusterId: cluster.id });
  // dragSourceProps go into the descriptor's extraProps
}

function ClusterTabs() {
  // One drop target for the strip itself, accepting only cluster-tab.
  // Within-strip reorder is handled here.
  const { ref } = useTabDropTarget({
    accepts: ['cluster-tab'],
    onDrop: (payload, event) => reorderCluster(payload.clusterId, computeDropIndex(event)),
  });
  return <div ref={ref}><Tabs ... /></div>;
}
```

Cluster has exactly one drop target (the strip), accepting exactly one payload kind. Cross-strip moves are not *expressible* — there's nowhere for them to go.

**DockableTabs (#1, #2, #3 now; #4 future):**

```tsx
function DockableTab({ panel, groupId }: { panel: Panel; groupId: string }) {
  const dragSourceProps = useTabDragSource(
    { kind: 'dockable-tab', panelId: panel.id, sourceGroupId: groupId },
    { getDragImage: () => /* offscreen preview element ref */ }
  );
}

function DockableTabs({ groupId }: { groupId: string }) {
  // #1 + #2: drop target for THIS strip, accepting dockable-tab.
  // Reorder if same source group, move if different group.
  const { ref } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => {
      if (payload.sourceGroupId === groupId) {
        reorderInGroup(payload.panelId, computeDropIndex(event));
      } else {
        moveBetweenGroups(payload.panelId, payload.sourceGroupId, groupId, computeDropIndex(event));
      }
    },
  });
  return <div ref={ref}><Tabs ... /></div>;
}
```

The dockable container (somewhere outside `DockableTabs`) registers the **#3 empty-space target**:

```tsx
function DockableContainer() {
  const { ref } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, event) => createFloatingGroupWithPanel(
      payload.panelId, payload.sourceGroupId,
      { x: event.clientX, y: event.clientY }
    ),
  });
  return <div ref={ref}>{/* container content */}</div>;
}
```

The provider's match logic ensures that when a `cluster-tab` is dragged over the dockable container, none of these targets fire. Type-safe at construction time, runtime-safe at dispatch time.

## Styling consolidation

Today there's ~190 lines of tab-related CSS in `DockablePanel.css`, ~10 in `ObjectPanel.css`, ~7 in `DiagnosticsPanel.css`, ~19 in `ClusterTabs.css`, on top of 135 lines of base in `frontend/styles/components/tabs.css`. Most of it is drift on top of base behaviors that the base already implements correctly.

### What moves where

| File | Change | Net |
|---|---|---|
| `frontend/styles/components/tabs.css` | **GROWS** from 135 → ~250 lines. Adds: sizing modifiers (`.tab-strip--sizing-fit`, `--sizing-equal`), `--tab-item-min-width` / `--tab-item-max-width` custom properties (set via inline style from `<Tabs>` props), `.tab-strip--uppercase` modifier, full overflow scroll button block (`.tab-strip__overflow-indicator` family) moved from `DockablePanel.css`. Class names renamed from `.dockable-tab-bar__overflow-*` to `.tab-strip__overflow-*`. | +115 |
| `DockablePanel.css` | **SHRINKS** by ~110 lines. Deleted: the `.dockable-tab-drag-preview*` cursor-follower portal (~47 lines, dead — replaced by `setDragImage` offscreen host); the `.dockable-tab-bar__overflow-indicator` family (~60 lines, moved to base); `.dockable-tab__label` max-width (~3 lines, replaced by sizing API). The `border-bottom: none` override on `.dockable-tab-bar` is also removed so Dockable tabs match the rest of the app's underline. Kept: `.dockable-tab-bar-shell` (layout container), `.dockable-tab` user-select/flex-shrink, `.dockable-tab__kind-indicator` (the colored kind dot — only Dockable has this), and the drag-state classes (`.dockable-tab--dragging`, `.dockable-tab-bar--drag-active`, `.dockable-tab-bar--drop-target`, `.dockable-tab-bar__drop-indicator`). | -110 |
| `ClusterTabs.css` | **UNCHANGED** (19 lines). The `.cluster-tabs` positioning and `.cluster-tab--dragging` / `.cluster-tab--drop-target` drag-state classes are legitimate wrapper-specific styling. They should reference the same `var(--color-accent)` tokens as Dockable's drag-state classes so the visuals match across systems. | 0 |
| `ObjectPanel.css` | **SHRINKS** by ~6 lines. Deleted: the `.object-panel .tab-item { text-transform: uppercase }` override (replaced by `textTransform="uppercase"` prop on `<Tabs>`). Kept: `.object-panel-body > .tab-strip { flex-shrink: 0 }` (layout integration). | -6 |
| `DiagnosticsPanel.css` | **SHRINKS** by ~3 lines. Deleted: the `.diagnostics-tabs .tab-item { text-transform: uppercase }` override. Kept: `.diagnostics-tabs { padding }` wrapper (layout integration). | -3 |

**Net effect:** ~170 lines of CSS deleted across component files; ~115 added to the base. Total shrinkage of ~55 lines, but the more important outcome is **visual consistency by construction** — all four systems get the same colors, hover states, active border, separators, focus outlines, close button overlay, and transitions because they all come from one place.

### How variants are expressed

Three real sources of per-system variation. All of them get a uniform mechanism instead of ad-hoc selectors.

1. **Text case (uppercase vs not).** The only legitimate visual difference between systems.
   - Mechanism: `textTransform?: 'none' | 'uppercase'` prop on `<Tabs>`. When `'uppercase'`, the base adds `tab-strip--uppercase` to the root className.
   - **Object Panel** and **Diagnostics** pass `textTransform="uppercase"`. Cluster and Dockable don't.
   - CSS:
     ```css
     .tab-strip--uppercase .tab-item {
       text-transform: uppercase;
     }
     ```

2. **Min/max tab width.** Driven by the `minTabWidth` / `maxTabWidth` props.
   - Mechanism: the component sets CSS custom properties via inline `style` on the root, and the base CSS reads them.
     ```tsx
     <div
       className="tab-strip"
       style={{
         '--tab-item-min-width': `${minTabWidth ?? 80}px`,
         '--tab-item-max-width': `${maxTabWidth ?? 240}px`,
       } as CSSProperties}
     >
     ```
     ```css
     .tab-strip--sizing-fit .tab-item {
       flex: 0 0 auto;
       min-width: var(--tab-item-min-width, 80px);
       max-width: var(--tab-item-max-width, 240px);
     }
     .tab-strip--sizing-equal .tab-item {
       flex: 1 1 0;
       min-width: var(--tab-item-min-width, 80px);
       max-width: var(--tab-item-max-width, 240px);
     }
     ```
   - This keeps the per-instance values in React (where they're typed) and the rendering in CSS (where it belongs).

3. **Drag-state visuals (drag preview, drop target highlight, drop indicator).**
   - These stay in the wrapper CSS files (`ClusterTabs.css`, `DockablePanel.css`) because drag itself is wrapper-specific.
   - But they should reference shared design tokens — `var(--color-accent)`, `var(--color-bg-tertiary)` — instead of hardcoded colors, so they stay visually consistent with the base.
   - Cluster's `.cluster-tab--dragging` and Dockable's `.dockable-tab--dragging` should use the same recipe (accent-tinted background, 0.65 opacity, inset accent border). They live in different files but share an identical specification — enforced by code review, not by structure.

## Storybook prototype

The base `<Tabs>` component is built and validated in Storybook before any of the four real consumers are migrated. The prototype is the actual production component, not a throwaway — interaction issues found in Storybook are fixed in `Tabs.tsx`, and the result becomes what the migration consumes.

### Story files

Two story files, one for the base (no drag), one for the wrappers / drag coordinator. Both are created via the **`new-story` skill**, located alongside `Tabs.tsx` per the existing Storybook convention in this repo.

```
frontend/src/shared/components/tabs/
├── Tabs.tsx                       # the component
├── Tabs.stories.tsx               # NEW — non-drag stories
├── TabsWithDrag.stories.tsx       # NEW — drag coordinator stories
└── dragCoordinator/
    └── ...                        # see "Drag coordinator" section
```

### `Tabs.stories.tsx` — non-drag stories

The base component in isolation. Each story renders `<Tabs>` with controlled state via a small wrapper that holds `activeId` in `useState` and logs `onActivate` to the actions panel.

- **Default** — 4 short tabs, default sizing, no close buttons, no overflow.
- **Uppercase variant** — same as Default but `textTransform="uppercase"`. Mirrors Object Panel / Diagnostics look.
- **With close buttons** — closeable tabs, hover the tab to reveal the ✕, click or press Delete on the focused tab to log onClose.
- **With leading slot** — tabs with a colored dot (kind indicator) before the label. Mirrors Dockable visuals.
- **Long labels — fit sizing** — labels long enough to truncate at `maxTabWidth: 240`, demonstrating ellipsis.
- **Long labels — equal sizing** — `tabSizing="equal"` so all tabs share the strip width equally, with truncation.
- **Narrow / wide width clamps** — explicit `minTabWidth` and `maxTabWidth` overrides, e.g., `minTabWidth: 50`, `maxTabWidth: 120`.
- **Overflow with many tabs** — 20+ tabs in a fixed-width container, forcing both scroll chevrons to render. Demonstrates auto-scroll-into-view: clicking a tab via external controls (not the strip) scrolls it into view. Verifies that each chevron greys out at its extreme via the native `disabled` attribute.
- **Disabled tabs** — interleaved disabled tabs that arrow nav skips and clicks/keyboard activation ignore.
- **Empty tabs array** — renders the empty container without crashing.
- **Invalid `activeId`** — `activeId` set to a non-existent id; demonstrates that no tab gets the active state and arrow nav still focuses the first tab.
- **Keyboard nav demo** — focus the strip, arrow keys move focus, Enter/Space activates, Home/End jump to ends, Delete on a closeable tab fires onClose.

### `TabsWithDrag.stories.tsx` — drag coordinator stories

Wraps the base in a `<TabDragProvider>` and uses `useTabDragSource` / `useTabDropTarget` to demonstrate drag scenarios. Each story logs callback events to the Storybook actions panel.

- **Within-strip reorder (cluster-style)** — single strip, drag a tab to a new position, payload `{ kind: 'cluster-tab', clusterId }`. Updates local state, reflows the strip.
- **Within-strip reorder (dockable-style with custom preview)** — same as above but uses `getDragImage` to provide a custom-styled preview element. Demonstrates the `setDragImage` path.
- **Cross-strip drag (dockable-style)** — two side-by-side strips, both `dockable-tab` payload, drag a tab from one strip into the other. Updates the source and destination state.
- **Drop on empty space → new strip** — two strips plus an empty area below them registered as a drop target. Dragging a tab onto the empty area "creates a new group" (in the prototype, just adds a third strip).
- **Type safety demo** — one strip with `cluster-tab` payload, another with `dockable-tab` payload. Try to drag between them — nothing happens, because the targets only accept their own kind. The story documents this in MDX-style notes.
- **Tear-off seam** — single strip with the provider's `onTearOff` wired to log to actions. Drag a tab outside the Storybook iframe bounds to fire it. Validates the seam exists even though no real consumer implements it yet.

### What Storybook validates that tests don't

Storybook lets the user *interact* with edge cases that are easy to specify in tests but hard to feel:

- "Does the close button feel snappy on hover?"
- "Is the auto-scroll-into-view animation jarring?"
- "Does the truncation point look right with our actual font?"
- "Is the focus outline visible enough on dark backgrounds?"
- "Does the drop indicator land where I expect when I drag between tabs?"

Tests still get written for the base (Section "Test plan" below) — Storybook is for the things that don't translate to assertions.

### Story creation rules

The user explicitly requested that the **`new-story` skill** is invoked when creating each story file. The skill handles the project's Storybook conventions: real components (no synthetic wrappers), project CSS classes, the standard decorators (`KeyboardProvider`, `Theme`, etc.) from `frontend/.storybook/decorators/`. I'll invoke it for each of the two story files at implementation time.

## File layout

```
frontend/src/shared/components/tabs/
├── Tabs.tsx                        # NEW — the base component
├── Tabs.test.tsx                   # NEW — base component tests
├── Tabs.stories.tsx                # NEW — non-drag stories (via new-story skill)
├── TabsWithDrag.stories.tsx        # NEW — drag coordinator stories (via new-story skill)
├── dragCoordinator/
│   ├── TabDragProvider.tsx         # NEW — provider + global dragend listener
│   ├── useTabDragSource.ts         # NEW — source hook
│   ├── useTabDropTarget.ts         # NEW — target hook
│   ├── types.ts                    # NEW — TabDragPayload union
│   ├── dragCoordinator.test.tsx    # NEW — coordinator tests
│   └── index.ts                    # NEW — barrel
└── index.ts                        # MODIFIED — public exports
```

```
# DELETED:
frontend/src/shared/components/tabs/Tabs/index.tsx   # vestigial useTabStyles() shim
frontend/src/shared/components/tabs/Tabs/Tabs.css    # if it exists and is empty/dead
```

```
# MODIFIED EXISTING FILES:
frontend/styles/components/tabs.css                  # extended with new selectors
                                                     # (sizing modifiers, custom properties,
                                                     # uppercase variant, overflow indicators)

frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx
                                                     # rewritten to render <Tabs> directly,
                                                     # number-key effect deleted

frontend/src/core/refresh/components/DiagnosticsPanel.tsx
                                                     # extracted inline strip into a small
                                                     # local component that renders <Tabs>

frontend/src/ui/layout/ClusterTabs.tsx               # rewritten as a wrapper around <Tabs>;
                                                     # path unchanged

frontend/src/ui/dockable/DockableTabBar.tsx          # RENAMED → DockableTabs.tsx, rewritten
                                                     # as a wrapper around <Tabs>

frontend/src/ui/dockable/DockablePanelProvider.tsx   # children wrapped in <TabDragProvider>;
                                                     # empty-space drop target registered;
                                                     # old mousemove drag tracking removed

frontend/src/ui/dockable/DockablePanel.css           # ~110 lines deleted (see Styling section)
frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.css   # ~6 lines deleted
frontend/src/core/refresh/components/DiagnosticsPanel.css                  # ~3 lines deleted
```

```
# DOCUMENTATION:
docs/development/UI/tabs.md                          # rewritten — replaces the four-systems
                                                     # map with the new architecture, links
                                                     # to dockable-panels.md and the new
                                                     # shared component

docs/development/UI/dockable-panels.md               # drag section updated to reference
                                                     # the coordinator instead of the old
                                                     # custom dragState/mousemove machinery
```

## Implementation order

The Storybook prototype is the first chunk of implementation. The migration to real consumers is gated on prototype approval.

### Phase 1: Prototype (validates the design)

1. **Build the base `<Tabs>` component.** All Section 2 features except drag: rendering, ARIA, manual-activation keyboard, sizing modes, overflow scrolling, auto-scroll-into-view, close button overlay, `extraProps` seam, dev-mode reserved-key warning, `textTransform` modifier. Real implementation, not a stub.
2. **Build `Tabs.stories.tsx`** via the `new-story` skill, covering all the non-drag stories listed above.
3. **Build the drag coordinator scaffolding.** `TabDragProvider`, `useTabDragSource`, `useTabDropTarget`, the discriminated payload type, the global `dragend` listener with `onTearOff` seam.
4. **Build `TabsWithDrag.stories.tsx`** via the `new-story` skill, covering all the drag stories listed above.
5. **User interactive review.** `npm run storybook`. Click through every story. Adjust spec and prototype based on findings. Iterate until the prototype is approved.

### Phase 2: Migration (moves the four real consumers)

After prototype approval, this phase happens via the `writing-plans` skill — a separate detailed plan that this design doc does not enumerate further. **Intended as a single big-bang merge** (per the brainstorming decision: design for all four systems' needs upfront, migrate them all in the same change set rather than incrementally). The sequential dev order within that change set is:

1. **Migrate Diagnostics.** Smallest consumer; lowest risk; first real-world validation of the abstraction.
2. **Migrate Object Panel.** Slightly more complex (kind/capability filtering, more tabs). Number-key shortcut effect deleted.
3. **Migrate Cluster Tabs.** First wrapper. Uses the drag coordinator for #1 only. Brings persisted order, port-forward warning, auto-hide.
4. **Migrate Dockable Tabs.** Most complex wrapper. Uses the drag coordinator for #1, #2, and #3. Renames `DockableTabBar.tsx` → `DockableTabs.tsx`. Updates `DockablePanelProvider.tsx` to wrap children in `<TabDragProvider>` and register the empty-space drop target. Removes the old mousemove drag tracking.
5. **Delete the vestigial `useTabStyles()` shim** at `frontend/src/shared/components/tabs/Tabs/index.tsx`.
6. **Update documentation** — `tabs.md` and `dockable-panels.md`.
7. **Run `mage qc:prerelease`.** All tests pass; lint, typecheck, format, trivy clean.

## Test plan

Storybook covers interactive validation. Vitest covers regression coverage.

### New tests

- **`Tabs.test.tsx`** — base component in isolation:
  - Renders the right number of tabs
  - ARIA: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` plumbed
  - Required `aria-label` is applied
  - Manual activation: arrow keys move focus without changing `activeId`; Enter/Space activates
  - Home/End jump to first/last; disabled tabs skipped
  - Delete/Backspace on a focused closeable tab fires `onClose`
  - Click activates; click on disabled tab does nothing
  - Sizing modes: `'fit'` vs `'equal'` produce different flex behavior
  - Min/max width clamps applied via CSS custom properties
  - Overflow scroll buttons appear when content exceeds container width
  - Auto-scroll-into-view fires when `activeId` changes to an off-screen tab
  - Close button rendered when `onClose` is set, not rendered otherwise
  - `textTransform="uppercase"` adds the modifier class
  - Dev-mode reserved-key warning fires when `extraProps` contains a reserved key
  - Empty `tabs` array renders without crash
  - Invalid `activeId` doesn't crash; no tab gets `aria-selected={true}`

- **`dragCoordinator.test.tsx`** — coordinator integration:
  - Source hook returns drag handlers and `draggable: true` when payload is set
  - Source hook returns `draggable: false` when payload is null
  - Payload round-trips through `dataTransfer.setData` / `getData`
  - Target only fires `onDrop` when payload kind matches `accepts`
  - Target's `isDragOver` reflects the current drag state
  - `setDragImage` is called when `getDragImage` returns an element
  - `getDragImage` returning null falls back to browser default (no `setDragImage` call)
  - `onTearOff` fires when drag ends with `dropEffect === 'none'` AND cursor outside window bounds
  - `onTearOff` does NOT fire when drag ends inside window bounds, even with no target

### Existing tests preserved/updated

- `ObjectPanelTabs.test.tsx` — mostly survives. Number-key shortcut tests deleted.
- `DiagnosticsPanel.test.ts` — 4 tab-switch assertions stay. Custom focus-attribute assertion stays (it's panel-internal, not tab-related).
- `ClusterTabs.test.tsx` — survives. Drag tests rewrite to use the coordinator's testing helpers. Port-forward warning and auto-hide tests stay verbatim.
- `DockableTabBar.test.tsx` + `DockableTabBar.drag.test.tsx` — survive. Drag tests rewrite to use the coordinator. File renamed to `DockableTabs.test.tsx`.
- `DockablePanelProvider.test.tsx` — drag-state tests rewritten to use the coordinator. Other panel-layout tests untouched.

## Open future work

- **#4 tear-off (drag tab into separate window).** The `onTearOff` seam exists in the provider but is not wired by any consumer. The natural follow-on is to implement it for both Cluster and Dockable when Wails v3 multi-window lands, with a fallback to floating panels for the pre-v3 timeframe if desired. This is its own feature with its own design — not part of this work.

## Non-goals (explicit)

- **No react-dnd.** Too heavy for our needs and a new dependency.
- **No custom pointer-event drag system** (yet). HTML5 native is enough; if it falls short during prototype review, the coordinator's transport can be swapped without changing wrapper-side code.
- **No CSS modules / styled-components.** The codebase uses plain global CSS with BEM-ish names; introducing modules just for tabs would be inconsistent.
- **No theming/dark-mode work.** The base CSS already references `--color-*` tokens; theme changes propagate for free.
- **No vertical orientation.** All current systems are horizontal; YAGNI.
- **No renaming of `tab-strip` / `tab-item` base CSS classes.** Already used by all four consumers; renaming would be churn for nothing.
