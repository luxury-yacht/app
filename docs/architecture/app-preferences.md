# App Preferences Contract

Settings schema, preference persistence, optimistic updates, and runtime
effects. App-state reads use `appStateAccess`
([data access](data-access.md#broker-choice)).

## Backend schema and mutation

- `backend.PreferencesService` owns persisted preferences and coalesced
  lazy-load state. Defaults, normalization, schema metadata, validation, Wails
  DTOs, and the six-route effect dispatcher stay aligned in
  `backend/preferences_settings.go`.
- `GetAppSettingsSchema` owns defaults, current values, bounds, enum options,
  validation hints, and runtime-effect flags. It covers every preference
  `UpdateAppPreferences` accepts but no separate state such as selected
  kubeconfigs or saved themes.
- `UpdateAppPreferences` validates the whole batch before mutating, persists
  normalized settings before runtime effects, and rejects the whole batch on
  validation or persistence failure. It returns normalized settings and changed
  keys; change that shape only when a workflow requires it.
- No preference-specific compatibility setters. A separate workflow needs a
  justified command contract reusing the common validation, persistence, and
  effect machinery.
- Persisted object-panel position and layout defaults belong to the backend
  settings contract, not frontend hydration fallbacks.
- Regenerate Wails bindings when settings DTOs, schema fields, or response
  shapes change.

## Frontend metadata and rollback

- Hydrate with `readAppSettingsSchema` via `appStateAccess`; mutate through the
  common `UpdateAppPreferences` optimistic path. Typed getters/setters live in
  `frontend/src/core/settings`; UI never imports preference-specific generated
  setters.
- `frontend/src/core/settings/appPreferences.ts` owns metadata caching, fallback
  metadata, and typed helpers. Settings sections read defaults, bounds, options,
  hints, and runtime flags only through them, never fetching schema or copying
  backend constants. Fallback metadata serves first paint, Wails-less tests, and
  schema-load failure; it is not a second contract.
- One confirmed base plus ordered pending edits owns optimistic state. Writes
  and success notifications run in edit order. Failure removes only the failed
  edit; later edits stay visible, even for the same key. Cache values,
  preference events, and the appearance-mode and appearance-bootstrap
  localStorage follow that projection; restore the exact prior startup mirror
  when its owning edit fails.
- Hydration waits for pending writes and publishes schema/settings only if no
  edit or newer forced refresh invalidated the read. A native change callback
  starts hydration without awaiting it, so notification delivery can finish the
  write hydration waits on.
- Mounted controls subscribe to the owner and read its value; no second
  component-local rollback after a persistence failure.
- Transient component state and state needed before Wails is available stay
  frontend-owned (last Settings tab, first-paint appearance caches); Settings
  displaying a value is no reason to move it to the backend.
- Runtime-effect flags are metadata for diagnostics and future UI; add
  user-facing runtime-effect copy only when a workflow calls for it.

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
  (shared across namespaces and clusters). Missing values mean collapsed.
- Manual disclosure and explicit navigation reveal both update the shared
  state; namespace row expansion is separate.
- The shared sidebar hook subscribes to preference changes, so hydration,
  sibling toggles, and rollback update mounted groups.

## Validation

Exercise schema coverage, whole-batch rejection, persistence before effects,
and frontend rollback for the changed preference; add load/retry and
independent effect failure when those paths change.
