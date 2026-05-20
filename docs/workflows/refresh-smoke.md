# Refresh Runtime Smoke Checklist

Use this checklist before releases or after high-risk refresh, streaming,
multi-cluster, RBAC, informer, or kubeconfig lifecycle changes. It is a manual
runtime check, not a replacement for `mage qc:prerelease`.

## Setup

- Use at least two reachable clusters with distinct `clusterId` values.
- Keep one broad-permission kubeconfig and one restricted-RBAC kubeconfig
  available.
- Start the app from a clean launch, with Diagnostics available.
- Open the Diagnostics panel. Only one diagnostics table is visible at a time,
  so switch between refresh domains, streams, effective permissions, and
  Kubernetes API clients at each checkpoint and capture notes or screenshots
  for the relevant table.
- Record the app version, kubeconfig names, cluster names, OS, and any failed
  scenario with diagnostics rows and app logs.

## General Pass Criteria

- Cluster data never appears under the wrong cluster tab.
- Refresh scopes shown in diagnostics are cluster-prefixed.
- Streams reconnect or fall back without permanently stale loading states.
- Permission-denied domains show explicit denied state, not empty successful
  data.
- Closing or removing a cluster stops its streams and does not clear unrelated
  cluster data.
- Recovered streams and snapshots update existing rows without duplicate rows
  or identity drift.

## Multi-Cluster Stream Reconnects

1. Open two cluster tabs.
2. On cluster A, open a namespace view with pods, workloads, events, catalog,
   and an object log stream active.
3. On cluster B, open a different namespace view with a different active object
   log stream.
4. Trigger a short network interruption or stop and restart the local refresh
   HTTP server if running in a development build.
5. Wait for streams to reconnect.
6. Change a pod, event source, or catalog-visible object in each cluster.

Pass:

- Resource, event, catalog, and log streams reconnect for the correct cluster.
- Diagnostics show separate stream state per cluster/scope.
- Rows, events, catalog entries, and logs from cluster A never appear in cluster
  B, or the reverse.
- Manual refresh works after reconnect without requiring app restart.

## Restricted RBAC Partial Access

1. Switch to the restricted-RBAC kubeconfig.
2. Open cluster overview, namespaces, pods, workloads, config, RBAC, storage,
   events, catalog, object details, YAML, object map, and logs where applicable.
3. Compare allowed and denied domains against the expected RBAC policy.
4. Trigger manual refresh on at least one allowed and one denied domain.

Pass:

- Runtime-permission domains with missing permissions show permission-denied
  diagnostics and UI state.
- Partially available aggregate domains still show allowed sections and clear
  fallback state.
- Stream-specific denied access is visible in stream diagnostics.
- Denied domains do not poison allowed domains in the same cluster.

## Cluster Add, Remove, And Rebuild

1. Start with one connected cluster and active resource/event/catalog/log
   streams.
2. Add a second cluster.
3. Switch between tabs while streams are active.
4. Remove or disconnect the second cluster.
5. Change kubeconfig selection or force auth/runtime rebuild.
6. Reconnect the removed cluster if available.

Pass:

- Existing cluster state remains scoped to its original cluster.
- Adding a cluster creates independent refresh runtime state.
- Removing a cluster stops that cluster's streams and releases diagnostics rows
  without affecting remaining cluster data.
- Runtime rebuild suppresses transient connection errors and resumes snapshots
  and streams after recovery.
- No stale disabled cluster continues to receive stream events.

## Informer Cold Start And Recovery

1. Launch the app against a cluster with enough resources to populate catalog,
   namespace, workload, pod, node, and CRD-backed views.
2. Immediately open catalog, namespace resources, custom resources, events, and
   object details while informers are still warming.
3. Restart the app or refresh subsystem and repeat.
4. If possible, temporarily create and delete a CRD-backed object during
   informer warmup.

Pass:

- Cold-start snapshots either wait, fall back, or show explicit initializing
  state; they do not present successful empty data for populated resources.
- Catalog and typed views converge on the same object identity after informers
  sync.
- CRD-backed resource streams recover from CRD signature changes.
- Object detail, YAML, and object map views invalidate stale provider/cache
  data after informer callbacks resume.

## Visibility And Background Refresh

1. Open active streams in one foreground cluster and one background cluster.
2. Hide the app or switch away long enough for visibility suspension.
3. Return to the app.
4. Trigger object changes in both clusters.

Pass:

- Streams pause while hidden and resume without duplicate connections.
- Resource streams resync current subscriptions after visibility returns.
- Background cluster state remains retained and does not overwrite the active
  cluster.

## Automation Follow-Up Candidates

Automate only after this manual checklist is repeatable in development builds.
Good candidates:

- A two-cluster stream reconnect integration test using fake stream servers.
- A restricted-RBAC fixture that asserts denied and allowed diagnostics.
- A runtime rebuild test that verifies transient stream errors are suppressed.
- A CRD signature-change test for custom resource stream recovery.

Until then, keep this checklist manual and require explicit notes for any
failed or skipped scenario.
