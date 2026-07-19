package backend

import (
	"sort"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

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

func (r *recordingGovernorExecutor) ensureRunning(clusterID string) {
	r.ensured[clusterID] = true
	r.ensureSeq = append(r.ensureSeq, clusterID)
}

func (r *recordingGovernorExecutor) teardown(clusterID string) {
	r.tornDown = append(r.tornDown, clusterID)
}

// governorTestApp returns an app whose open-cluster set is exactly the supplied
// selections, with the governor initialised and a known visible cluster.
func governorTestApp(t *testing.T, selections []kubeconfigSelection, keepWarm int) (*App, []string) {
	t.Helper()
	app := newTestAppWithDefaults(t)
	app.initGovernor()
	app.governorPolicy = system.GovernorPolicy{KeepWarm: keepWarm}

	// openClusterIDs derives the open set from selectedKubeconfigSelections, which
	// validates each selection against availableKubeconfigs. Register them FIRST so
	// the IDs derived here match those resolved during reconcile.
	available := make([]KubeconfigInfo, 0, len(selections))
	selStrings := make([]string, 0, len(selections))
	for _, sel := range selections {
		// Name must be non-empty so clusterMetaForSelection yields a stable,
		// distinguishable ID ("name:context") for registered selections.
		available = append(available, KubeconfigInfo{Name: sel.Context, Path: sel.Path, Context: sel.Context})
		selStrings = append(selStrings, sel.String())
	}
	app.availableKubeconfigs = available

	clusterIDs := make([]string, 0, len(selections))
	for _, sel := range selections {
		clusterIDs = append(clusterIDs, app.clusterMetaForSelection(sel).ID)
	}
	app.selectedKubeconfigs = selStrings
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
	app.governorVisible = a
	app.governorMRU = []string{a, b, c}

	exec := newRecordingGovernorExecutor()
	app.reconcileGovernorWith(exec)

	// Foreground and Background stay running; Cold is torn down.
	require.True(t, exec.ensured[a])
	require.True(t, exec.ensured[b])
	require.NotContains(t, exec.ensureSeq, c, "cold cluster not started")
	require.Equal(t, []string{c}, exec.tornDown, "cold cluster torn down")

	// Applied tiers recorded for idempotency.
	require.Equal(t, system.TierForeground, app.governorApplied[a])
	require.Equal(t, system.TierBackground, app.governorApplied[b])
	require.Equal(t, system.TierCold, app.governorApplied[c])
}

func TestReconcileGovernorIdempotentNoOp(t *testing.T) {
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
	}
	app, ids := governorTestApp(t, selections, 1)
	a, b := ids[0], ids[1]

	app.governorVisible = a
	app.governorMRU = []string{a, b}
	// Already at the tiers the policy would assign.
	app.governorApplied = map[string]system.ResourceTier{
		a: system.TierForeground,
		b: system.TierBackground,
	}

	exec := newRecordingGovernorExecutor()
	app.reconcileGovernorWith(exec)

	require.Empty(t, exec.ensureSeq, "no rebuilds when already at desired tier")
	require.Empty(t, exec.tornDown, "no teardowns when already at desired tier")
}

func TestReconcileGovernorPromotionKeepsBothWarmClustersRunning(t *testing.T) {
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
	}
	app, ids := governorTestApp(t, selections, 1)
	a, b := ids[0], ids[1]

	// Switch visible from a to b. b was Background, a was Foreground.
	app.governorVisible = b
	app.governorMRU = []string{b, a}
	app.governorApplied = map[string]system.ResourceTier{
		a: system.TierForeground,
		b: system.TierBackground,
	}

	exec := newRecordingGovernorExecutor()
	app.reconcileGovernorWith(exec)

	// Promotion/demotion changes tiers without tying metrics demand to visibility.
	require.True(t, exec.ensured[b], "new visible cluster stays running")
	require.True(t, exec.ensured[a], "old visible cluster stays warm")
	require.Empty(t, exec.tornDown, "keepWarm=1 keeps both warm")
}

func TestGovernorTierTransitionDoesNotOverrideLeaseDrivenMetricsDemand(t *testing.T) {
	app := newTestAppWithDefaults(t)
	poller := &recordingMetricsPoller{}
	app.setRefreshSubsystem("cluster-a", metricsSubsystem(poller))

	app.realGovernorExecutor().ensureRunning("cluster-a")

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

	app.governorVisible = a
	app.governorMRU = []string{a, b, c}
	app.governorApplied = map[string]system.ResourceTier{
		a: system.TierForeground,
		b: system.TierBackground,
		c: system.TierBackground,
	}
	app.governorPressure = true // ...collapsed to 0 under pressure

	exec := newRecordingGovernorExecutor()
	app.reconcileGovernorWith(exec)

	require.True(t, app.governorPressure, "pressure flag preserved across reconcile")
	tornDown := append([]string(nil), exec.tornDown...)
	sort.Strings(tornDown)
	want := []string{b, c}
	sort.Strings(want)
	require.Equal(t, want, tornDown, "under pressure every non-visible cluster is cooled")
	require.NotContains(t, exec.ensureSeq, b)
	require.NotContains(t, exec.ensureSeq, c)
}

func TestReconcileGovernorDropsClosedClusterTier(t *testing.T) {
	// Only a and b are open; c was previously tiered but is now closed.
	selections := []kubeconfigSelection{
		{Path: "/p/a", Context: "a"},
		{Path: "/p/b", Context: "b"},
	}
	app, ids := governorTestApp(t, selections, 2)
	a, b := ids[0], ids[1]
	closedC := app.clusterMetaForSelection(kubeconfigSelection{Path: "/p/c", Context: "c"}).ID

	app.governorVisible = a
	app.governorMRU = []string{a, b, closedC}
	app.governorApplied = map[string]system.ResourceTier{
		a:       system.TierForeground,
		b:       system.TierBackground,
		closedC: system.TierBackground,
	}

	exec := newRecordingGovernorExecutor()
	app.reconcileGovernorWith(exec)

	// The closed cluster is removed from MRU and applied state; the governor does
	// NOT tear it down (the connection lifecycle owns that).
	require.NotContains(t, app.governorMRU, closedC)
	_, stillApplied := app.governorApplied[closedC]
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
	app.governorMRU = []string{x, y}

	app.SetVisibleCluster(y)

	require.Equal(t, y, app.governorVisible)
	require.Equal(t, []string{y, x}, app.governorMRU)
}
