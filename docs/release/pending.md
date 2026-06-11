### Added

- Every resource table with a filter bar now has a consistent **Copy · Export** pair, in the
  same place on every view (including the object panel's Pods and Jobs tabs). Copy puts rows
  on the clipboard; Export saves them to a CSV file. Both always act on **all matching
  rows** across every page, respecting your active filters — what you filtered is what you
  get, never just the visible page. Browse and the Custom-resource views use the same
  mechanism as the rest of the app (the separate server-side catalog export was retired in
  favor of this one path). The object panel's Events tab is the one exception — it is a bare
  presentation list without a filter bar. Exported files are offered as
  `luxury-yacht-<view>-<timestamp>.csv` (e.g. `luxury-yacht-cluster-crds-20260610142233.csv`),
  so repeated exports never collide and the file name says where and when it came from.

### Changed

- Single-namespace resource views (Pods, Workloads, Config, Network, RBAC, Storage, Events,
  Autoscaling, Quotas, Helm) now paginate and load server-side, just like the all-namespaces,
  cluster, and Browse/Custom views — previously they loaded a whole namespace at once with no
  pagination controls. Pagination is now consistent across every resource view, and large
  single namespaces no longer load everything in one shot.
- The object panel's Pods tab (a workload's or node's pods) now paginates and loads server-side
  too, with backend-side search/sort/filter — so opening the Pods tab on a Deployment, DaemonSet,
  or Node that owns thousands of pods no longer loads them all at once.
- When a filter is active, every resource table (cluster, namespace, Browse, Custom, events —
  no exceptions) now shows a single consistent banner: **"showing N of M items due to filters,"**
  where N is how many rows match your filter and M is how many are in scope without it — both
  real totals, not the current page. With no filter active there is no banner. The old
  "bounded local snapshot" / "applies only to the visible rows" note is gone (it no longer
  applies now that filtering and sorting run server-side across the whole dataset); pagination
  position still lives in the footer.

- The **"Maximum table rows"** advanced setting was removed. Tables paginate and filter
  server-side now, so the client-side row cap no longer did anything; a previously persisted
  value is ignored.
- Browse's default page size changed from 1000 to 50 rows. Large catalogs open much faster;
  the page-size selector still offers up to 1000 per page.
- The Cluster CRDs view no longer shows a Kind filter dropdown — every row there is a
  CustomResourceDefinition, so the dropdown had exactly one option. Search and the other
  filters are unchanged.

### Added

- New setting: **Settings ▸ Display ▸ Tables ▸ Default page size** (default 50). It sets the
  rows-per-page for any table that doesn't have a saved page size yet; picking a page size in
  a table's footer still overrides it for that table. The dropdown offers the same values as
  every pagination footer — they share one list in the app.

### Added

- The YAML editor now warns before a save takes ownership of fields that are
  managed by another controller. When your edit changes a field owned by an
  operator, controller, Helm, or a GitOps tool, a confirmation dialog lists
  each field and its current manager — those managers may revert or fight the
  change — and offers three choices: save anyway, keep editing, or cancel the
  edit entirely (discarding the draft). Fields owned by kubectl or
  by this app's own previous edits don't prompt (those are routine human
  edits), and the check never blocks saving on clusters where it can't run.
  Saving still uses the same kubectl-edit-style patch as before; the warning
  is computed with a server-side-apply dry run, which changes nothing on the
  cluster.

### Fixed

- Cut, Copy, Paste, and Select All now work correctly in the YAML editor (and
  the Helm Manifest/Values tabs) with the standard keyboard shortcuts and the
  editor's right-click menu, in both read and edit modes. Previously Cmd/Ctrl+C
  and Cmd/Ctrl+A did nothing in read mode (or selected the whole window), there
  was no Cut menu command at all so Cmd/Ctrl+X never worked, Select All only
  covered the visible part of large manifests, and the right-click Paste could
  fail silently. The read-mode editor is now focusable: clicking it focuses the
  YAML so clipboard shortcuts apply to it, and single-key app shortcuts (like
  `m` for managedFields) still work while it is focused. The application Edit
  menu also gained the standard Cut command.

- Selected text in the YAML editor (and the Helm Manifest/Values tabs) now
  uses the same highlight color whether the editor is in read or edit mode,
  and the highlight is translucent so the syntax-colored text stays readable.
  Previously read mode painted selections with the solid accent color while
  edit mode silently fell back to CodeMirror's built-in colors — in dark mode
  the edit-mode selection was nearly invisible.

- Clusters now reconnect automatically after extended outages such as control-plane
  upgrades. Previously, an authentication error during an outage (for example a
  transient 401 while the API server restarted) started a recovery cycle that gave
  up permanently after ~30 seconds — far shorter than a typical upgrade — and
  nothing ever re-checked the cluster afterwards, so it stayed at "Authentication
  failed, please re-authenticate" until the app was restarted. Recovery now
  distinguishes an unreachable cluster from rejected credentials: while the cluster
  is unreachable the app keeps probing (every 15 seconds) and reconnects on its own
  as soon as the cluster answers, and the connectivity indicator shows
  "Reconnecting" instead of a misleading authentication-failure overlay. Genuine
  credential failures still show the authentication overlay — and the app now
  rechecks those once a minute too, so fixing credentials externally (for example
  `aws sso login`) reconnects the cluster without needing the Retry button. The
  overlay itself now shows one steady message with a live "next automatic recheck
  in Ns" countdown, replacing the old "Attempt X of 4" counter that ended in
  "auto-retry attempts failed" even though rechecking never actually stops.

- Fixed a wiring bug where any rebuild of a cluster's clients (after auth recovery,
  a kubeconfig file change, or a transport rebuild) attached the new connections to
  a discarded internal auth tracker. The next authentication error after a rebuild
  could permanently block all requests to that cluster — with the cluster stuck
  showing "Retrying…" forever and the Retry button silently doing nothing.

- Resource tables no longer flash a loading spinner or "no data available" when
  you re-visit a view you've already opened. Every table now shows the rows it
  had last time for that cluster/namespace immediately on return and refreshes
  in the background; the loading spinner appears only on the first-ever load.

- Filtering is now quiet and consistent in every view: changing filters or
  typing in the filter box no longer dims the table or shows a loading spinner
  while the refreshed rows load — the current rows stay up and swap in place.
  This also fixes the filter input losing keyboard focus while typing when the
  filter text had no matches.

- Selecting kinds in the Kinds dropdown no longer removes the unselected kinds
  from the dropdown (seen in the All Namespaces Workloads, Config, Network,
  RBAC, and Quotas views, and possible in cluster Config/RBAC). Each table's
  kind list is now published by the backend alongside its query results, so
  the dropdown always offers the full list regardless of the active filter —
  and only kinds the cluster actually serves: for example, the Gateway API
  kinds appear in the Network view's dropdown only on clusters that have them.

- In Browse views, the Kinds dropdown no longer flashes and redraws on the
  first filter selection after opening or switching Browse views. (Filtering
  swapped the catalog query, and a cleanup step wrongly reset the separate
  snapshot that feeds the dropdown options; the live catalog stream was also
  being disconnected by the same step. Both fixed, and the dropdowns now hold
  their options across momentary data gaps.)

- Opening the Events views shortly after connecting to a cluster no longer
  shows "Unable to load data" before the events appear. Two fixes: the backend
  now waits for its event cache to finish its initial sync instead of
  answering early (the first request is just slightly slower), and tables no
  longer present warm-up conditions (a blocked or not-yet-ready request) as
  errors — they keep loading and retry. Genuine failures are still reported
  through error notifications; the never-visible in-table error banner was
  removed.

- Visiting a view while its cluster is still connecting no longer produces
  failed requests, connection-error notifications, and console errors ("no
  active clusters available", "Catalog stream connection lost"). The app now
  tracks each cluster's startup state: requests and live streams for a cluster
  that isn't serving yet are held quietly and dispatched automatically the
  moment it is — the view simply shows its normal loading state until the data
  arrives.

- Failed live-stream requests now return proper CORS headers, so when one does
  fail the browser console shows the real status and message instead of an
  opaque "not allowed by Access-Control-Allow-Origin" error.

- Pod action menus in the object panel no longer lose their permission-gated
  entries. Three fixes: the Pods tab of a workload or node panel now offers the
  full pod context menu — Port Forward and Delete appear there (with their
  confirmation and port-forward dialogs) just like on the main Pods views,
  instead of only Open/Map/Diff. An object opened into an existing panel tab
  group (for example a pod opened from a workload's Pods tab) no longer reads
  the group's first panel for its cluster/API identity — previously the pod's
  actions menu checked pod permissions under the workload's API group, found
  nothing, and silently dropped Delete while greying out Port Forward; this
  also corrects every other place a grouped panel tab used the wrong panel's
  identity. And a pod's Details actions menu no longer permanently loses Port
  Forward and Delete after a cluster reconnects or the active cluster is
  switched while connecting: any moment the selected cluster wasn't ready
  erased the app's cached permission answers for every cluster, and open
  panels never re-asked. The permission cache now survives reconnects, no
  longer records a still-connecting cluster's "not active" responses as
  denials (which blocked retries for two minutes), and re-checks a cluster's
  namespaces the moment it becomes ready. The Pods tab also now checks pod
  permissions for the namespaces of the pods it actually shows, so a node
  panel's pods — which span many namespaces — get correct menus too.

- The Helm view now loads as fast as every other view. It previously made live
  Kubernetes API calls through the Helm SDK on every load — one full client
  bootstrap and list call per namespace, plus a cluster-wide re-scan for every
  namespace without releases — repeated for every page, sort, and filter
  change. It now reads Helm's release records straight from the app's existing
  in-memory cache: zero API calls per load, instant pagination and filtering.
  One visible improvement: releases with operations in flight
  (pending-install, pending-upgrade, pending-rollback, uninstalling) now
  appear in the list with their current status instead of being hidden.
