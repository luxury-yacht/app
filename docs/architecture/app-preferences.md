# App Preferences Contract

Use this contract for settings schema, preference persistence, optimistic
updates, and runtime effects. App-state reads use `appStateAccess`; see
[data access](data-access.md#broker-choice) when changing the read boundary.

## Backend schema and mutation

- `backend.PreferencesService` owns persisted preferences and coalesced
  lazy-load state. Defaults, normalization, schema metadata, validation, Wails
  DTOs, and the six-route settings-effect dispatcher stay aligned in
  `backend/preferences_settings.go`.
- `GetAppSettingsSchema` owns defaults, current values, bounds, enum options,
  validation hints, and runtime-effect flags. Schema coverage must include every
  preference accepted by `UpdateAppPreferences`, without adding separate state
  such as selected kubeconfigs or saved themes.
- `UpdateAppPreferences` validates the whole batch before mutating settings,
  persists normalized settings before runtime effects, and rejects the whole
  batch on validation or persistence failure. It returns normalized settings and
  changed keys; change that response shape only when a workflow requires it.
- Do not add preference-specific compatibility setters. A separate workflow
  needs a justified command contract and must reuse the common validation,
  persistence, and effect machinery.
- Persisted object-panel position and layout defaults belong to the backend
  settings contract, not frontend-only hydration fallbacks.
- Regenerate Wails bindings when settings DTOs, schema fields, or response
  shapes change.

## Frontend metadata and rollback

- Hydrate with `readAppSettingsSchema` through `appStateAccess` and mutate through the
  common `UpdateAppPreferences` optimistic update path. Typed getters/setters
  live in `frontend/src/core/settings`; UI components must not import
  preference-specific generated setters.
- `frontend/src/core/settings/appPreferences.ts` owns metadata caching,
  fallback metadata, and typed helpers. Settings sections consume defaults,
  bounds, options, validation hints, and runtime flags through those helpers;
  they do not fetch schema directly or duplicate backend constants.
- Fallback metadata is for first paint, Wails-unavailable tests, or schema-load
  failure. It is not a second settings contract.
- One confirmed base plus ordered pending edits owns optimistic state. Backend
  writes and their success notifications run in edit order. Failure removes only
  the failed edit; later edits remain visible, including edits of the same key.
  Cache values, preference events, appearance mode localStorage, and appearance
  bootstrap localStorage follow that same projection. Restore the exact prior
  startup mirror when its owning edit fails.
- Hydration waits for pending writes and publishes schema/settings only if no
  edit or newer forced refresh invalidated the read. A native change callback
  starts hydration without awaiting it, so notification delivery can finish the
  write that hydration is waiting for.
- Mounted preference controls subscribe to the owner and read its current value.
  They must not apply a second component-local rollback after persistence fails.
- Transient component state and state needed before Wails is available stay
  frontend-owned, including the last Settings tab and first-paint appearance
  caches. Do not move state to the backend merely because Settings displays it.
- Runtime-effect flags are metadata for diagnostics and future UI decisions.
  Add user-facing runtime-effect copy only when the workflow calls for it.

## Loading and runtime effects

`PreferencesService` owns one coalesced lazy-load attempt. `EnsureLoaded`
surfaces a load error without installing state or dispatching effects;
`EnsureLoadedForStartup` joins that same attempt and may atomically install a
snapshot marked `startup-default`. Callers receive copied snapshots and never
hold the preferences mutex or invoke a raw settings loader.

A mutation captures its immutable snapshot and effect flags, persists under
the preferences lock, releases the lock, then dispatches through one stateless
six-route dispatcher to owner-shaped write-only sinks. Persistence failure
dispatches nothing. Sinks must not read preferences, call another effect owner,
or acquire a settings or refresh lock while holding a leaf-policy lock. Settings UI must
not call runtime owners directly.

| Setting effect | Target owner |
| --- | --- |
| Error-reporting enablement | `ErrorReportingService` |
| Kubernetes client QPS/burst | `ClusterRuntimeManager` |
| SSRR fetch concurrency | `PermissionFetchPolicy` |
| Per-scope container-log target limit | `ContainerLogsSelectionPolicy` |
| Global container-log target limit | `RefreshCoordinator` |
| Metrics refresh interval | `RefreshCoordinator` |

All six targets start with backend defaults. Successful load, startup-default
fallback, applicable update, and import publish the relevant values after the
Preferences lock is released. A target failure is reported without suppressing
independent targets; no target may reach back into Preferences.

## Sidebar expansion preferences

Sidebar Resources and Extensions expansion uses four global preferences:
one per group for Cluster and one per group for Namespaces. Cluster expansion
is shared across clusters; namespace expansion is shared across all namespaces
and clusters. Missing preferences default to collapsed. Both manual disclosure
and explicit navigation reveal update the shared state. Namespace row expansion
remains separate. The shared sidebar hook subscribes to preference changes, so
hydration, sibling toggles, and persistence rollback update mounted groups.

## Validation

Exercise schema coverage, whole-batch rejection, persistence before effects,
and frontend rollback for the changed preference. Include load/retry and
independent effect failure when those paths change. Finish with the root
validation gate.
