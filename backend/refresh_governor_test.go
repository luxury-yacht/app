package backend

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type coldPreparationSnapshotService struct {
	mu             sync.Mutex
	namespaceReady bool
	calls          []string
}

type blockingColdPreparationSnapshotService struct {
	started  chan struct{}
	canceled chan struct{}
	once     sync.Once
}

func (s *blockingColdPreparationSnapshotService) Build(ctx context.Context, _, _ string) (*refresh.Snapshot, error) {
	s.once.Do(func() { close(s.started) })
	<-ctx.Done()
	close(s.canceled)
	return nil, ctx.Err()
}

type failingColdPreparationSnapshotService struct {
	calls chan struct{}
}

func (s *failingColdPreparationSnapshotService) Build(context.Context, string, string) (*refresh.Snapshot, error) {
	s.calls <- struct{}{}
	return nil, errors.New("sources have not settled")
}

// coldPreparationNamespaceSource models the current subsystem's namespace
// workload stores independently from the aggregate cluster lifecycle. A rebuilt
// subsystem starts unsynced even when the lifecycle still carries Ready from
// the subsystem it replaced.
type coldPreparationNamespaceSource struct {
	mu     sync.Mutex
	synced bool
}

func (s *coldPreparationNamespaceSource) Tracks(gvr schema.GroupVersionResource) bool {
	return gvr == snapshot.PodGVR
}

func (s *coldPreparationNamespaceSource) HasSyncedFor(schema.GroupVersionResource) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.synced
}

func (s *coldPreparationNamespaceSource) RawHasSyncedFor(gvr schema.GroupVersionResource) bool {
	return s.HasSyncedFor(gvr)
}

func (s *coldPreparationNamespaceSource) PermissionSkippedFor(schema.GroupVersionResource) bool {
	return false
}

func (s *coldPreparationNamespaceSource) CatalogRows(schema.GroupVersionResource) []interface{} {
	return nil
}

func (s *coldPreparationNamespaceSource) AggregateRows(schema.GroupVersionResource) []interface{} {
	return nil
}

func (s *coldPreparationNamespaceSource) ObjectMapRows(schema.GroupVersionResource) []interface{} {
	return nil
}

func (s *coldPreparationNamespaceSource) setSynced(synced bool) {
	s.mu.Lock()
	s.synced = synced
	s.mu.Unlock()
}

func (s *coldPreparationSnapshotService) Build(_ context.Context, domainName, scope string) (*refresh.Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, domainName+"@"+scope)
	switch domainName {
	case "namespaces":
		return &refresh.Snapshot{
			Domain: domainName,
			Scope:  scope,
			Payload: snapshot.NamespaceSnapshot{
				WorkloadReadiness: map[bool]snapshot.NamespaceWorkloadReadiness{false: snapshot.NamespaceWorkloadPending, true: snapshot.NamespaceWorkloadReady}[s.namespaceReady],
			},
		}, nil
	case "cluster-overview":
		return &refresh.Snapshot{
			Domain:  domainName,
			Scope:   scope,
			Payload: snapshot.ClusterOverviewSnapshot{},
		}, nil
	default:
		return nil, nil
	}
}

func (s *coldPreparationSnapshotService) callsSnapshot() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.calls...)
}

func keepGovernorForeground(app *workspaceCoordinatorTestFixture, clusterID string) {
	app.Refresh.governorVisible = clusterID
	app.Refresh.governorMRU = []string{clusterID}
	app.Refresh.governorApplied = map[string]system.ResourceTier{clusterID: system.TierForeground}
}

func governorAppliedTier(app *workspaceCoordinatorTestFixture, clusterID string) system.ResourceTier {
	app.Refresh.governorMu.Lock()
	defer app.Refresh.governorMu.Unlock()
	return app.Refresh.governorApplied[clusterID]
}

type blockingGovernorExecutor struct {
	teardownStarted  chan struct{}
	allowTeardown    chan struct{}
	teardownFinished chan struct{}
	ensureStarted    chan struct{}
}

func newBlockingGovernorExecutor() *blockingGovernorExecutor {
	return &blockingGovernorExecutor{
		teardownStarted:  make(chan struct{}),
		allowTeardown:    make(chan struct{}),
		teardownFinished: make(chan struct{}),
		ensureStarted:    make(chan struct{}),
	}
}

func (e *blockingGovernorExecutor) ensureRunning(string) bool {
	close(e.ensureStarted)
	return true
}

func (e *blockingGovernorExecutor) teardown(string) bool {
	close(e.teardownStarted)
	<-e.allowTeardown
	close(e.teardownFinished)
	return true
}

// recordingGovernorExecutor captures the transitions reconcile dispatches so the
// pure decision-to-action wiring can be asserted without real subsystems.
type recordingGovernorExecutor struct {
	ensured   map[string]bool
	tornDown  []string
	ensureSeq []string
}

func newRecordingGovernorExecutor() *recordingGovernorExecutor {
	return &recordingGovernorExecutor{ensured: map[string]bool{}}
}

func (r *recordingGovernorExecutor) ensureRunning(clusterID string) bool {
	r.ensured[clusterID] = true
	r.ensureSeq = append(r.ensureSeq, clusterID)
	return true
}

func (r *recordingGovernorExecutor) teardown(clusterID string) bool {
	r.tornDown = append(r.tornDown, clusterID)
	return true
}

// governorTestApp returns an app whose open-cluster set is exactly the supplied
// live cluster runtimes, with the governor initialised and a known visible cluster.
func governorTestApp(t *testing.T, selections []kubeconfigSelection, keepWarm int) (*workspaceCoordinatorTestFixture, []string) {
	t.Helper()
	app := newWorkspaceCoordinatorTestFixture(t)
	app.Refresh.initGovernor()
	app.Refresh.governorPolicy = system.GovernorPolicy{KeepWarm: keepWarm}

	// Register discovery metadata first so clusterMetaForSelection derives the same
	// stable IDs as the runtime entries consumed by RefreshCoordinator.
	available := make([]KubeconfigInfo, 0, len(selections))
	selStrings := make([]string, 0, len(selections))
	for _, sel := range selections {
		// Name must be non-empty so clusterMetaForSelection yields a stable,
		// distinguishable ID ("name:context") for registered selections.
		available = append(available, KubeconfigInfo{Name: sel.Context, Path: sel.Path, Context: sel.Context})
		selStrings = append(selStrings, sel.String())
	}
	app.ClusterRuntime.availableKubeconfigs = available

	clusterIDs := make([]string, 0, len(selections))
	for _, sel := range selections {
		meta := app.ClusterRuntime.clusterMetaForSelection(sel)
		clusterIDs = append(clusterIDs, meta.ID)
		app.ClusterRuntime.clusterClients[meta.ID] = &clusterClients{
			meta:              meta,
			kubeconfigPath:    sel.Path,
			kubeconfigContext: sel.Context,
		}
	}
	app.Workspace.selectedKubeconfigs = selStrings
	return app, clusterIDs
}

func TestReconcileGovernorColdStartTiers(t *testing.T) {
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
		{Path: "/p/c", Context: "c"},
	}
	app, ids := governorTestApp(t, selections, 1) // keepWarm=1
	a, b, c := ids[0], ids[1], ids[2]

	// Visible = a, MRU = [a,b,c]. Nothing applied yet (cold start).
	app.Refresh.governorVisible = a
	app.Refresh.governorMRU = []string{a, b, c}

	exec := newRecordingGovernorExecutor()
	app.Refresh.reconcileGovernorWith(exec)

	// Foreground and Background stay running; Cold is torn down.
	require.True(t, exec.ensured[a])
	require.True(t, exec.ensured[b])
	require.NotContains(t, exec.ensureSeq, c, "cold cluster not started")
	require.Equal(t, []string{c}, exec.tornDown, "cold cluster torn down")

	// Applied tiers recorded for idempotency.
	require.Equal(t, system.TierForeground, app.Refresh.governorApplied[a])
	require.Equal(t, system.TierBackground, app.Refresh.governorApplied[b])
	require.Equal(t, system.TierCold, app.Refresh.governorApplied[c])
}

func TestGovernorDoesNotCoolBeforeColdServingSnapshotsAreReady(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateLoading)

	service := &coldPreparationSnapshotService{namespaceReady: false}
	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: service,
	}
	app.Refresh.setRefreshSubsystem("cluster-a", subsystem)

	app.Refresh.realGovernorExecutor().teardown("cluster-a")

	require.False(t, subsystem.Cooled,
		"a cluster without a settled retained baseline must remain live")
	require.Empty(t, service.callsSnapshot())
}

func TestColdPreparationDoesNotPollSnapshotsWhileNamespaceLifecycleIsLoading(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	keepGovernorForeground(app, "cluster-a")
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateLoading)

	service := &coldPreparationSnapshotService{namespaceReady: false}
	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: service,
	}
	app.Refresh.setRefreshSubsystem("cluster-a", subsystem)

	app.Refresh.realGovernorExecutor().teardown("cluster-a")
	time.Sleep(2 * coldPreparationRetryInterval)

	require.Empty(t, service.callsSnapshot(),
		"the existing server lifecycle owns namespace readiness; Cold preparation must not poll namespace snapshots")
	require.False(t, subsystem.ColdServingReady())
}

func TestReconcileGovernorDoesNotRecordDeferredColdTransitionAsApplied(t *testing.T) {
	selections := []kubeconfigSelection{{Path: "/p/a", Context: "a"}}
	app, ids := governorTestApp(t, selections, 0)
	clusterID := ids[0]
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	app.Refresh.governorMRU = []string{clusterID}
	app.Refresh.governorApplied[clusterID] = system.TierBackground
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState(clusterID, ClusterStateLoading)

	service := &coldPreparationSnapshotService{namespaceReady: false}
	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: service,
	}
	app.Refresh.setRefreshSubsystem(clusterID, subsystem)

	app.Refresh.reconcileGovernorWith(app.Refresh.realGovernorExecutor())

	require.Equal(t, system.TierBackground, app.Refresh.governorApplied[clusterID],
		"the applied tier must describe the still-live subsystem while cold preparation is pending")
	require.False(t, subsystem.Cooled)
}

func TestColdPreparationUsesAggregateLifecycleBeforeCooling(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	keepGovernorForeground(app, "cluster-a")
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateLoading)

	service := &coldPreparationSnapshotService{namespaceReady: true}
	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: service,
	}
	app.Refresh.setRefreshSubsystem("cluster-a", subsystem)
	aggregate := newAggregateSnapshotService(
		[]string{"cluster-a"},
		map[string]*system.Subsystem{"cluster-a": subsystem},
	)
	aggregate.onNamespaceSnapshot = func(clusterID string, readiness snapshot.NamespaceWorkloadReadiness) {
		if readiness != snapshot.NamespaceWorkloadReady {
			return
		}
		state := app.ClusterRuntime.clusterLifecycle.GetState(clusterID)
		if state == ClusterStateLoading || state == ClusterStateLoadingSlow {
			app.ClusterRuntime.clusterLifecycle.SetState(clusterID, ClusterStateReady)
		}
	}
	app.Refresh.refreshAggregates.Store(&refreshAggregateHandlers{snapshot: aggregate})

	app.Refresh.realGovernorExecutor().teardown("cluster-a")
	runNamespacesReadinessSelfBuild(app.ClusterRuntime.clusterLifecycle, aggregate, "cluster-a")

	require.Eventually(t, func() bool {
		return app.ClusterRuntime.clusterLifecycle.GetState("cluster-a") == ClusterStateReady
	}, time.Second, 10*time.Millisecond,
		"cold preparation must cross the same server lifecycle gate as a normal namespace snapshot")
	require.Eventually(t, subsystem.ColdServingReady, time.Second, 10*time.Millisecond)
}

func TestColdPreparationBuildsExactRetainedScopesBeforeCooling(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	keepGovernorForeground(app, "cluster-a")
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)

	service := &coldPreparationSnapshotService{namespaceReady: true}
	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: service,
	}
	app.Refresh.setRefreshSubsystem("cluster-a", subsystem)

	require.False(t, app.Refresh.realGovernorExecutor().teardown("cluster-a"),
		"the first transition starts preparation instead of stopping producers")
	require.Eventually(t, subsystem.ColdServingReady, time.Second, 10*time.Millisecond)
	require.Equal(t, []string{
		"cluster-overview@cluster-a|",
	}, service.callsSnapshot())
}

func TestColdPreparationRequiresCurrentSubsystemWorkloadReadiness(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	keepGovernorForeground(app, "cluster-a")
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	// Ready may have been set by the subsystem this one replaced.
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)

	service := &coldPreparationSnapshotService{namespaceReady: true}
	source := &coldPreparationNamespaceSource{}
	subsystem := &system.Subsystem{
		Registry:          domain.New(),
		SnapshotService:   service,
		NamespaceNotifier: snapshot.NewNamespaceChangeNotifier(source, snapshot.NewNamespaceWorkloadTracker(source)),
	}
	app.Refresh.setRefreshSubsystem("cluster-a", subsystem)

	app.Refresh.realGovernorExecutor().teardown("cluster-a")
	time.Sleep(2 * coldPreparationRetryInterval)

	require.Empty(t, service.callsSnapshot(),
		"an old aggregate Ready state must not authorize cooling the current unsynced subsystem")
	require.False(t, subsystem.ColdServingReady())

	source.setSynced(true)
	require.Eventually(t, subsystem.ColdServingReady, time.Second, 10*time.Millisecond,
		"preparation must continue after the current subsystem really syncs")
	require.Equal(t, []string{"cluster-overview@cluster-a|"}, service.callsSnapshot())
}

func TestColdPreparationContinuesWhenNamespaceSourcesBecomeReady(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	keepGovernorForeground(app, "cluster-a")
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateLoading)

	service := &coldPreparationSnapshotService{namespaceReady: false}
	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: service,
	}
	app.Refresh.setRefreshSubsystem("cluster-a", subsystem)

	app.Refresh.realGovernorExecutor().teardown("cluster-a")
	time.Sleep(2 * coldPreparationRetryInterval)
	require.NotContains(t, service.callsSnapshot(), "cluster-overview@cluster-a|",
		"overview must not be retained while namespace workload sources are unsettled")
	require.False(t, subsystem.ColdServingReady())

	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)
	require.Eventually(t, subsystem.ColdServingReady, time.Second, 10*time.Millisecond,
		"the same server-owned preparation must continue once sources settle")
	require.Contains(t, service.callsSnapshot(), "cluster-overview@cluster-a|")
}

func TestReplacingSubsystemCancelsInFlightColdPreparationBuild(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)

	service := &blockingColdPreparationSnapshotService{
		started:  make(chan struct{}),
		canceled: make(chan struct{}),
	}
	previous := &system.Subsystem{SnapshotService: service}
	app.Refresh.setRefreshSubsystem("cluster-a", previous)
	app.Refresh.realGovernorExecutor().teardown("cluster-a")

	select {
	case <-service.started:
	case <-time.After(time.Second):
		t.Fatal("cold preparation build did not start")
	}
	app.Refresh.swapRefreshSubsystem("cluster-a", &system.Subsystem{})

	select {
	case <-service.canceled:
	case <-time.After(time.Second):
		t.Fatal("replacing the subsystem did not cancel its in-flight cold preparation build")
	}
}

func TestColdPreparationRetryStopsWhenSubsystemIsNoLongerCurrent(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateReady)

	service := &failingColdPreparationSnapshotService{calls: make(chan struct{}, 4)}
	previous := &system.Subsystem{SnapshotService: service}
	app.Refresh.setRefreshSubsystem("cluster-a", previous)
	app.Refresh.realGovernorExecutor().teardown("cluster-a")

	select {
	case <-service.calls:
	case <-time.After(time.Second):
		t.Fatal("cold preparation build did not start")
	}
	// Direct replacement deliberately bypasses swap cancellation so this test
	// independently pins the retry loop's current-generation check.
	app.Refresh.setRefreshSubsystem("cluster-a", &system.Subsystem{})

	select {
	case <-service.calls:
		t.Fatal("obsolete subsystem issued another cold preparation build")
	case <-time.After(2 * coldPreparationRetryInterval):
	}
}

func TestReconcileGovernorAppliesColdAfterRetainedBaselineIsReady(t *testing.T) {
	selections := []kubeconfigSelection{{Path: "/p/a", Context: "a"}}
	app, ids := governorTestApp(t, selections, 0)
	clusterID := ids[0]
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	app.Refresh.governorMRU = []string{clusterID}
	app.Refresh.governorApplied[clusterID] = system.TierBackground
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState(clusterID, ClusterStateReady)

	service := &coldPreparationSnapshotService{namespaceReady: true}
	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: service,
	}
	app.Refresh.setRefreshSubsystem(clusterID, subsystem)

	app.Refresh.reconcileGovernorWith(app.Refresh.realGovernorExecutor())
	require.Equal(t, system.TierBackground, governorAppliedTier(app, clusterID))

	require.Eventually(t, func() bool {
		return governorAppliedTier(app, clusterID) == system.TierCold
	}, time.Second, 10*time.Millisecond,
		"the retained-baseline completion must retry and finish the deferred transition")
	require.True(t, subsystem.Cooled)
}

func TestReconcileGovernorIdempotentNoOp(t *testing.T) {
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
	}
	app, ids := governorTestApp(t, selections, 1)
	a, b := ids[0], ids[1]

	app.Refresh.governorVisible = a
	app.Refresh.governorMRU = []string{a, b}
	// Already at the tiers the policy would assign.
	app.Refresh.governorApplied = map[string]system.ResourceTier{
		a: system.TierForeground,
		b: system.TierBackground,
	}

	exec := newRecordingGovernorExecutor()
	app.Refresh.reconcileGovernorWith(exec)

	require.Empty(t, exec.ensureSeq, "no rebuilds when already at desired tier")
	require.Empty(t, exec.tornDown, "no teardowns when already at desired tier")
}

func TestReconcileGovernorDoesNotPromoteClusterUntilItsInFlightCoolingFinishes(t *testing.T) {
	selections := []kubeconfigSelection{{Path: "/p/a", Context: "a"}}
	app, ids := governorTestApp(t, selections, 0)
	clusterID := ids[0]

	// The cluster is open but not visible, so the first reconciliation cools it.
	app.Refresh.governorMRU = []string{clusterID}
	app.Refresh.governorApplied = map[string]system.ResourceTier{clusterID: system.TierBackground}

	exec := newBlockingGovernorExecutor()
	firstDone := make(chan struct{})
	go func() {
		app.Refresh.reconcileGovernorWith(exec)
		close(firstDone)
	}()
	<-exec.teardownStarted

	// The user returns to the cluster while cooling is still between stopping the
	// feeds and publishing the cooled state.
	app.Refresh.governorMu.Lock()
	app.Refresh.governorVisible = clusterID
	app.Refresh.governorMRU = moveToFront(app.Refresh.governorMRU, clusterID)
	app.Refresh.governorMu.Unlock()

	secondDone := make(chan struct{})
	go func() {
		app.Refresh.reconcileGovernorWith(exec)
		close(secondDone)
	}()

	select {
	case <-exec.ensureStarted:
		t.Fatal("foreground promotion ran before the in-flight cooling action finished")
	case <-time.After(100 * time.Millisecond):
	}

	close(exec.allowTeardown)
	<-firstDone
	<-secondDone

	select {
	case <-exec.ensureStarted:
	case <-time.After(time.Second):
		t.Fatal("foreground promotion did not run after cooling finished")
	}
}

func TestReconcileGovernorPromotionKeepsBothWarmClustersRunning(t *testing.T) {
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
	}
	app, ids := governorTestApp(t, selections, 1)
	a, b := ids[0], ids[1]

	// Switch visible from a to b. b was Background, a was Foreground.
	app.Refresh.governorVisible = b
	app.Refresh.governorMRU = []string{b, a}
	app.Refresh.governorApplied = map[string]system.ResourceTier{
		a: system.TierForeground,
		b: system.TierBackground,
	}

	exec := newRecordingGovernorExecutor()
	app.Refresh.reconcileGovernorWith(exec)

	// Promotion/demotion changes tiers without tying metrics demand to visibility.
	require.True(t, exec.ensured[b], "new visible cluster stays running")
	require.True(t, exec.ensured[a], "old visible cluster stays warm")
	require.Empty(t, exec.tornDown, "keepWarm=1 keeps both warm")
}

func TestGovernorTierTransitionDoesNotOverrideLeaseDrivenMetricsDemand(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	poller := &recordingMetricsPoller{}
	app.Refresh.setRefreshSubsystem("cluster-a", metricsSubsystem(poller))

	app.Refresh.realGovernorExecutor().ensureRunning("cluster-a")

	require.Empty(t, poller.active, "governor visibility must not create metrics demand")
}

func TestReconcileGovernorMemoryPressureCoolsNonVisible(t *testing.T) {
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
		{Path: "/p/c", Context: "c"},
	}
	app, ids := governorTestApp(t, selections, 5) // generous warm budget...
	a, b, c := ids[0], ids[1], ids[2]

	app.Refresh.governorVisible = a
	app.Refresh.governorMRU = []string{a, b, c}
	app.Refresh.governorApplied = map[string]system.ResourceTier{
		a: system.TierForeground,
		b: system.TierBackground,
		c: system.TierBackground,
	}
	app.Refresh.governorPressure = true // ...collapsed to 0 under pressure

	exec := newRecordingGovernorExecutor()
	app.Refresh.reconcileGovernorWith(exec)

	require.True(t, app.Refresh.governorPressure, "pressure flag preserved across reconcile")
	tornDown := append([]string(nil), exec.tornDown...)
	sort.Strings(tornDown)
	want := []string{b, c}
	sort.Strings(want)
	require.Equal(t, want, tornDown, "under pressure every non-visible cluster is cooled")
	require.NotContains(t, exec.ensureSeq, b)
	require.NotContains(t, exec.ensureSeq, c)
}

func TestColdPreparationIsNotForcedWithoutMemoryPressure(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState("cluster-a", ClusterStateLoading)
	now := time.Now()
	app.Refresh.governorNow = func() time.Time { return now }

	subsystem := &system.Subsystem{
		Registry:        domain.New(),
		SnapshotService: &coldPreparationSnapshotService{},
	}
	app.Refresh.setRefreshSubsystem("cluster-a", subsystem)
	require.False(t, app.Refresh.realGovernorExecutor().teardown("cluster-a"))

	now = now.Add(coldPreparationPressureGrace + time.Second)
	require.False(t, app.Refresh.realGovernorExecutor().teardown("cluster-a"))
	require.Same(t, subsystem, app.Refresh.getRefreshSubsystem("cluster-a"),
		"elapsed preparation alone must not weaken the retained-baseline rule")
}

func TestSustainedMemoryPressureForcesFullTeardownAfterColdPreparationGrace(t *testing.T) {
	selections := []kubeconfigSelection{{Path: "/p/a", Context: "a"}}
	app, ids := governorTestApp(t, selections, 5)
	clusterID := ids[0]
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	setRefreshRuntimeContextForTest(app.Refresh, ctx)
	app.Refresh.spillRoot = t.TempDir()
	app.Refresh.governorBudget = 1
	app.Refresh.governorMRU = []string{clusterID}
	app.Refresh.governorApplied[clusterID] = system.TierBackground
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(nil)
	app.ClusterRuntime.clusterLifecycle.SetState(clusterID, ClusterStateLoading)
	now := time.Now()
	app.Refresh.governorNow = func() time.Time { return now }

	reg := domain.New()
	reg.RegisterMaintainedStore("cluster-overview", &spillFake{rows: []string{"retained"}})
	subsystem := &system.Subsystem{
		Registry:        reg,
		SnapshotService: &coldPreparationSnapshotService{},
	}
	app.Refresh.setRefreshSubsystem(clusterID, subsystem)
	done := make(chan struct{}, 1)
	done <- struct{}{}
	app.Refresh.storeObjectCatalogEntry(clusterID, &objectCatalogEntry{
		service: &objectcatalog.Service{},
		cancel:  func() {},
		done:    done,
	})

	app.Refresh.handleGovernorPressureSample(2)
	require.Same(t, subsystem, app.Refresh.getRefreshSubsystem(clusterID),
		"the first pressure sample starts preparation without discarding live data")

	now = now.Add(coldPreparationPressureGrace - time.Second)
	app.Refresh.handleGovernorPressureSample(2)
	require.Same(t, subsystem, app.Refresh.getRefreshSubsystem(clusterID),
		"sustained pressure must respect the bounded preparation grace")

	now = now.Add(2 * time.Second)
	app.Refresh.handleGovernorPressureSample(2)
	require.Nil(t, app.Refresh.getRefreshSubsystem(clusterID),
		"an unchanged pressure signal must re-drive and eventually force full teardown")
	require.Nil(t, app.Refresh.objectCatalogServiceForCluster(clusterID))

	spillDir, err := app.Refresh.clusterSpillDir(clusterID)
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(spillDir, "cluster-overview.spill"))
	require.NoError(t, err, "forced teardown must preserve the normal spill path")

	entries := app.AppLogs.logger.GetEntries()
	forcedLogs := 0
	for _, entry := range entries {
		if entry.ClusterID == clusterID &&
			strings.Contains(entry.Message, "forcing full teardown") &&
			strings.Contains(entry.Message, "heap in use: 2 bytes") {
			forcedLogs++
		}
	}
	require.Equal(t, 1, forcedLogs,
		"forced teardown must emit exactly one cluster-scoped diagnostic with heap use")
	require.Condition(t, func() bool {
		for _, entry := range entries {
			if entry.ClusterID == clusterID && strings.Contains(entry.Message, "Tearing down subsystem") {
				return true
			}
		}
		return false
	}, "forced pressure fallback must route through the normal full-teardown lifecycle")
}

func TestReconcileGovernorDropsClosedClusterTier(t *testing.T) {
	// Only a and b are open; c was previously tiered but is now closed.
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
	}
	app, ids := governorTestApp(t, selections, 2)
	a, b := ids[0], ids[1]
	closedC := app.ClusterRuntime.clusterMetaForSelection(kubeconfigSelection{Path: "/p/c", Context: "c"}).ID

	app.Refresh.governorVisible = a
	app.Refresh.governorMRU = []string{a, b, closedC}
	app.Refresh.governorApplied = map[string]system.ResourceTier{
		a:       system.TierForeground,
		b:       system.TierBackground,
		closedC: system.TierBackground,
	}

	exec := newRecordingGovernorExecutor()
	app.Refresh.reconcileGovernorWith(exec)

	// The closed cluster is removed from MRU and applied state; the governor does
	// NOT tear it down (the connection lifecycle owns that).
	require.NotContains(t, app.Refresh.governorMRU, closedC)
	_, stillApplied := app.Refresh.governorApplied[closedC]
	require.False(t, stillApplied)
	require.NotContains(t, exec.tornDown, closedC)
}

func TestMoveToFront(t *testing.T) {
	require.Equal(t, []string{"y", "x"}, moveToFront([]string{"x", "y"}, "y"))
	require.Equal(t, []string{"z", "x", "y"}, moveToFront([]string{"x", "y"}, "z"))
	require.Equal(t, []string{"x"}, moveToFront(nil, "x"))
	require.Equal(t, []string{"x", "y"}, moveToFront([]string{"x", "y", "x"}, "x"))
}

func TestSetVisibleClusterMovesToFrontOfMRU(t *testing.T) {
	// Both clusters open so reconcile does not prune them; the assertion is that
	// the visible cluster moves to the front of the MRU.
	selections := []kubeconfigSelection{
		{Path: "/p/x", Context: "x"},
		{Path: "/p/y", Context: "y"},
	}
	app, ids := governorTestApp(t, selections, 2)
	x, y := ids[0], ids[1]
	app.Refresh.governorMRU = []string{x, y}

	app.Refresh.SetVisibleCluster(y)

	require.Equal(t, y, app.Refresh.governorVisible)
	require.Equal(t, []string{y, x}, app.Refresh.governorMRU)
}

func TestSetVisibleClusterReplaysCurrentLifecycleState(t *testing.T) {
	selections := []kubeconfigSelection{{Path: "/p/x", Context: "x"}}
	app, ids := governorTestApp(t, selections, 0)
	clusterID := ids[0]

	type lifecycleEvent struct {
		clusterID string
		state     ClusterLifecycleState
		previous  ClusterLifecycleState
	}
	var events []lifecycleEvent
	app.ClusterRuntime.clusterLifecycle = newClusterLifecycle(func(clusterID string, state, previous ClusterLifecycleState) {
		events = append(events, lifecycleEvent{clusterID: clusterID, state: state, previous: previous})
	})
	app.ClusterRuntime.clusterLifecycle.SetState(clusterID, ClusterStateReady)
	events = nil

	// The backend may already be ready while the frontend still holds an older
	// connected event. Activating the tab is the deterministic convergence point:
	// it must replay the current state even though no lifecycle transition occurs.
	app.Refresh.governorVisible = clusterID
	app.Refresh.governorMRU = []string{clusterID}
	app.Refresh.governorApplied[clusterID] = system.TierForeground
	app.Refresh.SetVisibleCluster(clusterID)

	require.Equal(t, []lifecycleEvent{{
		clusterID: clusterID,
		state:     ClusterStateReady,
		previous:  ClusterStateReady,
	}}, events)
}
