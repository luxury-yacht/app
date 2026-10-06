# Frontend Component Structure

Placement makes ownership obvious; dependencies flow from app infrastructure to
features to reusable building blocks.

## Directory Roles

| Directory | Owns |
| --- | --- |
| `core/` | App infrastructure, data brokers, refresh, capabilities, contexts, settings |
| `modules/` | User-facing feature workflows such as browse, namespace, object panel, object map |
| `ui/` | App shell: layout, navigation, settings, panels, modals, command palette, shortcuts |
| `shared/` | Reusable components, hooks, icons, actions, constants, and pure utilities |
| `styles/` | Global and shared CSS loaded by the app |

- `shared/` never depends on a feature module and holds rendering primitives
  only when they are independent of module state. Feature-local `hooks/`,
  `utils/`, and `types/` stay local; promote only when the dependency direction
  stays clean, and move cross-feature behavior down only once two real
  consumers need it.
- Feature code never bypasses the documented data-access, permission, refresh,
  keyboard, modal, table, tab, or YAML editor infrastructure.
- Cross-cluster comparison workflows live in `modules/global`. They may read
  multiple cluster-keyed states, but every refresh read and object/navigation
  reference keeps its originating `clusterId`. Cluster-only resource views stay
  in `modules/cluster`; never route Global views through the cluster resource
  manager.
- Cross-feature cluster runtime state lives in the React-free
  `core/cluster-workspace` store, which owns Wails runtime subscriptions.
  Contexts and hooks may select or adapt it but never mirror lifecycle, auth,
  health, scope revision, selection, or foreground serviceability in another
  map; feature code consumes its snapshot or a documented downstream wake-up
  event.

## Lazy Loading

Lazy loading preserves the loaded component's placement. Routes may use the
shared inline loading spinner. Portal-rendered panels and modals pass `null` as
the `withLazyBoundary` loading message so a pending module inserts no temporary
row into the app grid. Preserve import-error reporting; test pending and
resolved placement with a deferred module.

## Shared Transient Popups

- Shared dropdown menus render in a body-level portal so table, split-pane,
  modal, and docked-panel overflow cannot clip them or affect layout. The
  shared dropdown owns viewport placement, available-height constraints,
  scroll/resize repositioning, outside-click containment, and popup keyboard
  registration. Style a portaled menu through `dropdownClassName`, never a
  trigger ancestor.
- Every selectable dropdown uses the shared `Dropdown`, not a native
  `<select>`, styled only by `styles/components/dropdowns.css`. Consumers may
  size the trigger for their slot but never restyle trigger, menu, options, or
  group headers per feature. Group options with `group: 'header'` rows, not
  custom markup.
- A focusable body-level popup declares its owning popup ID, and a control in
  the owning modal references it with `aria-controls`. The modal focus trap
  uses that relationship to keep the popup interactive without admitting
  unrelated body content.

## Multi-select Dropdown Options

- Every multi-select `Dropdown` renders option content through
  `shared/components/dropdowns/Dropdown/DropdownFilterOption.tsx`: selection is
  a real checkbox decided in one place. `Dropdown` adds `dropdown-filter-menu`
  whenever `multiple` is set; consumers never pass it.
- Never hand-roll `.dropdown-filter-option` / `.dropdown-filter-box` markup
  (it was once duplicated seven times and drifted). A custom `renderOption`
  delegates to `DropdownFilterOption` with a rich `label` node.
- States: `on`, `off`, `required` (on and unchangeable; never explained with an
  extra word in the row). `plain` drops the control for action rows such as
  `Select all`. `dimWhenOff` is only for menus where "off" means absent from a
  view (the GridTable Columns menu); filter menus never set it, since most of
  their options are off by default.
- Trigger text comes from `multiSelectFilterTriggerLabel`
  (`shared/components/dropdowns/multiSelectFilterSelection.ts`): the bare label
  when everything is selected, else `Label (N)` including `Label (0)`, so an
  empty selection never looks unfiltered. Column-visibility menus keep their
  `Columns` text.
- Each multi-select row has an `only` shortcut (`enableOnlyAction`, default on)
  that collapses the selection to that option, revealed on hover or keyboard
  highlight and reachable via `Alt+Enter`. It is a click region inside the
  option button, not a nested `<button>`, which would be an invalid
  `role="listbox"` child and force every menu to `role="dialog"`. It never
  renders on disabled options or group headers, and is disabled (not hidden)
  when the option is already the sole selection so rows keep their shape. In
  the Columns menu it sits left of the anchored drag grip; never swap the grip
  out for it (that hides the drag affordance exactly while the pointer is on
  the row). Values that cannot be deselected (required columns) remain.
- Row-level behavior (drag-to-reorder, per-row affordances) uses `Dropdown`'s
  `getOptionRowProps`; `renderOptionActions` owns only the trailing slot.

## Object-panel Overview rendering (descriptor-driven)

Details → Overview renders from per-kind descriptors; edit a kind's descriptor
instead of writing a component. Wails-generated `*Details` DTO classes are the
data contract; descriptors are frontend view-layer code guarded by a runtime
drift check. Rejected: pushing Overview vocabulary into Go or codegenning
descriptors from the backend registry — the generated DTO boundary already
closes the backend↔frontend loop.

Files under `modules/object-panel/components/ObjectPanel/Details/`:

- `Overview/schema.ts` — `OverviewDescriptor` (ordered `items`:
  `field | status | widget`, dynamic `label`/`fullWidth`, `mono`,
  `showSelector`, `OverviewContext`) and `coverageKeys`.
- `Overview/OverviewRenderer.tsx` — generic renderer owning the frame
  (`ResourceHeader` top, `ResourceMetadata` bottom); no per-kind logic.
- `Overview/descriptors/<area>.tsx` — one descriptor per kind, reading the raw
  DTO by key (`field: keyof DTO`); render fns for complex values,
  `{kind:'widget'}` for irreducible UI. Panel-only values (hpaManaged, drain,
  cluster identity) come from the `OverviewContext` argument, not hooks. Use a
  field's `hidden(dto)` predicate to hide empty rows without layout jitter.
- `Overview/descriptorRegistry.ts` — single kind → descriptor map for dispatch
  and drift check; register new kinds here.
- `Overview/driftCheck.test.ts` — every field of `new DtoClass({})` must be
  covered (schema field, `derivedFrom`, status item, widget `consumes`, or
  `coveredElsewhere`); a new DTO field fails by name until placed.
- `Overview/GenericOverview.tsx` — fallback for custom/unregistered resources.
- `objectDetailModel.ts` — builds the single `activeDetail` (raw DTO) plus the
  sibling sections `DetailsTab` composes (Containers, RBAC rules,
  ConfigMap/Secret data, active pods, port-forward availability, scale
  replicas, CronJob suspend). These are capability-gated per kind via
  `DETAIL_KIND_CONFIG`, never inferred from field presence, because names are
  overloaded (`rules` on Ingress/Webhook vs RBAC, `containers` on Job,
  `desiredReplicas` on HPA, `pods` on Node); `objectDetailModel.test.ts` locks
  those four exclusions.

Per-kind parity lives in each `*Overview.test.tsx`, which renders
`OverviewRenderer(descriptor, dto)` directly.
