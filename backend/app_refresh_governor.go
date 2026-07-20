package backend

import (
	"context"
	"fmt"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// initGovernor seeds the process-wide resource governor with its default policy
// and memory budget. Called once from NewApp.
func (a *App) initGovernor() {
	if a == nil {
		return
	}
	// Decide the spill's cross-restart fate once at startup: keep the previous session's
	// spill if its format matches this build (so cold-start re-paints from disk), else
	// discard it (first run or an upgrade that may have changed a row struct).
	a.resetSpillRootForFormat()
	a.governorMu.Lock()
	defer a.governorMu.Unlock()
	a.governorPolicy = system.GovernorPolicy{KeepWarm: config.GovernorKeepWarm}
	a.governorPlanned = make(map[string]system.ResourceTier)
	a.governorApplied = make(map[string]system.ResourceTier)
	a.governorBudget = config.GovernorHeapBudgetBytes
	a.governorNow = time.Now
}

// ensureGovernorStateLocked lazily initializes governor state for App instances
// built without NewApp (e.g. test fixtures), so the governor never assigns to a
// nil map. Callers must hold governorMu.
func (a *App) ensureGovernorStateLocked() {
	if a.governorPlanned == nil {
		a.governorPlanned = make(map[string]system.ResourceTier)
	}
	if a.governorApplied == nil {
		a.governorApplied = make(map[string]system.ResourceTier)
	}
	if a.governorNow == nil {
		a.governorNow = time.Now
	}
}

func (a *App) governorTime() time.Time {
	if a == nil {
		return time.Now()
	}
	a.governorMu.Lock()
	now := a.governorNow
	a.governorMu.Unlock()
	if now == nil {
		return time.Now()
	}
	return now()
}

// governorKeepsClusterCold reports whether the latest serialized governor plan
// intentionally keeps clusterID without live producers. The plan is published
// before lifecycle work starts: cooling closes the catalog gate before feeds stop,
// while re-warming opens it before the fresh catalog starts. governorApplied is
// deliberately separate because it records only completed lifecycle work.
func (a *App) governorKeepsClusterCold(clusterID string) bool {
	if a == nil || clusterID == "" {
		return false
	}
	a.governorMu.Lock()
	defer a.governorMu.Unlock()
	tier, tracked := a.governorPlanned[clusterID]
	return tracked && tier == system.TierCold
}

// SetVisibleCluster records the cluster the user is currently viewing and
// re-tiers the open clusters accordingly. It is Wails-bound so the frontend
// calls it whenever the active cluster tab changes.
//
// Moving the cluster to the front of the MRU keeps the most-recently-viewed
// clusters warm; the governor policy then decides which stay Background and
// which go Cold.
func (a *App) SetVisibleCluster(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	a.governorMu.Lock()
	a.ensureGovernorStateLocked()
	a.governorVisible = clusterID
	a.governorMRU = moveToFront(a.governorMRU, clusterID)
	a.governorMu.Unlock()

	a.reconcileGovernor()
	if a.clusterLifecycle != nil {
		a.clusterLifecycle.Replay(clusterID)
	}
}

// moveToFront returns mru with id at the front, preserving the relative order of
// the remaining entries and de-duplicating id.
func moveToFront(mru []string, id string) []string {
	next := make([]string, 0, len(mru)+1)
	next = append(next, id)
	for _, existing := range mru {
		if existing != id {
			next = append(next, existing)
		}
	}
	return next
}

// governorExecutor applies a single tier transition. The production
// implementation reuses the existing per-cluster build/teardown; tests
// substitute a recorder so reconcile's dispatch decisions can be verified
// without standing up real subsystems.
type governorExecutor interface {
	// ensureRunning builds+starts the cluster's subsystem if it is not already
	// running. Metrics activity is owned independently by cluster-scoped
	// frontend leases. It reports whether the requested live tier was reached.
	ensureRunning(clusterID string) bool
	// teardown reaches Cold only after its retained serving baseline exists. It
	// reports false while that server-owned preparation is still running.
	teardown(clusterID string) bool
}

// reconcileGovernor computes the desired tier for every open cluster and applies
// the transitions needed to reach it. It is idempotent and safe to call
// repeatedly: clusters already at their desired tier produce no action.
func (a *App) reconcileGovernor() {
	a.reconcileGovernorWith(a.realGovernorExecutor())
}

// reconcileGovernorWith is the testable core: it reads the governor state under
// governorMu, computes transitions, then dispatches them through exec. Slow executor
// calls run outside governorMu so newer visibility and pressure intent can still be
// recorded; governorReconcileMu orders their application so executor calls cannot
// overlap on an intermediate subsystem state.
func (a *App) reconcileGovernorWith(exec governorExecutor) {
	if a == nil || exec == nil {
		return
	}
	// Applying a tier is a multi-step lifecycle operation: cooling stops feeds
	// before publishing the cooled subsystem, while warming replaces the entire
	// subsystem. Never let another reconcile act on that intermediate state.
	a.governorReconcileMu.Lock()
	defer a.governorReconcileMu.Unlock()

	open := a.openClusterIDs()

	a.governorMu.Lock()
	a.ensureGovernorStateLocked()
	// The visible cluster is always considered open: the frontend may signal it a
	// beat before its clients finish registering, and the user's active cluster
	// must never be dropped from the MRU as if it had closed.
	if a.governorVisible != "" {
		open[a.governorVisible] = true
	}
	// Restrict the MRU to clusters that are still open (closed clusters are torn
	// down by the connection lifecycle, not the governor) and drop their stale
	// tier so a later re-open re-tiers from scratch.
	mru := intersectOrdered(a.governorMRU, open)
	a.governorMRU = mru
	for id := range a.governorApplied {
		if !open[id] {
			delete(a.governorApplied, id)
		}
	}
	desired := a.governorPolicy.Assign(mru, a.governorVisible, a.governorPressure)
	transitions := system.PlanGovernorTransitions(a.governorApplied, desired)
	// Catalog start/stop runs inside the lifecycle executor. Publish the plan
	// first so those nested operations see where the serialized transition is
	// going, while governorApplied continues to describe the state actually
	// reached (including deferred Cold preparation).
	a.governorPlanned = make(map[string]system.ResourceTier, len(desired))
	for id, tier := range desired {
		a.governorPlanned[id] = tier
	}
	a.governorMu.Unlock()

	for _, t := range transitions {
		applied := false
		switch {
		case t.Teardown:
			applied = exec.teardown(t.ClusterID)
		case t.EnsureRunning:
			applied = exec.ensureRunning(t.ClusterID)
		}
		if applied {
			// Record the tier only after the executor reaches it. A deferred Cold
			// transition remains at its live tier, so the retained-baseline callback
			// can reconcile it again instead of leaving it permanently misclassified.
			a.governorMu.Lock()
			a.governorApplied[t.ClusterID] = t.Tier
			a.governorMu.Unlock()
		}
	}
}

// openClusterIDs returns the set of clusters that are currently open. A cluster
// is open if it has selected kubeconfig clients OR a live refresh subsystem (the
// latter covers clusters whose subsystem is up before the governor first runs).
func (a *App) openClusterIDs() map[string]bool {
	open := make(map[string]bool)
	if selections, err := a.selectedKubeconfigSelections(); err == nil {
		for _, sel := range selections {
			if meta := a.clusterMetaForSelection(sel); meta.ID != "" {
				open[meta.ID] = true
			}
		}
	}
	for id := range a.snapshotRefreshSubsystems() {
		open[id] = true
	}
	return open
}

// intersectOrdered keeps ids that are in the open set, preserving order, and
// appends any open ids missing from ids (e.g. clusters opened without ever being
// the visible one) to the back so they are still eligible for the warm budget.
func intersectOrdered(ids []string, open map[string]bool) []string {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(open))
	for _, id := range ids {
		if open[id] && !seen[id] {
			out = append(out, id)
			seen[id] = true
		}
	}
	for id := range open {
		if !seen[id] {
			out = append(out, id)
			seen[id] = true
		}
	}
	return out
}

// realGovernorExecutor wires the governor's tier transitions to the existing
// per-cluster build/teardown APIs.
func (a *App) realGovernorExecutor() governorExecutor {
	return &appGovernorExecutor{app: a}
}

type appGovernorExecutor struct {
	app *App
}

// ensureRunning builds+starts the subsystem if absent, reusing the existing
// per-cluster rebuild path. Metrics demand is routed separately by cluster ID.
func (e *appGovernorExecutor) ensureRunning(clusterID string) bool {
	a := e.app
	if a == nil {
		return false
	}
	subsystem := a.getRefreshSubsystem(clusterID)
	switch {
	case subsystem == nil:
		// Re-warm a Cold (or never-started) cluster by reusing the same per-cluster
		// build+start path used by auth recovery: it builds the subsystem, starts
		// the manager, updates the aggregate handlers, and starts the object catalog.
		a.rebuildClusterSubsystem(clusterID)
	case subsystem.Cooled:
		// A cooled subsystem is non-nil but NOT live: it serves cooled queries from its
		// mmap-backed stores. Re-warm it to a fresh, live, mutable subsystem.
		a.rewarmCooledClusterSubsystem(clusterID)
	}
	subsystem = a.getRefreshSubsystem(clusterID)
	if subsystem == nil || subsystem.Cooled {
		return false
	}
	if err := a.ensureObjectCatalogForCluster(clusterID); err != nil {
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Governor could not complete live tier for cluster %s: %v", clusterID, err), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
		}
		return false
	}
	return true
}

// rewarmCooledClusterSubsystem replaces a cooled (mmap-serving) subsystem with a fresh, live
// one. ORDERING is the safety contract for the mmap closers, whose mappings the cooled stores'
// rows alias (a read after unmap is a use-after-free):
//  1. takeRefreshSubsystem removes the cooled subsystem from a.refreshSubsystems, so no NEW
//     Build resolves it via the per-cluster getter.
//  2. rebuildClusterSubsystem builds the fresh subsystem, sets it in the map, and calls
//     refreshAggregates.Update — after which the aggregate snapshot router resolves the FRESH
//     subsystem's stores, never the cooled mmap stores. The cooled subsystem (and its snapshot
//     cache holding any mmap-aliased rows) is now fully unreachable for serving.
//  3. closeCooledClosers takes the closers (exactly once) and runs them. Each store-level
//     closer waits for the store's write lock, so it serializes after any straggler in-flight
//     Build that was already reconstructing rows when the swap happened — only then unmapping.
func (a *App) rewarmCooledClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	// (1) unroute the cooled subsystem so no new Build can reach its mmap stores.
	a.takeRefreshSubsystem(clusterID)
	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Governor re-warming cooled cluster %s", clusterID), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
	}
	// (2) build + start a fresh live subsystem and re-point the aggregate router at it.
	a.rebuildClusterSubsystem(clusterID)
	// (3) the cooled subsystem is now unrouted; release its mappings (waits for any straggler
	// in-flight Build via each closer's store-lock, then unmaps once).
	a.closeCooledClosers(clusterID)
}

// teardown moves the cluster to the governor's Cold tier. It first attempts to COOL the
// cluster — stop its feeds and swap its maintained stores to off-heap mmap-backed columns,
// keeping the subsystem registered so it still serves Build queries — and only falls back to a
// full teardown (heap fully reclaimed, blank until re-warm) if cooling fails at any step. Either
// way the cluster's informer/metrics heap is reclaimed.
func (e *appGovernorExecutor) teardown(clusterID string) bool {
	a := e.app
	if a == nil {
		return false
	}
	subsystem := a.getRefreshSubsystem(clusterID)
	if subsystem == nil {
		return true
	}
	if !subsystem.ColdServingReady() {
		a.startColdPreparation(clusterID, subsystem)
		if pendingFor, heapInuse, force := a.shouldForceColdTeardown(subsystem); force {
			if a.logger != nil {
				a.logger.Warn(fmt.Sprintf(
					"Governor cold preparation for cluster %s remained unsettled for %s under sustained memory pressure; forcing full teardown (heap in use: %d bytes)",
					clusterID,
					pendingFor.Round(time.Second),
					heapInuse,
				), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
			}
			// Use the normal full-teardown path so feeds stop, the generation-owned
			// preparation is canceled, and every available store is spilled before
			// heap is reclaimed. The catalog must stop with the live producers.
			a.teardownClusterSubsystem(clusterID)
			a.stopObjectCatalogForCluster(clusterID)
			runtime.GC()
			debug.FreeOSMemory()
			return true
		}
		return false
	}
	a.coolClusterToMmapServing(clusterID)
	subsystem = a.getRefreshSubsystem(clusterID)
	return subsystem == nil || subsystem.Cooled
}

const (
	coldPreparationRetryInterval = 250 * time.Millisecond
	// One complete cache-bypass overview attempt gets the same bound used by
	// buildColdPreparationSnapshot. Only sustained memory pressure may trade the
	// settled retained baseline for a full teardown after this grace expires.
	coldPreparationPressureGrace = config.RefreshInformerSyncTimeout + 5*time.Second
)

func (a *App) shouldForceColdTeardown(subsystem *system.Subsystem) (time.Duration, uint64, bool) {
	if a == nil || subsystem == nil {
		return 0, 0, false
	}
	pendingFor, pending := subsystem.ColdPreparationAge(a.governorTime())
	if !pending || pendingFor < coldPreparationPressureGrace {
		return pendingFor, 0, false
	}
	a.governorMu.Lock()
	underPressure := a.governorPressure
	heapInuse := a.governorHeapInuse
	a.governorMu.Unlock()
	return pendingFor, heapInuse, underPressure
}

// startColdPreparation waits for and builds the retained snapshots needed by
// surfaces that remain visible while a cluster is Cold. The work is server-owned
// and independent of frontend leases: until it succeeds, the subsystem stays live.
func (a *App) startColdPreparation(clusterID string, subsystem *system.Subsystem) {
	if a == nil || clusterID == "" || subsystem == nil || subsystem.SnapshotService == nil || a.refreshCtx == nil || a.clusterLifecycle == nil {
		return
	}
	preparationCtx, started := subsystem.BeginColdPreparation(a.refreshCtx, a.governorTime())
	if !started {
		return
	}
	go func() {
		namespaceBaselineReady := func() bool {
			if a.clusterLifecycle.GetState(clusterID) != ClusterStateReady {
				return false
			}
			// The aggregate lifecycle may still carry Ready from a subsystem this
			// one replaced. When the namespace domain is registered, also require
			// this generation's own workload tracker to have settled.
			return subsystem.NamespaceNotifier == nil || subsystem.NamespaceNotifier.WorkloadsReady()
		}
		stillCurrent := func() bool { return a.getRefreshSubsystem(clusterID) == subsystem }
		if !primeColdServingSnapshots(preparationCtx, subsystem.SnapshotService, clusterID, namespaceBaselineReady, stillCurrent) {
			return
		}
		// A rebuild may have replaced this subsystem while its sources settled.
		// Never transfer readiness across subsystem generations.
		if a.getRefreshSubsystem(clusterID) != subsystem {
			a.reconcileGovernor()
			return
		}
		subsystem.MarkColdServingReady()
		a.reconcileGovernor()
	}()
}

// primeColdServingSnapshots waits for the server-owned namespace lifecycle to
// prove its retained baseline, then builds cluster-overview. Waiting on lifecycle
// state performs no snapshot or Kubernetes API calls. Cache bypass forces the
// overview through its current source gates; its cluster-prefixed empty scope
// matches Global requests exactly.
func primeColdServingSnapshots(
	ctx context.Context,
	service refresh.SnapshotService,
	clusterID string,
	namespaceBaselineReady func() bool,
	stillCurrent func() bool,
) bool {
	if ctx == nil || service == nil || clusterID == "" || namespaceBaselineReady == nil || stillCurrent == nil {
		return false
	}
	scope := refresh.JoinClusterScope(clusterID, "")
	for {
		if !stillCurrent() {
			return false
		}
		if namespaceBaselineReady() {
			if _, err := buildColdPreparationSnapshot(ctx, service, "cluster-overview", scope); err == nil {
				return true
			}
		}
		timer := time.NewTimer(coldPreparationRetryInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false
		case <-timer.C:
		}
	}
}

func buildColdPreparationSnapshot(
	ctx context.Context,
	service refresh.SnapshotService,
	domainName string,
	scope string,
) (*refresh.Snapshot, error) {
	attemptCtx, cancel := context.WithTimeout(ctx, config.RefreshInformerSyncTimeout+5*time.Second)
	defer cancel()
	return service.Build(refresh.WithCacheBypass(attemptCtx), domainName, scope)
}

// coolClusterToMmapServing transitions a cluster to the Cold-tier SERVING state: it stops the
// feeds, swaps the maintained stores to off-heap mmap-backed columns, installs a cooled
// (always-settled) informer hub so the SnapshotService keeps serving, marks the subsystem
// cooled, stops the object catalog, and reclaims the freed heap. On ANY cooling error it falls
// back to the existing full teardown so a cluster is never left half-cooled.
func (a *App) coolClusterToMmapServing(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	subsystem := a.getRefreshSubsystem(clusterID)
	if subsystem == nil {
		return
	}

	// Stop the feeds (permission reval, resource stream, manager, informer factory) WITHOUT
	// removing the subsystem — it stays registered to serve cooled queries.
	a.stopClusterFeeds(clusterID, subsystem)

	// Swap the maintained stores to mmap. On error, safe-degrade to full teardown.
	dir, err := a.clusterCooledMmapDir(clusterID)
	if err == nil {
		var closers []func() error
		closers, err = subsystem.Registry.CoolMaintainedStoresToMmap(dir)
		if err == nil {
			// The feeds are stopped, so the manager + informer factory are shut down and the
			// original hub's HasSynced now reports false — install a cooled hub so the
			// SnapshotService serves the frozen, resident mmap stores without blocking on the
			// (now-dead) sync gate.
			if svc, ok := subsystem.SnapshotService.(*snapshot.Service); ok {
				svc.SetInformerHub(system.NewCooledInformerHub())
			}
			a.setCooledClosers(clusterID, closers)
			subsystem.Cooled = true
		}
	}
	if err != nil {
		// Cooling failed at some step (mkdir or a store swap). CoolMaintainedStoresToMmap already
		// closed any mapping it opened, so nothing is left half-mapped. Fall back to a full
		// teardown: the subsystem is discarded and its heap fully reclaimed.
		if a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Governor cool failed for cluster %s, falling back to full teardown: %v", clusterID, err), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
		}
		a.teardownClusterSubsystem(clusterID)
		a.stopObjectCatalogForCluster(clusterID)
		runtime.GC()
		debug.FreeOSMemory()
		if a.logger != nil {
			a.logger.Info(fmt.Sprintf("Governor cooled cluster %s (heap reclaimed)", clusterID), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
		}
		return
	}

	// The cooled subsystem stays registered + serving; stop its object catalog like a teardown
	// (the catalog is rebuilt on re-warm), then reclaim the heap the informers/metrics held.
	a.stopObjectCatalogForCluster(clusterID)
	runtime.GC()
	debug.FreeOSMemory()
	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Governor cooled cluster %s (serving from mmap, heap reclaimed)", clusterID), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
	}
}

// seedGovernorFromOpenClusters initializes the MRU/visible/applied state from the
// currently open clusters and starts settling them to the policy's tiers. Called
// once the initial subsystems have been built and their manager starts launched.
// A Cold assignment remains live while its retained baseline settles. The first open cluster is treated
// as visible if none has been set yet, so a fresh start lands one Foreground.
func (a *App) seedGovernorFromOpenClusters() {
	if a == nil {
		return
	}
	open := a.openClusterIDs()

	a.governorMu.Lock()
	a.ensureGovernorStateLocked()
	a.governorMRU = intersectOrdered(a.governorMRU, open)
	if a.governorVisible == "" || !open[a.governorVisible] {
		if len(a.governorMRU) > 0 {
			a.governorVisible = a.governorMRU[0]
		}
	}
	a.governorMu.Unlock()

	// Leave last-applied tier updates to the serialized reconcile path. The initial
	// build already launched every subsystem, so its ensureRunning calls are idempotent;
	// Cold assignments prepare their retained baselines before cooling.
	a.reconcileGovernor()
}

// handleGovernorPressureSample records the latest heap sample. Every sample that
// remains over budget re-drives reconciliation so a Cold transition deferred for
// retained-baseline preparation can reach its bounded pressure fallback.
func (a *App) handleGovernorPressureSample(heapInuse uint64) {
	if a == nil {
		return
	}
	a.governorMu.Lock()
	budget := a.governorBudget
	underPressure := budget > 0 && heapInuse > budget
	changed := underPressure != a.governorPressure
	a.governorPressure = underPressure
	a.governorHeapInuse = heapInuse
	a.governorMu.Unlock()

	if changed || underPressure {
		a.reconcileGovernor()
	}
}

// startGovernorPressureLoop periodically samples heap usage. It stops when ctx
// is cancelled (bound to the refresh context, so no goroutine leak on shutdown).
func (a *App) startGovernorPressureLoop(ctx context.Context) {
	if a == nil || ctx == nil {
		return
	}
	a.governorMu.Lock()
	budget := a.governorBudget
	a.governorMu.Unlock()
	if budget == 0 {
		// Pressure-driven demotion disabled; nothing to poll.
		return
	}

	ticker := time.NewTicker(config.GovernorPressureInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var stats runtime.MemStats
			runtime.ReadMemStats(&stats)
			a.handleGovernorPressureSample(stats.HeapInuse)
		}
	}
}
