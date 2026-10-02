# Metrics History (object-panel Metrics tab)

Status: planning. Decisions recorded 2026-10-01. Before deleting this plan when
the work ships, move its durable rules into a new
`docs/architecture/metric-history.md` and index it in
[docs/README.md](../README.md).

Add a **Metrics** tab to the object panel for Pods, Nodes, Deployments,
StatefulSets, and DaemonSets. It shows timeline graphs read from an external
metrics source: Prometheus to start, with other stores possible later. The
app stores no long-term metrics history. When no source is assigned to the
cluster, or the source fails, the tab falls back to live metrics-server samples.
These are collected only while the panel is visible and are discarded when it
is hidden, so live data is never kept. The graph set is fixed, and users cannot add
or customize graphs. Users configure sources in Settings.

## Current state (verified 2026-10-01)

- **The app keeps no metrics history.**
  - The metrics-server poller replaces its usage maps on every successful
    poll (`backend/refresh/metrics/poller.go:387-397`).
  - It runs on demand and stops after an idle timeout
    (`backend/refresh/metrics/demand.go:236-258`).
  - Usage is joined onto served rows at read time and never stored
    ([resource-metrics.md](../architecture/resource-metrics.md)).
- **There is no Prometheus client and no charting library.**
  - "Prometheus" appears only as Prometheus Operator CRD browsing
    (`backend/resourcekind/family.go:28`).
  - The only graph dependencies are `@antv/g`/`@antv/g6`, used by the
    object map (`frontend/package.json:33-34`).
  - No date-time picker exists: a search of `frontend/src` for
    `datetime-local`, `DatePicker`, and `DateTimePicker` found none.
- **Live per-object metrics already exist.** `useResourceMetrics` leases the
  `pods`, `namespace-workloads`, or `nodes` scope for one object and returns
  CPU and memory with `usage`, `request`, `limit`, `capacity`, `allocatable`,
  and `freshness.collectedAt`.
  - Hook: `frontend/src/core/resource-metrics/useResourceMetrics.ts:61-109`.
  - Value types: `frontend/src/core/resource-metrics/types.ts`.
  - Pod, Node, Deployment, StatefulSet, and DaemonSet resolve to a domain;
    ReplicaSet is a detail exception, and Job and CronJob are unsupported
    (`frontend/src/core/resource-metrics/scope.ts:11-50`).
- **How tabs are built.**
  - Tabs are `TABS` entries gated by `onlyForKinds` or `requiresCapability`
    (`frontend/src/modules/object-panel/components/ObjectPanel/constants.ts:97-121`).
  - Their order is fixed (`.../ObjectPanel/hooks/useObjectPanelTabs.ts:49-60`),
    and number-key shortcuts follow that order (`:117-138`).
  - Logs and YAML stay mounted after their first visit. All other tabs unmount
    when the user switches away (`.../ObjectPanel/ObjectPanelContent.tsx:148-213, 393-451`).
- **Panel lifetime.**
  - Panels unmount when their cluster is not selected, but their state is kept
    per cluster.
  - Panel caches are freed only when the panel is actually removed. Each
    removal goes through `evictRemovedPanelCaches`, which already clears the
    per-panel `clearLogViewerPrefs` state
    (`frontend/src/modules/object-panel/contexts/ObjectPanelStateContext.tsx:38-113, 265-290`).
  - `panelId` encodes the cluster, group/version/kind, namespace, and name
    (`frontend/src/modules/object-panel/objectPanelRef.ts:148-152`).
- **On-demand read precedent: node logs.** The chain is:
  1. The frontend calls a reader in
     `frontend/src/core/data-access/readers.ts:81-88`.
  2. It reaches the `DesktopService` command
     (`backend/desktop_service.go:443-453`).
  3. `ResourceGateway` checks the `get nodes/proxy` permission, then calls the
     node service (`backend/node_logs.go:14-55`).
  4. The node service calls the kubelet through the API-server proxy with the
     cluster's REST client (`backend/resources/nodes/logs.go:38-62`).
  - Non-user `dataAccess` reads are blocked while auto-refresh is paused
    (`frontend/src/core/data-access/dataAccess.ts:25-34`).
- **Backend structure.**
  - `DesktopService` delegates each command to exactly one focused owner.
    Behavior and state live on that owner, and a persisted document lives with
    the owner of the invariant it protects
    ([backend-services.md](../architecture/backend-services.md#placing-new-behavior)).
  - Precedent for an owner that persists into settings.json:
    `ClusterAttentionService` persists through a repository interface
    implemented by `PreferencesService` (`backend/cluster_attention_service.go:19-32`,
    `backend/preferences_attention_repository.go`).
- **Settings persistence.**
  - settings.json has a per-cluster `clusters` map keyed by clusterId
    (`backend/preferences_settings.go:77, 94-103`).
  - The file is written world-readable, `0o644` (`backend/preferences_settings.go:580`).
  - No keyring or encryption code exists.
  - Settings export writes only preferences and kubeconfig search paths
    (`backend/data_management_import_export.go:30-36`).
- **Factory Reset.**
  - It calls each owner's `Reset`, then deletes the config and cache roots
    (`backend/data_management_coordinator.go:110-146`,
    `backend/static_app_state_cleaner.go:68-82`,
    `internal/appstate/manifest.go:36-38`).
- **Error reports.** Both frontend and backend Sentry scrubbers already strip
  URLs, hostnames, usernames, and common credentials
  ([error-reporting.md](../architecture/error-reporting.md#telemetry-cadence)).
- **clusterId.** It is `<kubeconfig basename>:<context>`
  (`backend/cluster_runtime_kubeconfig_selection.go:62-71`). Renaming the
  kubeconfig file or the context orphans per-cluster settings.

## Decisions (2026-10-01)

| Topic | Decision |
| --- | --- |
| Connection mode | The user explicitly chooses **in-cluster** or **external** per source in Settings. The app never auto-detects, suggests, or pre-selects a source. Both modes ship in the first release. |
| In-cluster target | Picked from the cluster's Services and ports, with nothing pre-selected. Optional scheme (http/https) and path prefix. |
| Secrets | AES-256-GCM encrypted values in the persistence files. The 32-byte key is generated on first need and stored in a `0600` key file in the config folder. Factory Reset deletes the key with the folder, and a new key is generated afterwards. Undecryptable values mean "credentials needed". |
| Source model | Named sources are defined once and assigned to clusters, each with an optional label filter. An in-cluster source can only be assigned to its own cluster. |
| Default source | One optional **default source** applies to every cluster without an explicit assignment. Only an external source can be the default. The default carries an optional **label-filter template** (e.g. `cluster="{context}"`) filled in with each cluster's kubeconfig context name. Any cluster can **override** the filter while still using the default. Each cluster's assignment has three states: use the default, a specific source, or explicitly **none** (live metrics only), which opts out of the default. |
| Fallback lifetime | Live collection starts when the Metrics tab shows live data. It continues while the panel stays visible, including while another tab in the same panel is shown. No backend history buffer. |
| Hidden panel | Collection stops and the samples are discarded when the panel is hidden: another panel is active in its dock group, its cluster isn't selected, it moved to another window, or it closed. An auto-refresh pause does the same. Revisiting starts a new chart with no gap. The tab must say clearly that live data is not kept. |
| Live-mode only | Live samples are collected only while the tab is showing live data, never as a standby while the source works. After a source failure the live chart starts at the failure. |
| Source failure | The whole tab switches to live data and shows a visible error naming the source and reason. It keeps retrying and switches back on recovery. Sources are never mixed on one screen. A metric the source lacks makes that graph "unavailable", not live. |
| Kinds | Pod, Node, Deployment, StatefulSet, DaemonSet. ReplicaSet, Job, and CronJob come later. |
| Pod graphs | CPU and memory (pod total, with a toggle to split by container), CPU throttling, network I/O, restarts, filesystem usage. |
| Workload graphs | CPU and memory summed across pods, replicas, plus the four Pod extras aggregated across pods (throttling averaged). No per-pod breakdown. |
| Node graphs | CPU and memory against allocatable, pods vs capacity, network I/O, filesystem usage, disk I/O. |
| Time range | Presets 15m / 1h / 6h / 24h / 7d plus a custom from/to range. The last preset is saved globally. Custom ranges apply to one panel and are moved between panels by copy/paste. |
| Settings UI | A new **Metrics** section in the Settings modal, laid out as **S-B · Master–detail** (chosen 2026-10-01 from Storybook variants S-A Themes-table / S-B Master–detail / S-C Cluster-first). The tab's empty and error states link to it. |
| Tab position | After Events. Only the YAML and Shell shortcuts shift. |
| External options | Basic auth or bearer token, custom headers, TLS (custom CA, opt-in skip-verify with a warning, client certificate and key). Cloud IAM auth is deferred behind a pluggable auth interface. |
| HTTP proxy | Not supported yet. External sources connect directly. |
| Header indicator | Unchanged. It stays metrics-server only. Source health shows in the tab and in Settings. |
| Tab layout | **B · Tiles + grid** (chosen 2026-10-01 from Storybook variants A Details-style / B Tiles + grid / C Focus + list). Two headline tiles on every kind, **CPU and memory only**, each showing the current value, the value against the limit or capacity, and the peak. They sit above a responsive grid of compact chart cards: one column in a right dock, 2–3 in a wide bottom dock. Each card has an inline click-to-hide legend. Restarts, replicas, and pods appear only as charts. |
| Chart library | **Recharts**: 3.10.1 was the stable release when decided; the 3.11 canaries' theming API is experimental. Chosen with the user after Storybook prototypes of ECharts 6.1.0 and Recharts 3.10.1. See "Chart component" for what the prototype established. |
| Export | Source definitions and assignments are exported **without** secrets. |
| Renamed clusters | Assignments stay keyed by clusterId, like other per-cluster settings. Settings → Metrics lists assignments whose cluster no longer exists as "cluster not found", with Reassign and Remove. |

## Design

### Ownership

- **New backend owner `MetricHistoryService`.** It holds:
  - the graph catalog;
  - the provider interface and the Prometheus provider;
  - source configuration, read and written through a repository interface
    implemented by `PreferencesService` (the `ClusterAttentionService`
    precedent);
  - the secret key and encryption;
  - per-source HTTP clients and probe caches.
- **Package layout.**
  - The owner lives in package `backend`, as the service-placement rules
    require.
  - The kind-independent pieces go in `backend/metrichistory`: the graph
    catalog, the provider interface, source resolution, and the request and
    response types.
  - The Prometheus provider goes in `backend/metrichistory/prometheus`. Its
    `testdata/` holds the Phase 0 fixtures.
- **New commands.** A thirteenth command interface on `DesktopService`. Update
  the owner tables in
  [backend-services.md](../architecture/backend-services.md#owner-map) and
  [data-access.md](../architecture/data-access.md#wails-command-boundary).
- **Collaborators.**
  - Cluster access uses a narrow `ResolveClusterDependencies` seam, like the
    `OperationsClusterAccess` interface `OperationsCoordinator` already uses
    (`backend/operations_coordinator.go:16-22`).
  - Permission checks use the existing `requireResourcePermission` evaluator
    (`backend/resource_permission.go:24-95`).
  - The owner never calls `RefreshCoordinator` or `ResourceGateway`.
- **Rationale.** The source definitions, secrets, and query clients share one
  invariant: a secret is decrypted only to authenticate a query for that source.
  `ResourceGateway` owns Kubernetes resource requests, and an external
  Prometheus is not one.
- **Factory Reset.** It calls `MetricHistoryService.Reset()` from
  `resetStoredOwners` (`backend/data_management_coordinator.go:127-146`). That
  drops the in-memory key, clients, and caches before the config root is
  deleted. Add the key file path to `internal/appstate/manifest.go`.

### Graph catalog (backend-authored)

- **One backend catalog defines every graph.** Each entry has:
  - a stable graph ID, title, and unit;
  - the kinds it applies to;
  - whether live data can feed it (only CPU and memory);
  - its role series (usage, request, limit, capacity, allocatable, desired,
    ready);
  - which metrics it requires;
  - a per-provider query template.
- **The frontend renders whatever the response describes.** It holds no graph
  list per kind. This follows the backend-authored pattern used for object
  actions ([permissions.md](../architecture/permissions.md#ui-permission-rules)).
- **Adding a store** means a new provider implementing the same graph IDs. No
  UI change is needed.

### Query contract

One command per tab refresh: `GetObjectMetricHistory(request)`.

- **Request:**
  - full object identity: `clusterId`, group, version, kind, namespace, name;
  - a preset or an absolute range;
  - whether the CPU/memory charts are split by container.
- **Response:**
  - `mode: source | live`, plus a `liveReason`: no source assigned, or the
    source error;
  - the source ID and name;
  - one shared **grid** (`startMs`, `stepMs`, `count`). Every series is a
    `values` array of `count` nullable numbers on that grid, and `null` is a
    gap, distinct from a real zero (`backend/metrichistory/types.go`). This is
    more compact than `[timestamp, value]` pairs, and gaps need no inference.
  - for each graph: its ID, unit, status (`ok`, `noData`, or `unavailable` with
    a reason), and role-tagged series. Units follow the live contract: CPU in
    **millicores**, memory in **bytes**.
  - Graph titles are presentation and live in the frontend, keyed by graph ID.
    The set and order of graphs per kind still comes from the backend.
  - In `live` mode the response still carries the graphs, and the frontend
    fills the live-capable ones from its live buffer.
- **Step and window** (open item 2, decided in Phase 1 slice 1;
  `backend/metrichistory/timerange.go`).
  - The step is the smallest multiple of 15 s that keeps a range within 300
    steps: 15m → 15s, 1h → 15s, 6h → 75s, 24h → 300s, 7d → 2025s.
  - The grid's last point is "now", so the tiles' current value is current.
  - The `rate()` window is `max(step + 30s, 4 × 30s)`, using an assumed 30 s
    scrape interval. That is the Prometheus default; kube-prometheus-stack
    scrapes cAdvisor every 10 s and everything else every 30 s (verified in
    Phase 0).
  - A per-source scrape-interval setting is deferred until an install with a
    slower scrape needs one.
- **Running the queries.**
  - The backend runs one command's graph queries concurrently, with a per-source
    limit on in-flight queries and a timeout for each query.
  - A label filter is rendered as escaped PromQL matchers. Label names are
    validated against Prometheus's label-name syntax at save time.

### Sources and transports

- **In-cluster.**
  - The source is defined by namespace, Service, port, scheme, and path prefix,
    and belongs to exactly one cluster.
  - Queries go through the API-server Service proxy
    (`/api/v1/namespaces/<ns>/services/<scheme>:<name>:<port>/proxy/<prefix>/api/v1/query_range`).
    They use the cluster's REST client, as node logs do. That client already
    carries kubeconfig auth, rate limits, and auth recovery.
  - Every query first checks `get services/proxy` on that Service. A denial is a
    source failure: the tab falls back to live data and the error names the
    missing permission ([permissions.md](../architecture/permissions.md#agent-contract):
    permission-denied state is data).
- **External.**
  - The source is a URL plus basic auth or a bearer token, custom headers, and
    TLS options.
  - Its HTTP transport sets `Proxy: nil`. Without that, Go's default transport
    would honor `HTTPS_PROXY` only when the app is launched from a terminal.
- **Test connection.** Settings can test a source:
  - check reachability, authentication, and the Prometheus API;
  - for in-cluster sources, check the `services/proxy` permission;
  - from Phase 4, report which graph metrics the source has.
- **Probe cache.** Which metrics exist is cached per source and label filter,
  and rebuilt when the source or assignment changes. Graphs whose required
  metrics are absent return `unavailable: <metric> not found`.

### Source resolution (default source)

- **One backend function decides a cluster's effective source and filter.**
  Every query and every Settings display uses it, so the tab and Settings can
  never disagree.
  1. If the cluster has an explicit assignment:
     - a specific source → that source, with its label filter;
     - **none** → no source (live data), even when a default exists.
  2. If it has no assignment and a default source is set → the default, with
     the filter from rule 3.
  3. Filter for the default: the cluster's override if it has one, otherwise
     the default's template rendered with the kubeconfig context name. No
     template means no filter.
  4. Otherwise → no source (live data).
- **The assignment state is a tagged union:** `default` (optionally with a
  filter override), `source` (with a filter), or `none`. Never a nullable
  source ID plus flags, so "explicitly none" and "not set" cannot be confused
  ([make impossible states impossible](../../.agents/skills/make-impossible-states-impossible/SKILL.md)).
- **The default must be an external source.** Settings refuses an in-cluster
  source as the default, because it lives in one cluster. Deleting the source
  that is the default also clears the default; Settings shows what that will
  affect before confirming.
- **Template rendering.** Substituted values are escaped like any other label
  value, and the rendered filter is validated before use.
  - **[assumed]** `{context}` is the only placeholder for now. Whether the
    kubeconfig cluster-entry name is also needed is open item 8.
- **The Metrics tab's source badge** says when the source came from the
  default, e.g. "Prometheus · prod-thanos (default)".

### Secrets

- **Which fields are secret:** passwords, bearer tokens, header values, and the
  client key.
- **How they are stored.**
  - Each value is stored in settings.json as a versioned envelope:
    `{v, nonce, ciphertext}`, base64-encoded.
  - The source ID and field name are bound as additional authenticated data, so
    ciphertexts cannot be swapped between fields or sources.
- **The key.** The key file is created once (`0600`) under the owner lock. If
  the key is missing or decryption fails, the field reads as "credentials
  needed", and saving a new value re-encrypts it under the current key.
- **The frontend never receives secret values.**
  - A source DTO reports only `has<Field>` flags.
  - An edit sends each secret as `unchanged`, `set(value)`, or `clear`.
- **Expected protection.** This guards against accidental disclosure and other
  local accounts. It does not guard against malware or anyone running as the
  same user. Kubeconfig credentials already have the same exposure.

### Metrics tab (frontend)

- **Registration.**
  - Add `'metrics'` to `ViewType` (`.../ObjectPanel/types.ts:131-141`).
  - Add a `TABS.METRICS` entry placed after `TABS.EVENTS`. Phase 1 registers it
    with `onlyForKinds: ['pod']`; Phase 4 adds `node`, `deployment`,
    `statefulset`, and `daemonset`.
  - Phase 4 also updates the hard-coded labels in
    `frontend/src/shared/components/tabs/ObjectPanelTabsPreview.stories.tsx`,
    which preview a Deployment.
- **Kept mounted.**
  - It follows the Logs/YAML pattern: mounted on first visit, then hidden with
    `inert` and `aria-hidden`.
  - Live collection therefore continues while another tab in the panel is
    visible.
  - It does not go in the `transientTabs` table, which must hold only tabs that
    unmount (`ObjectPanelContent.tsx:215-216`).
  - Logs, YAML, and Metrics share one retained frame (`RetainedTabFrame` and
    `useShownOnce` in `ObjectPanelContent.tsx`, slice 3).
- **Reads.**
  - Add a typed reader in `frontend/src/core/data-access/readers.ts`; the
    command goes on the explicit allowlist in
    `frontend/src/core/backend-api/index.ts`.
  - Request reasons:
    - activation: `foreground`;
    - a range or toggle change: `user`;
    - scheduled re-query: `background`, which is blocked while auto-refresh is
      paused.
  - Results from superseded requests are dropped, as in node logs.
- **Re-query cadence.** Preset ranges re-query on a step-derived interval while
  the tab is visible in the active panel. **Decided in slice 3:** the interval is
  the grid step clamped to 30 s–5 min (15m/1h → 30 s, 6h → 75 s, 24h and 7d →
  5 min). Live mode has no grid and retries the source every 30 s.
  - Re-queries run through a registered per-panel refresher, using
    `refreshManager.register` and `useRefreshWatcher` as
    `.../ObjectPanel/hooks/useObjectPanelRefresh.ts:122-155` does. A component
    timer is not allowed: `frontend/AGENTS.md` forbids ad-hoc polling loops.
  - This also gives manual refresh (`user`) and abort signals. A custom range whose end is in the
  past is never re-queried. In `live` mode the same cadence retries the source,
  and the tab switches back when the source recovers.
- **Chart component (Recharts).**
  - It lives with the tab, and moves to `shared/` only when a second consumer
    exists ([component-structure.md](../frontend/component-structure.md#agent-contract)).
  - Each chart gets a text summary for accessibility.
  - Each graph shows its own `noData` or `unavailable` state.
  - **Prototype findings, 2026-10-01.** Exercised in the Chromium browser
    pane, with one check in WebKit. Use these as starting points:
    - **Colors.** Pass theme tokens as `var(--…)` strings straight into SVG
      `stroke` and `fill`. Light and dark need no JavaScript.
      - A Quick Look render (system WebKit [assumed]) honored `var()` in
        `stroke`, `fill`, and `fill-opacity` attributes.
      - Re-check in the running app during Phase 1.
      - The series palette needs new chart tokens in both appearance modes,
        validated as the dataviz guidance requires. Today's tokens have only
        the accent ramps and the base grays.
    - **Shared crosshair.** `syncId` with `syncMethod="value"` across the
      tab's charts.
    - **Drag to zoom.**
      - Our own `onMouseDown`, `onMouseMove`, and `onMouseUp` handlers read
        `activeLabel` from `MouseHandlerDataParam`.
      - A `ReferenceArea` shows the selection.
      - The selection sets the panel's custom range.
    - **Legend toggles.** `Legend` `onClick` plus `Line` `hide`.
      - Override the defaults: set `itemSorter` to keep catalog order, and draw
        legend text in text tokens rather than the series color.
      - Decide whether a toggle applies to one chart or to all charts in the
        tab. Recharts does neither automatically.
    - **Time ticks.** Recharts generates no round time ticks for a numeric time
      axis, so we supply them. At short ranges, tooltips need seconds.
    - **Axis labels** use compact units (`750M`, `1.2G`, `19%`, `2.4M/s`).
      Full units like "750 MiB" wrap in a 48px axis. Tiles, legends, and
      tooltips keep full units.
    - **A graph the source lacks** keeps its card, with a dashed
      "Unavailable — <metric> not found in <source>" placeholder at the
      chart's height, so the grid doesn't reflow.
    - **Tooltip.** A React component styled with our CSS classes, not inline
      styles.
    - **Size.** The parts used came to 111 KB min+gzip (esbuild, React
      external). The tab is lazy-loaded.
    - **Tests.** SVG is in the DOM and testable with Testing Library.
      `ResponsiveContainer` needs a set size under jsdom [assumed]; confirm
      this with the first test.
    - **Hidden tabs keep their size.** A hidden kept-mounted tab uses
      `visibility: hidden` (`.../ObjectPanel/ObjectPanel.css:50-54`), so charts
      keep their dimensions while hidden.
- **Around the charts:**
  - a source badge, for example "Prometheus · prod-thanos" or "Live ·
    metrics-server since 14:02";
  - an error banner in fallback mode;
  - the range picker, hidden in live mode;
  - the per-container toggle, on Pod CPU and memory in source mode only;
  - an empty state with a link to Settings → Metrics. Native panel windows have
    no Settings modal (`PanelWindowApp.tsx`), so there the empty state names
    the main window instead of showing a button.

### Live fallback

- **Where samples come from.** A collector hook (`useLiveMetricSamples`) reads
  `useResourceMetrics` for the panel's object. It appends `{collectedAt, cpu,
  memory}` only when `freshness.collectedAt` (unix seconds) advances, so there
  are no duplicate samples. The poller's default interval is 5 s.
- **Which graphs.** Live responses still carry the kind's graph catalog
  (`backend/metrichistory/catalog.go`) with status `live` and no series. The
  tab fills the graphs live metrics can supply (CPU and memory) and shows the
  rest as "Not available from live metrics".
- **Reference lines.** Request, limit, and allocatable lines come from the same
  values (`frontend/src/core/resource-metrics/types.ts`).
- **Where samples are kept.** In the kept-mounted tab's own component state. No
  store outside the component and no eviction hook are needed, because the data
  is never meant to outlive a visit.
- **When the buffer resets.**
  - It is cleared and collection stops (the `useResourceMetrics` lease is
    disabled) in two cases:
    - the panel stops being the active panel in its dock group, i.e.
      `isPanelOpen` becomes false (`isActiveTab`,
      `.../ObjectPanel/ObjectPanel.tsx:82-85, 334`);
    - automatic refresh is paused (`useAutoRefreshEnabled`,
      `frontend/src/core/refresh/hooks/useRefreshPreferences.ts:10-11`).
  - A cluster switch, a move to another window, or closing the panel all unmount
    the tab, which drops the state the same way.
  - Becoming visible again starts a new, empty chart. The chart never draws a
    gap: re-enabling paints the scope's retained data first, so a sample more
    than 30 s older than the start of collection is ignored.
- **Kept while visible.** Switching to another tab within a visible panel keeps
  the samples, because the tab stays mounted.
- **Only in live mode.** Collection runs only while the tab is in `live` mode,
  never as a standby buffer while the source works. That would hold a metrics
  lease for data nobody is looking at
  ([data-freshness.md](../architecture/data-freshness.md#retention-and-leases)).
- **Size.** Bounded to about 1 hour of samples, at metrics-server's sample
  timestamps.
- **Saying so in the UI.** The live badge reads "Live · since 14:02" next to
  "Not kept: cleared when you leave this panel." Without a source, a notice
  links to Settings → Metrics; with a failing source, the error banner says live
  metrics are shown. While auto-refresh is paused the tab says live metrics
  stop. Before the first sample it shows "Collecting live metrics…", or the
  live-metrics error.

### Settings → Metrics

- **Registration.** Add a `'metrics'` id to `SettingsTabId` and `VALID_TABS`
  (`frontend/src/ui/settings/settingsTabPreference.ts:9-27`), plus a `TABS`
  entry with an icon (`frontend/src/ui/modals/SettingsModal.tsx:63-71`).
- **Layout: S-B · Master–detail.**
  - **Sources:** a source list with status dots and a "Default" marker, beside
    a large editor for the selected source (add, edit, delete, Test
    connection, and "Used by" clusters).
  - **Default source:** a picker listing only external sources, plus the
    label-filter template field. It sits above the source list.
  - **Cluster assignments:** a full-width table below.
    - The source picker offers "Default (<name>)", each source, and
      "None — live metrics only".
    - With the default selected, the filter column shows the rendered template
      as a placeholder, and typing in it overrides the filter for that cluster.
    - Assignments whose clusterId matches no kubeconfig context show as
      "cluster not found", with Reassign and Remove. This happens when a
      kubeconfig file or context is renamed, because clusterId is
      `<basename>:<context>`.
- **Reads and typed wrappers.** Reads go through `appStateAccess`; typed
  wrappers live in `frontend/src/core/settings/`
  ([data-access.md](../architecture/data-access.md#broker-choice)).
- **The in-cluster Service picker** lists Services from the object catalog,
  which owns object existence ([catalog.md](../architecture/catalog.md#agent-contract)).
  Ports come from the existing `GetTargetPorts` read used by
  `frontend/src/modules/port-forward/PortForwardModal.tsx`. The cluster must be
  connected; otherwise the picker says so.
- **The last preset** is a new app preference row
  (`backend/preferences_settings_data.go:164-312`), following
  [app-preferences.md](../architecture/app-preferences.md).

### Export, import, Factory Reset

- **Export.** Add source definitions, assignments, and the default source with
  its template to `settingsDataFile`, with all secret fields omitted.
- **Import.** Imported sources show "credentials needed" (import semantics are
  open item 6).
- **Factory Reset.** It resets the owner, then deletes the key file along with
  the config root. The next secret save generates a new key.

## Verified queries (Phase 0)

These were verified 2026-10-01 against kube-prometheus-stack 91.8.2 and
Prometheus 3.15.0 on Kind (Kubernetes 1.37), through the in-cluster
Service-proxy route. Every query is captured verbatim in
[the fixtures](../../backend/metrichistory/prometheus/testdata/kube-prometheus-stack/README.md),
whose `manifest.json` lists them.

The table uses shorthand:
- `<P>` is `namespace="…",pod="…"`.
- `<J>` is `* on(instance) group_left(nodename) node_uname_info{nodename="<node>"}`.
- `<W>` is `max by (namespace, pod) (kube_pod_owner{owner_kind="ReplicaSet"} * on(namespace, owner_name) group_left() max by (namespace, owner_name) (label_replace(kube_replicaset_owner{owner_kind="Deployment",owner_name="<name>"}, "owner_name", "$1", "replicaset", "(.*)")))`.

| Graph | Query (fixture file) |
| --- | --- |
| Pod CPU | `sum by (container) (rate(container_cpu_usage_seconds_total{<P>,container!=""}[2m]))` (`pod_cpu_by_container`) |
| Pod memory | `sum by (container) (container_memory_working_set_bytes{<P>,container!=""})` (`pod_memory_by_container`) |
| Requests / limits | `sum by (resource) (kube_pod_container_resource_requests{<P>})` and `_limits`; CPU in cores, memory in bytes (`pod_requests`, `pod_limits`) |
| CPU throttling | `sum(rate(container_cpu_cfs_throttled_periods_total{<P>,container!=""}[2m])) / sum(rate(container_cpu_cfs_periods_total{…}[2m]))` (`pod_throttling_ratio`) |
| Network I/O | `sum(rate(container_network_{receive,transmit}_bytes_total{<P>}[2m]))`; pod level only (`pod_network_*`) |
| Restarts | `sum(kube_pod_container_status_restarts_total{<P>})`, cumulative (`pod_restarts`) |
| Pod filesystem | **No series on containerd-based Kind.** `container_fs_usage_bytes` is empty (`pod_filesystem_absent`). See open item 9. |
| Workload CPU / memory | usage `* on(namespace, pod) group_left() <W>`. It matched the `namespace_workload_pod:kube_pod_owner:relabel` recording rule at every point (`workload_cpu_owner_join`, `workload_cpu_recording_rule`, `workload_memory_owner_join`). |
| Replicas | `kube_deployment_spec_replicas`, `kube_deployment_status_replicas_ready`, `kube_deployment_status_replicas_updated`, filtered by the `deployment` label (`workload_replicas_*`) |
| Node CPU | `sum(rate(node_cpu_seconds_total{mode!~"idle\|iowait\|steal"}[2m]) <J>)` (`node_cpu_used_cores`) |
| Node memory | `sum((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) <J>)` (`node_memory_used_bytes`) |
| Allocatable / capacity | `sum by (resource) (kube_node_status_allocatable{node="…",resource=~"cpu\|memory\|pods"})` and `_capacity` (`node_allocatable`, `node_capacity`) |
| Pods vs capacity | `count(kube_pod_info{node="…"})` against capacity `pods` (`node_pods_running`) |
| Node filesystem | Used bytes by mountpoint, excluding tmpfs and overlay. **Kind has no `/` mount** (`node_filesystem_by_mountpoint`). See open item 9. |
| Node network / disk | `sum(rate(node_network_{receive,transmit}_bytes_total{device!~"lo\|veth.*"}[2m]) <J>)`, `sum(rate(node_disk_{read,written}_bytes_total[2m]) <J>)` |

Rules every query follows:

- **Join on object labels, never on target labels.** On kube-state-metrics
  object metrics (ReplicaSet, Deployment, Node), the `pod`, `container`, and
  `namespace` labels describe the kube-state-metrics pod itself. Join on
  `replicaset`, `deployment`, and `node` instead.
- **Use the raw owner join `<W>`, not the recording rule.** The kube-prometheus
  recording rules exist only with that stack.
- **node-exporter has no `node` label.** Always join through
  `node_uname_info`. The kubelet exposes no root-cgroup (`id="/"`) series to
  use instead.
- **The in-cluster transport must decode error bodies itself.** A bad query
  returns HTTP 400 with Prometheus' JSON body, relayed unchanged by the
  API-server proxy (`error_bad_data`). `kubectl` hides that body behind a
  generic message, so the transport has to read it from the raw response.
- **Kind node numbers describe the shared Docker VM, not one node.** The
  fixtures are for parsing and query shape, not for realistic node values.

## Phases

Each phase ends with:

- an impact-analysis entry before production edits;
- red/green TDD;
- 80% statement coverage on changed code;
- cognitive complexity of 12 or less;
- `mise exec -- wails3 task qc:prerelease`;
- a check in the real app.

0. **Groundwork**
   - ~~Choose the chart library~~ **Done 2026-10-01: Recharts**, chosen with
     the user after Storybook prototypes. Added in Phase 1 slice 3 as
     `recharts ^3.10.1` (still the latest stable; 3.10.0/3.10.1 release notes
     list no breaking changes) together with `react-is ^19.3.0`, because the
     Recharts README requires `react-is` to match the installed React, and the
     hoisted copy was 17.0.2 (from `pretty-format`).
   - ~~Storybook layout variants~~ **Done 2026-10-01**: tab layout B (Tiles
     + grid, CPU and memory tiles only) and Settings S-B (Master–detail with
     the default source). The prototypes were deleted after the picks; their
     findings are recorded above.
   - ~~`--prometheus` flag~~ **Done 2026-10-01**: `test/kind/workloads.sh`
     installs kube-prometheus-stack, tested test-first in
     `test/kind/scripts_test.go` and documented in
     [kind-clusters.md](../workflows/kind-clusters.md).
   - ~~Capture fixtures~~ **Done 2026-10-01**: 29 files in
     `backend/metrichistory/prometheus/testdata/kube-prometheus-stack/`. See
     "Verified queries" above.
1. **Tracer bullet: Pod CPU and memory over in-cluster** — **Done 2026-10-01** (see the completion record below).
   - Backend: `MetricHistoryService`, the graph catalog with two entries, the
     Prometheus provider, the in-cluster transport with its permission check,
     persistence for sources and assignments (no secrets yet), and the command
     with regenerated bindings.
   - Frontend: a minimal Settings section (in-cluster source and assignment),
     and the Metrics tab for Pods with presets, the source badge, and error
     states.
   - Tests:
     - PromQL rendering, including label escaping;
     - fixture parsing;
     - the step calculation;
     - a permission denial;
     - clusterId isolation;
     - tab gating by kind.
2. **Live fallback** — **Done 2026-10-01** (see the Phase 2 record below).
   - The kept-mounted tab, the in-component live buffer and its reset rules,
     mode switching, retry and recovery, and the "not kept" messaging.
   - Tests:
     - samples survive a tab switch within the visible panel;
     - the buffer resets and collection stops when the panel becomes inactive
       in its dock group, on a cluster switch, and on an auto-refresh pause;
     - revisiting starts an empty chart, with no gap;
     - no samples are collected in `source` mode;
     - the tab switches to live data when the source fails and back on
       recovery.
3. **External sources and secrets**
   - The key file, the encryption envelope, and write-only secret DTOs.
   - The HTTP transport with auth, headers, and TLS.
   - Test connection for external sources (in-cluster Test connection shipped
     in Phase 1 slice 3).
   - The default source: the setting, the template, per-cluster overrides, the
     three-state assignment, and the resolution function.
   - Export without secrets, and the Factory Reset hook.
   - Tests:
     - resolution order: an explicit source beats the default, explicit none
       beats the default, and unassigned uses the default;
     - template rendering with escaping, and an override replacing the
       template;
     - an in-cluster source is rejected as the default;
     - deleting the default source clears the default;
     - encryption round trip;
     - a missing or rotated key gives "credentials needed";
     - additional-data binding rejects swapped ciphertexts;
     - the export contains no secret;
     - a reset regenerates the key;
     - URLs and credentials are scrubbed from Sentry events.
4. **Full graph set and remaining kinds**
   - Register the Metrics tab for nodes and workloads (see "Registration").
   - Pod extras and the per-container toggle.
   - Click-to-hide legends, and chart palette tokens for multi-series charts in
     both appearance modes (Phase 1's usage/request/limit lines use the
     existing accent, warning, and error tokens).
   - Workload aggregation, with the ownership query covering rollouts.
   - Node graphs, with the node-identity join.
   - Probing for which metrics exist, and `unavailable` per graph.
   - Fixtures from both kube-prometheus-stack and a plain `prometheus` chart
     install, to exercise label differences.
5. **Custom time ranges**
   - Remember the last preset globally (Phase 1 starts every tab at 1h).
   - A date-time range picker, and drag-to-zoom setting it.
   - Copy and paste ranges as ISO 8601 intervals with offsets, e.g.
     `2026-10-01T14:00:00-04:00/2026-10-01T16:00:00-04:00`. Reuse the existing
     clipboard path (`frontend/src/ui/shortcuts/components/TextContextMenu.tsx`).
   - Charts display in local time.
6. **Durable contract and cleanup**
   - Write `docs/architecture/metric-history.md` and index it.
   - Link it from [resource-metrics.md](../architecture/resource-metrics.md).
   - Add a release-notes fragment in
     [pending.md](../release/pending.md).
   - **Prune the Phase 0 fixtures.**
     - Delete every file in
       `backend/metrichistory/prometheus/testdata/kube-prometheus-stack/` that
       no test reads, and remove its `manifest.json` entry.
     - `workload_cpu_recording_rule.json` is evidence only, so it goes once
       the owner-join finding is in the architecture doc.
     - Move the README's durable findings into that doc, then trim the README
       to provenance and reproduction steps.
   - Delete this plan.

## Phase 1 progress (completion record)

Phase 1 is built as vertical slices, each passing `qc:prerelease`:

| Slice | Scope | Status | Evidence |
| --- | --- | --- | --- |
| 1 · Provider core | Grid and step, rate window, Pod PromQL, response decoding, Pod graph assembly (`backend/metrichistory/…`) | passed | 14 tests against the Phase 0 fixtures. Mutation checks (escaping, unit scale, NaN) each turned the suite red. 93.1% combined coverage. gocognit ≤ 10. `qc:prerelease` exit 0 (2026-10-01). |
| 2 · Sources end to end | Backend: `MetricHistoryService` (5 commands: source CRUD, three-state cluster assignment, Service candidates from the catalog), repository on `PreferencesService`, bindings, allowlist. Frontend: Settings → Metrics (S-B: source list + in-cluster editor with Cluster → Namespace → Service → Port pickers, nothing pre-selected; assignment list of every kubeconfig context + orphans with Remove; filter) | passed | Backend: 11 owner tests (real `PreferencesService` + settings file), contract tests updated first; mutation checks (section pruning, in-cluster rule, edit path, unknown ID) all red. Frontend: 10 section/wrapper tests + Settings tab registration; mutation checks (in-cluster option disabled; `'user'` read reason) red. gocognit ≤ 10; Biome complexity ≤ 12 (control run active). `qc:prerelease` exit 0 (2026-10-01) after fixing the error-reporting boundary (backend failures render operationally; duplicate names validated locally). **Not yet exercised in the real app** (planned for slice 4). |
| 3 · History end to end | In-cluster Service-proxy transport with the `services/proxy` check, `GetObjectMetricHistory`, Test connection, plus the Pod Metrics tab (Recharts, layout B, presets, source chip, error and empty states, refresher re-query) | passed | Backend: 2 more commands (contract counts 7 / 120 updated first). Transport tests over `rest/fake`: proxy path and params, Prometheus error bodies kept for decoding, API-server Status messages surfaced as typed errors (client-go `DoRaw` drops them for JSON replies). Owner tests against the Phase 0 fixtures: Pod CPU/memory from the assigned source, no source makes no cluster request, another cluster's in-cluster source never serves, permission denial stops before any query, proxy/Prometheus/permission failures become `sourceError`, `TestMetricSource` version and failure. 93.6% statement coverage of the changed Go files; gocognit ≤ 11. Frontend: Recharts 3.10.1 + `react-is` 19.3.0. Pod Metrics tab (retained like YAML), per-panel refresher with step-derived cadence, superseded answers dropped, Settings link, and Test connection in the source editor. 23 new or updated tests; 92.7% statement coverage of the tab and editor files; Biome complexity ≤ 12 (control run active; the editor went from 14 to ≤ 12). Mutation checks (6 backend, 13 frontend) each turned the suite red. Found and fixed: native panel windows have no Settings modal, so the empty state there names the main window instead of offering a button. `qc:prerelease` exit 0 (2026-10-01, second run; the first failed lint on a new test's stub). Real app: Pod metrics appear (user-verified, see slice 4). |
| 4 · Validation | Real app against Kind Prometheus; coverage and complexity | passed | **Verified by the user in the real app on the Kind cluster (2026-10-01):** the Pod Metrics tab shows metrics from Prometheus (this needs a saved source and an assignment for the cluster, `resolveMetricSource` in `backend/metric_history_queries.go`); the no-source empty state; Test connection; range presets switch (the cluster had about 8 hours of data, so 24h and 7d showed only that span); chart colors in light and dark. The user then reported the remaining checks good: the detached-panel-window empty state, source-error state and recovery, the 30 s re-query at 1h, and behavior while auto-refresh is paused. Coverage and complexity were measured in slice 3. |

Re-sliced 2026-10-01. A backend command must land together with its first
frontend consumer: `cmd/project` binding-parity requires every generated
command in `frontend/src/core/backend-api/index.ts`, and knip rejects unused
exports.

## Phase 2 progress (completion record)

| Scope | Status | Evidence |
| --- | --- | --- |
| Live fallback: graph catalog in `backend/metrichistory`, live responses carry it (status `live`); collector hook, reset rules, mode switching and recovery, "not kept" messaging | passed | Backend owner tests now require the Pod catalog on noSource and sourceError responses (red first). Frontend: hook tests (one sample per collection, retained data from an earlier visit ignored, cleared and lease released when disabled, one hour kept), tab tests (tab switch keeps samples, hidden panel and auto-refresh pause clear and stop, revisit starts empty, no collection in source mode, failure → live and recovery → source), model test for filling live graphs. 10 mutation checks each turned the suite red. 93.7% statement coverage of the changed frontend files; complexity ≤ 12 (Biome, control run active) and gocognit ≤ 10. `qc:prerelease` exit 0 (2026-10-01). Real app on Kind, user-verified (2026-10-01): live charts without a source, collection continuing across a tab switch, reset on hidden panel and auto-refresh pause, failure → live and recovery → history, and the "not kept" wording. |

## Open technical items

1. ~~Chart library choice~~: resolved, Recharts (see Decisions).
2. ~~Rate-window and step policy~~: decided in Phase 1 slice 1 (see Query
   contract). The re-query cadence was decided in slice 3 (see "Re-query
   cadence"); slice 4 checks it against the real app.
3. ~~The workload-ownership query and the node-identity join~~: resolved in Phase 0 (see Verified queries).
4. ~~The Service picker's data path~~: resolved in slice 2 with a narrow
   backend read, `ListMetricServiceCandidates`, over the object catalog. A
   cluster that isn't connected keeps its saved Service, and the picker is
   disabled with a hint to open the cluster.
5. ~~Which clusters the assignment table lists~~: **all kubeconfig contexts**
   with a search box, plus orphaned assignments (decided 2026-10-01).
   Creating an in-cluster source still needs that cluster connected, because
   its Service picker reads the live catalog.
6. Import semantics: replace the source list or merge it, and how imported
   sources map onto existing assignments.
7. The probe-cache lifetime, and the per-source in-flight query limit.
8. Whether label filters allow regex matchers (`=~`) or only equality. Also
   which template placeholders exist: `{context}` only, or also the
   kubeconfig cluster-entry name, since EKS context names are often ARNs.
9. **Filesystem graphs.**
   - Pods: cAdvisor reports no `container_fs_usage_bytes` on containerd-based
     Kind. Decide whether to find another source (e.g. kubelet ephemeral-storage
     stats) or keep the graph "unavailable" where the metric is missing.
   - Nodes: node-exporter has no `/` mount on Kind. Choose which mount the
     node graph shows: `/` when present, otherwise the kubelet's data
     directory, or every non-tmpfs mount.
