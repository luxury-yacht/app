package backend

import (
	"context"
	"fmt"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// initGovernor seeds the process-wide resource governor with its default policy
// and memory budget. Called once from NewApp.
func (a *App) initGovernor() {
	if a == nil {
		return
	}
	// Clear last session's transient store spill once at startup: a re-warm restores only
	// what this session spilled (cross-restart resume is Tier 2.5).
	a.resetSpillRoot()
	a.governorMu.Lock()
	defer a.governorMu.Unlock()
	a.governorPolicy = system.GovernorPolicy{KeepWarm: config.GovernorKeepWarm}
	a.governorApplied = make(map[string]system.ResourceTier)
	a.governorBudget = config.GovernorHeapBudgetBytes
}

// ensureGovernorStateLocked lazily initializes governor state for App instances
// built without NewApp (e.g. test fixtures), so the governor never assigns to a
// nil map. Callers must hold governorMu.
func (a *App) ensureGovernorStateLocked() {
	if a.governorApplied == nil {
		a.governorApplied = make(map[string]system.ResourceTier)
	}
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
// implementation reuses the existing per-cluster build/teardown and the
// demand-driven metrics poller; tests substitute a recorder so reconcile's
// dispatch decisions can be verified without standing up real subsystems.
type governorExecutor interface {
	// ensureRunning builds+starts the cluster's subsystem if it is not already
	// running, then applies the metrics poller demand state (active for
	// Foreground, idle for Background).
	ensureRunning(clusterID string, metricsActive bool)
	// teardown stops the cluster's subsystem and reclaims its heap.
	teardown(clusterID string)
}

// reconcileGovernor computes the desired tier for every open cluster and applies
// the transitions needed to reach it. It is idempotent and safe to call
// repeatedly: clusters already at their desired tier produce no action.
func (a *App) reconcileGovernor() {
	a.reconcileGovernorWith(a.realGovernorExecutor())
}

// reconcileGovernorWith is the testable core: it reads the governor state under
// the lock, computes transitions, then dispatches them through exec. exec calls
// run OUTSIDE the lock because building/tearing down a subsystem is slow and must
// not block SetVisibleCluster or the pressure loop.
func (a *App) reconcileGovernorWith(exec governorExecutor) {
	if a == nil || exec == nil {
		return
	}

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
	// Record the new tiers now; the executor calls below are idempotent, so a
	// concurrent reconcile observing the updated map will simply find no work.
	for id, tier := range desired {
		a.governorApplied[id] = tier
	}
	a.governorMu.Unlock()

	for _, t := range transitions {
		switch {
		case t.Teardown:
			exec.teardown(t.ClusterID)
		case t.EnsureRunning:
			exec.ensureRunning(t.ClusterID, t.MetricsActive)
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
// per-cluster build/teardown and metrics poller APIs.
func (a *App) realGovernorExecutor() governorExecutor {
	return &appGovernorExecutor{app: a}
}

type appGovernorExecutor struct {
	app *App
}

// ensureRunning builds+starts the subsystem if absent (reusing the existing
// per-cluster rebuild path), then pins/unpins the demand-driven metrics poller.
func (e *appGovernorExecutor) ensureRunning(clusterID string, metricsActive bool) {
	a := e.app
	if a == nil {
		return
	}
	if a.getRefreshSubsystem(clusterID) == nil {
		// Re-warm a Cold (or never-started) cluster by reusing the same per-cluster
		// build+start path used by auth recovery: it builds the subsystem, starts
		// the manager, updates the aggregate handlers, and starts the object catalog.
		a.rebuildClusterSubsystem(clusterID)
	}
	if subsystem := a.getRefreshSubsystem(clusterID); subsystem != nil && subsystem.Manager != nil {
		// Foreground pins the demand poller active; Background lets it idle out so
		// a warm-but-not-visible cluster stops paying for metrics polling.
		subsystem.Manager.SetMetricsActive(metricsActive)
	}
}

// teardown tears down the cluster's subsystem and reclaims its heap.
func (e *appGovernorExecutor) teardown(clusterID string) {
	a := e.app
	if a == nil {
		return
	}
	if a.getRefreshSubsystem(clusterID) == nil {
		return
	}
	// Reuse the per-cluster teardown used by auth recovery: it stops permission
	// revalidation, shuts the manager + resource stream, and shuts the informer
	// factory for just this cluster.
	a.teardownClusterSubsystem(clusterID)
	a.stopObjectCatalogForCluster(clusterID)
	// Reclaim the heap the torn-down informers held so the saving is realized.
	runtime.GC()
	debug.FreeOSMemory()
	if a.logger != nil {
		a.logger.Info(fmt.Sprintf("Governor cooled cluster %s (heap reclaimed)", clusterID), logsources.Refresh, clusterID, a.clusterNameForID(clusterID))
	}
}

// seedGovernorFromOpenClusters initializes the MRU/visible/applied state from the
// currently open clusters and settles them to the policy's tiers. Called once the
// initial subsystems have been built+started. The first open cluster is treated
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
	// Mark every open cluster as currently Foreground: the initial build path
	// already started them all fully, so reconcile only needs to DEMOTE the ones
	// the policy wants Background/Cold (idempotent for the visible one).
	for id := range open {
		a.governorApplied[id] = system.TierForeground
	}
	a.governorMu.Unlock()

	a.reconcileGovernor()
}

// startGovernorPressureLoop periodically samples heap usage and flips the
// memory-pressure signal, reconciling when it changes so non-visible clusters are
// shed under pressure and re-warmed when it clears. It stops when ctx is
// cancelled (bound to the refresh context, so no goroutine leak on shutdown).
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
			underPressure := stats.HeapInuse > budget

			a.governorMu.Lock()
			changed := underPressure != a.governorPressure
			a.governorPressure = underPressure
			a.governorMu.Unlock()

			if changed {
				a.reconcileGovernor()
			}
		}
	}
}
