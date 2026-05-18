# Open Cluster Tab State Retention Plan

## Problem

Open cluster tabs should keep their last-viewed data available immediately when
the user switches back to them. After the refresh streaming simplification,
some active-to-background tab transitions disable scoped refresh domains in a
way that clears cached snapshots. The result is that returning to an open tab
can show a reload state even when background refresh is enabled.

The intended behavior is:

- Active tab data renders normally and refreshes normally.
- Open but inactive cluster tabs keep their last known scoped data resident.
- Background refresh updates inactive open tabs when the setting is enabled.
- Data is cleared only when a cluster tab is closed, kubeconfig state changes,
  a cluster is removed/disconnected, or an explicit reset/disposal path runs.

Do not reintroduce multi-cluster aggregate refresh-domain snapshots. Refresh
domains should remain single-cluster; cross-cluster UI should derive from
separate per-cluster scoped states.

## Expected Behavior

Open cluster tabs are live workspaces, not disposable views. Only one tab is
visible, but every open tab owns its last-viewed navigation state and scoped
data until the tab or cluster is explicitly disposed.

- Switching from one open cluster tab to another should feel instant.
- Previously loaded data for the newly active tab should render immediately.
- If background refresh is enabled, inactive open tabs should keep refreshing
  their last-viewed data in the background.
- If background refresh is disabled, inactive open tabs should stop background
  work but still retain their last loaded data for instant return.
- Foreground activation may revalidate or reconnect after rendering cached
  state, but it must not blank the view first.

## Scope

- Namespace list state for open cluster tabs.
- Namespace resource views for the last-viewed namespace tab.
- Cluster resource views for the last-viewed cluster tab.
- Background refresh fanout for supporting domains needed to render a restored
  tab immediately.
- Regression coverage for active-to-background-to-active transitions.

## Plan

### 1. Make backgrounding versus disposal explicit

- [ ] Define `active`, `background-open`, and `disposed` scoped domain
      lifecycles in the implementation notes and durable docs after the fix.
- [ ] Treat `active -> background-open` as state-preserving.
- [ ] Treat `background-open -> active` as an immediate render from existing
      scoped state, followed by normal foreground refresh/reconnect.
- [ ] Treat cluster tab close, cluster removal/disconnect, kubeconfig changing,
      auth/runtime reset, permission invalidation, and explicit view reset as
      disposal paths.
- [ ] Stop using generic React effect cleanup as proof that scoped data should
      be cleared. Cleanup caused by dependency changes or tab backgrounding
      should preserve state unless an explicit disposal signal is present.
- [ ] Use `preserveState: true` only for backgrounding/inactive-view disables,
      not for disposal.

### 2. Preserve namespace scoped state across tab switches

- [ ] Update `frontend/src/modules/namespace/contexts/NamespaceContext.tsx` so
      selected-cluster tab changes do not rebuild or clean up every namespace
      scope unnecessarily.
- [ ] Use state-preserving disable behavior for open-tab namespace scope
      deactivation, where disabling is still needed.
- [ ] Keep hard namespace resets for kubeconfig changing, no selected
      kubeconfig, cluster removal, and explicit reset flows.
- [ ] Ensure namespace list rendering reads the active cluster's scoped state
      instantly when it already exists.
- [ ] Confirm the namespace provider does not clear warmed `clusterId|`
      namespace snapshots merely because another open cluster tab became active.

### 3. Warm supporting domains for background namespace tabs

- [ ] Extend `frontend/src/core/refresh/backgroundClusterRefresher.ts` so
      background namespace views also refresh the `namespaces` domain for the
      target cluster.
- [ ] Keep fanout single-cluster by calling `fetchDomainForCluster` with one
      `clusterId` at a time.
- [ ] Avoid refreshing namespace-scoped content domains when no selected
      namespace exists for that background cluster.
- [ ] Confirm background refresh disabled means "stop refreshing inactive tabs"
      rather than "clear inactive tab data."

### 4. Preserve last-viewed namespace and cluster resource data

- [ ] Audit `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`
      cleanup paths and preserve scoped data for open-tab deactivation.
- [ ] Audit `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx`
      cleanup paths and preserve scoped data for open-tab deactivation.
- [ ] Keep disposal paths clearing state so closed/removed clusters do not leave
      stale scoped snapshots behind.
- [ ] Consider a small helper or wrapper for disabling scoped domains with an
      explicit reason, such as `backgrounding` versus `disposal`, if repeated
      call sites make the rule easy to get wrong.
- [ ] If a helper is added, keep the call sites readable: backgrounding
      preserves state; disposal clears state.

### 5. Add regression coverage

- [ ] Add a `NamespaceContext` regression test proving namespace data for an
      open inactive cluster survives switching away and back.
- [ ] Add a regression test proving switching to a warmed open cluster renders
      scoped state immediately without an intermediate empty/loading state.
- [ ] Add `BackgroundClusterRefresher` coverage proving background namespace
      tabs refresh both the supporting `namespaces` domain and the active
      namespace content domain with single-cluster scopes.
- [ ] Add `NsResourcesContext` coverage for preserving last-viewed namespace
      resource state across tab deactivation.
- [ ] Add `ClusterResourcesContext` coverage for preserving last-viewed cluster
      resource state across tab deactivation.
- [ ] Add or update orchestrator tests around `preserveState` behavior if the
      fix changes scoped enable/disable semantics.

### 6. Validate

- [ ] Run focused frontend tests:

  ```sh
  npm run test --prefix frontend -- namespace cluster refresh backgroundClusterRefresher
  ```

- [ ] Run full required validation for non-documentation implementation work:

  ```sh
  mage qc:prerelease
  ```

## Notes

- The bug is not that background refresh is globally disabled. The issue is
  that open-tab scoped state can be cleared during normal active/inactive
  lifecycle transitions.
- Perfect background refresh cannot help if tab switching clears the warmed
  scoped state. Retention must be fixed first, then freshness.
- The correct fix is state retention for open inactive tabs plus background
  refresh of the needed single-cluster domains.
- `preserveState` is appropriate for backgrounding because the open tab still
  owns the data. It is inappropriate for disposal because the cluster/scope is
  no longer valid or owned.
- The namespace aggregation behavior removed by
  `44dcbd512608bdf4833de67885393876f85ee1ec` should stay removed.
