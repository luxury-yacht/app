# Frontend Component Structure

Frontend placement should make ownership obvious and keep dependencies flowing
from app infrastructure to features to reusable building blocks.

## Agent Contract

- Put app infrastructure in `core/`.
- Put feature-owned UI in `modules/`.
- Put app shell, navigation, panels, modals, command palette, settings, and
  shortcuts in `ui/`.
- Put reusable components, hooks, utilities, constants, and styles in `shared/`.
- Do not make `shared/` depend on a feature module.
- Do not bypass documented data-access, permission, refresh, keyboard, modal,
  table, or tab infrastructure from feature code.
- New cross-feature behavior should move down only after at least two real
  consumers need the same abstraction.

## Directory Roles

| Directory | Owns |
| --- | --- |
| `core/` | App infrastructure, data brokers, refresh, capabilities, contexts, settings |
| `modules/` | User-facing feature workflows such as browse, namespace, object panel, object map |
| `ui/` | App shell surfaces such as layout, settings, panels, command palette, shortcuts |
| `shared/` | Reusable components, hooks, icons, actions, constants, and pure utilities |
| `styles/` | Global and shared CSS loaded by the app |

`hooks/`, `utils/`, and `types/` under a feature directory are local to that
feature. Promote only when the dependency direction stays clean.

Cross-cluster comparison workflows live under `modules/global`. They may read
multiple cluster-keyed states, but each refresh read and object/navigation
reference must retain its originating `clusterId`. Cluster-only resource views
remain under `modules/cluster`; do not route Global views through the cluster
resource manager.

Cross-feature cluster runtime state lives in the React-free
`core/cluster-workspace` store. Contexts and hooks may select or adapt that
state, but must not mirror lifecycle, auth, health, scope revision, selection,
or foreground serviceability in another map. The store owns Wails runtime
subscriptions; feature code consumes its snapshot or a documented downstream
wake-up event.

## Shared Transient Popups

Shared dropdown menus render in a body-level portal so table, split-pane,
modal, and docked-panel overflow cannot clip them or make them participate in
layout. The shared dropdown owns viewport placement, available-height
constraints, scroll/resize repositioning, outside-click containment, and popup
keyboard registration. Consumers may provide a direct popup class through
`dropdownClassName`; do not style a portaled menu through a trigger ancestor.

A focusable body-level popup must declare its owning popup ID, and a control
inside the owning modal must reference that ID with `aria-controls`. The shared
modal focus trap uses that explicit relationship to keep the popup interactive
without admitting unrelated body content into the modal focus boundary.

## Multi-select dropdown options

Every multi-select `Dropdown` renders its option content through the shared
`DropdownFilterOption` (`shared/components/dropdowns/Dropdown/DropdownFilterOption.tsx`).
Selection is a real checkbox, not a text glyph, and it is decided in one place.

- Do not hand-roll `.dropdown-filter-option` / `.dropdown-filter-box` markup in a
  feature renderer. Before this component existed the same markup was duplicated
  seven times across five files and drifted apart.
- A custom `renderOption` should still delegate to `DropdownFilterOption` and pass
  a rich `label` node, rather than rebuilding the control alongside its own label.
- States are `on`, `off`, and `required`. `required` means on-and-not-changeable
  and is a state of the control; never explain it with an extra word in the row.
- `plain` drops the control for action rows (`Select all`) so they do not carry a
  permanently empty checkbox.
- `dimWhenOff` is opt-in and belongs only to menus where "off" means the item is
  absent from a view — the GridTable Columns menu today. Filter menus must not
  set it: most of their options are off by default, so dimming would flag the
  normal case as an anomaly.

Row-level behavior (drag-to-reorder, per-row affordances) goes through
`Dropdown`'s `getOptionRowProps`; `renderOptionActions` only owns the trailing
slot and cannot reach the row element.

## Object-panel Overview rendering (descriptor-driven)

The object panel's Details → Overview is rendered from per-kind **descriptors**, not bespoke
per-kind components. To add or change a kind's overview, edit its descriptor — do not write a new
component.

This is frontend-owned presentation: the Wails-generated `*Details` DTO classes are the data
contract; the descriptors live in the view layer and DTO-field coverage is guarded by a runtime
drift-check (below), not by code-generating descriptors from the backend registry. Do not push
Overview/UI vocabulary into Go or try to codegen the descriptors — that tradeoff was evaluated and
deliberately rejected (the backend↔frontend loop is already closed at the generated DTO boundary).

- `Details/Overview/schema.ts` — descriptor types (`OverviewDescriptor`, ordered `items`:
  `field | status | widget`, dynamic `label`/`fullWidth`, `mono`, `showSelector`, `OverviewContext`)
  and `coverageKeys`.
- `Details/Overview/OverviewRenderer.tsx` — generic renderer; owns the frame (`ResourceHeader` top,
  `ResourceMetadata` bottom) and renders the descriptor's items in between. No per-kind logic.
- `Details/Overview/descriptors/<area>.tsx` — one `OverviewDescriptor` per kind. Reads the raw
  Wails-generated `*Details` DTO by key (`field: keyof DTO`); render fns for complex values and
  `{kind:'widget'}` for irreducible UI; panel-only values (hpaManaged, drain, cluster identity) come
  from the `OverviewContext` second arg, not hooks. Use a field's `hidden(dto)` predicate for
  quiet-filtering (hide empty rows; no layout jitter).
- `Details/Overview/descriptorRegistry.ts` — single source mapping kind → descriptor (production
  dispatch + drift-check). Register new kinds here.
- `Details/Overview/driftCheck.test.ts` — runtime guard: every field of `new DtoClass({})` must be
  accounted for by the descriptor (schema field / `derivedFrom` / status item / widget `consumes` /
  `coveredElsewhere`). A new backend DTO field fails this test by name until placed.
- `Details/Overview/registry.ts` — legacy fallback only: `GenericOverview` for custom/unregistered
  resources + per-kind action `getResourceCapabilities`.
- `Details/objectDetailModel.ts` — builds the single `activeDetail` (raw DTO) the renderer consumes,
  plus the derived sibling sections `DetailsTab` composes (Containers, RBAC rules, ConfigMap/Secret
  data, active pods, port-forward availability, scale replicas, CronJob suspend). Those derivations
  are **capability-gated per kind** via `DETAIL_KIND_CONFIG`, NOT inferred from DTO field presence:
  field names are overloaded across kinds (`rules` on Ingress/Webhook vs RBAC; `containers` on Job;
  `desiredReplicas` on HPA; `pods` on Node), so shape-inference would mis-derive. Add a new kind's
  derivations by declaring them in `DETAIL_KIND_CONFIG`; the four overload exclusions are locked by
  `objectDetailModel.test.ts`.

Parity for each kind lives in its `*Overview.test.tsx`, which renders
`OverviewRenderer(descriptor, dto)` directly.

## Placement Checklist

When adding frontend code:

1. Identify the owner, not just the closest import path.
2. Keep feature-specific state and UI in the feature module.
3. Put reusable rendering primitives in `shared` only if they are independent of
   module state.
4. Route backend reads through `dataAccess` or `appStateAccess`.
5. Use shared modal, keyboard, table, tab, and YAML editor primitives when the
   workflow matches their contracts.
6. Keep complete object refs and `clusterId` across navigation/action
   boundaries.

## Validation

Run targeted Vitest tests and `npm run typecheck --prefix frontend` for
frontend changes. Use browser/story validation for visual behavior when
appropriate.
