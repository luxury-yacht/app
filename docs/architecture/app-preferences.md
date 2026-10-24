# App Preferences Contract

Settings schema, preference persistence, optimistic updates, and runtime
effects. App-state reads use `appStateAccess`
([data access](data-access.md#broker-choice)).

## Backend schema and mutation

- `backend.PreferencesService` owns persisted preferences and coalesced
  lazy-load state.
- `backend/internal/preferenceschema` declares each preference once: its key,
  type, default, bounds, allowed values, and validation, plus the zoom bounds
  and the color pattern. It covers every preference `UpdateAppPreferences`
  accepts and no separate state (selected kubeconfigs, saved themes, window
  geometry); zoom keeps its own commands.
- Writes (update and import) use the schema's `Validate`; reads of
  `settings.json` use its `Repair`, so the backend stores and serves the values
  the UI shows. Type errors, unknown enums, and malformed colors reject a write;
  integers never reject. An option-list integer (page size) keeps only an exact
  option, else the default. A range integer applies its non-positive rule to the
  raw number, then truncates toward zero and clamps. Import validates before
  repair, so an unknown enum or malformed color still rejects it.
- Package `backend` binds each key to its `AppSettings` field, effect route,
  and change-log text (`preferences_settings_data.go`). The `settings.json`
  mapping lives in `preferences_settings.go`. Adding a preference is one schema
  row, one binding row, and that mapping; tests fail on a missing binding,
  field, or mapping.
- `UpdateAppPreferences` validates the whole batch before mutating, persists
  normalized settings before runtime effects, and rejects the whole batch on
  validation or persistence failure. It returns normalized settings and changed
  keys; change that shape only when a workflow requires it.
- No preference-specific compatibility setters. A separate workflow needs a
  justified command contract reusing the common validation, persistence, and
  effect machinery.
- Persisted object-panel position and layout defaults belong to the backend
  settings contract, not frontend hydration fallbacks.
- Regenerate Wails bindings when settings DTOs or response shapes change, and
  the frontend contract (`go generate ./backend`) when the schema changes;
  freshness tests fail otherwise.

## Frontend metadata and rollback

- Hydrate with `readAppSettings` via `appStateAccess`; mutate through the
  common `UpdateAppPreferences` optimistic path. The typed store and setters live
  in `frontend/src/core/settings`; UI never imports preference-specific generated
  setters.
- Read a preference by key through the store: `usePreference(key)` in
  components, `getPreference(key)` for reads at action time, and
  `subscribePreference(key, listener)` for non-React reactions. A subscriber
  hears only its own key's changes, with the new value, in declaration order;
  a throwing subscriber is reported and does not stop the others or the save.
  Mode- or scope-keyed selectors (`getPaletteTint`, `getAccentColor`,
  `getLinkColor`, `getSidebarGroupExpanded`, `getObjectPanelLayoutDefaults`)
  read the same store. No per-preference event-bus events or one-off hooks.
- `appPreferences.generated.ts` (from `backend/internal/genpreferences`) is the
  frontend's only copy of the schema: the `AppPreferences` type, the key order,
  and each key's spec. `appPreferences.ts` derives defaults and metadata from it
  and repairs values by the backend's rules; `appPreferences.parity.test.ts`
  runs the generated parity vectors. Settings sections read defaults, bounds,
  and options only through `getPreferenceMetadata` and
  `getIntegerPreferenceMetadata`, never copying backend constants.
- The Day.js timestamp format is the one deliberate difference: the frontend
  trims it and repairs an unsupported format to the default, while the backend
  keeps any non-empty format. Its tests are separate from the parity vectors.
- One confirmed base plus ordered pending edits owns optimistic state. Writes
  and success notifications run in edit order. Failure removes only the failed
  edit; later edits stay visible, even for the same key. Cache values,
  subscriber notifications, and the appearance-mode and appearance-bootstrap
  localStorage follow that projection; restore the exact prior startup mirror
  when its owning edit fails.
- Hydration waits for pending writes and publishes schema/settings only if no
  edit or newer forced refresh invalidated the read. A native change callback
  starts hydration without awaiting it, so notification delivery can finish the
  write hydration waits on.
- Mounted controls subscribe to the owner and read its value; no second
  component-local rollback after a persistence failure. A typed field keeps
  only a draft while the user types (`PreferenceNumberRow`).
- Appearance's palette, accent, and link controls are the deliberate exception:
  they keep live-preview drafts, and page styling re-reads those preferences only
  on a light/dark change or when a theme is applied, so a rollback or another
  window's change shows after either event or on restart.
- Transient component state and state needed before Wails is available stay
  frontend-owned (last Settings tab, first-paint appearance caches, and the
  `'system'` default in `frontend/index.html`'s inline script, which runs before
  any module loads); Settings displaying a value is no reason to move it to the
  backend.

## Loading and runtime effects

- `PreferencesService` owns one coalesced lazy-load attempt. `EnsureLoaded`
  surfaces a load error without installing state or dispatching effects;
  `EnsureLoadedForStartup` joins that attempt and alone may, after a load error,
  atomically install a `startup-default` snapshot. Callers get copied snapshots and never hold the
  preferences mutex or call a raw loader.
- A successful load reaches callers only after the mutex is released and the
  container-log limits and permission-fetch concurrency have been pushed.
- A mutation captures its immutable snapshot and effect flags, persists under
  the lock, releases it, then dispatches through one stateless six-route
  dispatcher to owner-shaped write-only sinks. Persistence failure dispatches
  nothing.
- Sinks never read preferences, call another effect owner, or take a settings
  or refresh lock while holding a leaf-policy lock. Settings UI never calls
  runtime owners directly.

| Setting effect | Target owner |
| --- | --- |
| Error-reporting enablement | `ErrorReportingService` |
| Kubernetes client QPS/burst | `ClusterRuntimeManager` |
| SSRR fetch concurrency | `PermissionFetchPolicy` |
| Per-scope container-log target limit | `ContainerLogsSelectionPolicy` |
| Global container-log target limit | `RefreshCoordinator` |
| Metrics refresh interval | `RefreshCoordinator` |

Targets start with backend defaults. Successful load, startup-default fallback,
applicable updates, and import publish values after the lock is released. A
target failure is reported without suppressing the others; no target reaches
back into Preferences.

## Sidebar expansion preferences

- Four global preferences drive Resources and Extensions expansion: one per
  group for Cluster (shared across clusters) and one per group for Namespaces
  (shared across namespaces and clusters). A missing Resources value means
  expanded (it holds the default namespace view); a missing Extensions value
  means collapsed. Saved values, which earlier versions always wrote, are kept.
- Manual disclosure and explicit navigation reveal both update the shared
  state; namespace row expansion is separate.
- The shared sidebar hook reads each group's preference with `usePreference`,
  so hydration, sibling toggles, and rollback update mounted groups.

## Validation

Exercise the schema and binding coverage tests, the per-key save/reload round
trip, the Go/TypeScript parity vectors, whole-batch rejection, persistence
before effects, and frontend rollback for the changed preference; add
load/retry and independent effect failure when those paths change.
