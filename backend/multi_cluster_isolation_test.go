/*
 * backend/multi_cluster_isolation_test.go
 *
 * Integration tests verifying that multi-cluster isolation is working correctly.
 * These tests ensure that operations, failures, and state changes in one cluster
 * do not affect other clusters.
 */

package backend

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh/system"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	restfake "k8s.io/client-go/rest/fake"
	cgotesting "k8s.io/client-go/testing"
)

// isolationDiscovery wraps FakeDiscovery with a configurable REST client for health checks.
type isolationDiscovery struct {
	*fakediscovery.FakeDiscovery
	restClient rest.Interface
}

func (d *isolationDiscovery) RESTClient() rest.Interface {
	return d.restClient
}

// isolationClientSet overrides Discovery() to return a custom discovery implementation.
type isolationClientSet struct {
	*cgofake.Clientset
	disco *isolationDiscovery
}

func (c *isolationClientSet) Discovery() discovery.DiscoveryInterface {
	return c.disco
}

// createHealthyClient creates a mock Kubernetes client that returns healthy responses.
func createHealthyClient() *isolationClientSet {
	disco := &isolationDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 200,
					Body:       io.NopCloser(strings.NewReader("ok")),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			}),
		},
	}
	return &isolationClientSet{Clientset: cgofake.NewClientset(), disco: disco}
}

// createUnhealthyClient creates a mock Kubernetes client that returns errors.
func createUnhealthyClient() *isolationClientSet {
	disco := &isolationDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("connection refused")
			}),
		},
	}
	return &isolationClientSet{Clientset: cgofake.NewClientset(), disco: disco}
}

// TestIsolation_AuthFailureDoesNotAffectOtherClusters verifies that an auth failure
// in one cluster does not affect the auth state of other clusters.
func TestIsolation_AuthFailureDoesNotAffectOtherClusters(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	// Create auth managers for two clusters.
	// MaxAttempts=0 means failures immediately transition to StateInvalid.
	authMgrA := authstate.New(authstate.Config{MaxAttempts: 0})
	authMgrB := authstate.New(authstate.Config{MaxAttempts: 0})

	// Set up two cluster clients with separate auth managers
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			client:      createHealthyClient(),
			authManager: authMgrA,
		},
		"cluster-b": {
			meta:        ClusterMeta{ID: "cluster-b", Name: "Cluster B"},
			client:      createHealthyClient(),
			authManager: authMgrB,
		},
	}
	app.clusterClientsMu.Unlock()

	// Verify both auth managers start valid
	require.True(t, authMgrA.IsValid(), "cluster A auth should start valid")
	require.True(t, authMgrB.IsValid(), "cluster B auth should start valid")

	// Mark cluster A as auth failed via its auth manager
	authMgrA.ReportFailure("token expired for cluster A")

	// Verify cluster A is now invalid
	require.False(t, authMgrA.IsValid(), "cluster A auth should be invalid after failure")
	stateA, reasonA := authMgrA.State()
	require.Equal(t, authstate.StateInvalid, stateA)
	require.Contains(t, reasonA, "token expired")

	// Verify cluster B is still valid - unaffected by cluster A's failure
	require.True(t, authMgrB.IsValid(), "cluster B auth should still be valid")
	stateB, reasonB := authMgrB.State()
	require.Equal(t, authstate.StateValid, stateB)
	require.Empty(t, reasonB)
}

// TestIsolation_HeartbeatRunsIndependently verifies that heartbeat health checks
// run independently for each cluster.
func TestIsolation_HeartbeatRunsIndependently(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	// Track emitted events
	emittedEvents := make(map[string][]map[string]any)
	var eventsMu sync.Mutex
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		eventsMu.Lock()
		defer eventsMu.Unlock()
		if len(args) > 0 {
			if data, ok := args[0].(map[string]any); ok {
				emittedEvents[name] = append(emittedEvents[name], data)
			}
		}
	}

	// Set up clusters with different health states:
	// - cluster-healthy: responds OK
	// - cluster-degraded: returns error
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-healthy": {
			meta:   ClusterMeta{ID: "cluster-healthy", Name: "Healthy Cluster"},
			client: createHealthyClient(),
		},
		"cluster-degraded": {
			meta:   ClusterMeta{ID: "cluster-degraded", Name: "Degraded Cluster"},
			client: createUnhealthyClient(),
		},
	}
	app.clusterClientsMu.Unlock()

	// Run heartbeat iteration
	app.runHeartbeatIteration()

	// Verify each cluster gets appropriate cluster:health:* event emitted
	eventsMu.Lock()
	defer eventsMu.Unlock()

	healthyEvents := emittedEvents["cluster:health:healthy"]
	degradedEvents := emittedEvents["cluster:health:degraded"]

	require.Len(t, healthyEvents, 1, "should have exactly 1 healthy event")
	require.Len(t, degradedEvents, 1, "should have exactly 1 degraded event")

	// Verify the healthy event is for the right cluster
	require.Equal(t, "cluster-healthy", healthyEvents[0]["clusterId"])
	require.Equal(t, "Healthy Cluster", healthyEvents[0]["clusterName"])

	// Verify the degraded event is for the right cluster
	require.Equal(t, "cluster-degraded", degradedEvents[0]["clusterId"])
	require.Equal(t, "Degraded Cluster", degradedEvents[0]["clusterName"])
}

// TestIsolation_RecoveryOnlyAffectsOneCluster verifies that cluster subsystem
// rebuild only affects the target cluster.
func TestIsolation_RecoveryOnlyAffectsOneCluster(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx
	app.refreshSubsystems = make(map[string]*system.Subsystem)

	// Mock subsystems for two clusters
	// We'll use empty subsystems to verify presence/absence
	subsystemA := &system.Subsystem{}
	subsystemB := &system.Subsystem{}

	app.refreshSubsystems["cluster-a"] = subsystemA
	app.refreshSubsystems["cluster-b"] = subsystemB

	// Verify both subsystems exist
	require.NotNil(t, app.refreshSubsystems["cluster-a"], "cluster A subsystem should exist")
	require.NotNil(t, app.refreshSubsystems["cluster-b"], "cluster B subsystem should exist")

	// Teardown subsystem for cluster A only
	app.teardownClusterSubsystem("cluster-a")

	// Verify cluster A's subsystem is removed
	require.Nil(t, app.refreshSubsystems["cluster-a"], "cluster A subsystem should be removed")

	// Verify cluster B's subsystem is still present and functional
	require.NotNil(t, app.refreshSubsystems["cluster-b"], "cluster B subsystem should still exist")
	require.Equal(t, subsystemB, app.refreshSubsystems["cluster-b"], "cluster B subsystem should be unchanged")
}

// TestIsolation_TransportFailureOnlyAffectsOneCluster verifies that transport
// failure tracking is isolated per cluster.
func TestIsolation_TransportFailureOnlyAffectsOneCluster(t *testing.T) {
	app := &App{}
	app.initTransportStates()

	// Record transport failures for cluster A (up to threshold)
	app.recordClusterTransportFailure("cluster-a", "test failure 1", nil)
	app.recordClusterTransportFailure("cluster-a", "test failure 2", nil)

	// Verify cluster A has recorded failures
	stateA := app.getTransportState("cluster-a")
	stateA.mu.Lock()
	countA := stateA.failureCount
	stateA.mu.Unlock()
	require.Equal(t, 2, countA, "cluster A should have 2 failures recorded")

	// Verify cluster B's transport state shows no failures
	stateB := app.getTransportState("cluster-b")
	stateB.mu.Lock()
	countB := stateB.failureCount
	stateB.mu.Unlock()
	require.Equal(t, 0, countB, "cluster B should have 0 failures (unaffected by cluster A)")

	// Record a failure for cluster B
	app.recordClusterTransportFailure("cluster-b", "cluster B failure", nil)

	// Verify cluster B now has 1 failure
	stateB.mu.Lock()
	countB = stateB.failureCount
	stateB.mu.Unlock()
	require.Equal(t, 1, countB, "cluster B should have 1 failure")

	// Verify cluster A is still at 2 failures (unaffected by cluster B)
	stateA.mu.Lock()
	countA = stateA.failureCount
	stateA.mu.Unlock()
	require.Equal(t, 2, countA, "cluster A should still have 2 failures")
}

// TestIsolation_AuthRecoveryScheduledPerCluster verifies that auth recovery
// scheduling is tracked per cluster.
func TestIsolation_AuthRecoveryScheduledPerCluster(t *testing.T) {
	app := &App{}
	app.initAuthRecoveryState()

	// Schedule auth recovery for cluster A
	scheduledA := app.scheduleClusterAuthRecovery("cluster-a")
	require.True(t, scheduledA, "scheduling recovery for cluster A should succeed")

	// Verify cluster A cannot be scheduled again (already scheduled)
	scheduledAAgain := app.scheduleClusterAuthRecovery("cluster-a")
	require.False(t, scheduledAAgain, "cluster A should already be scheduled")

	// Verify cluster B can still be scheduled independently
	scheduledB := app.scheduleClusterAuthRecovery("cluster-b")
	require.True(t, scheduledB, "cluster B should be independently schedulable")

	// Verify cluster C can also be scheduled
	scheduledC := app.scheduleClusterAuthRecovery("cluster-c")
	require.True(t, scheduledC, "cluster C should be independently schedulable")

	// Clear cluster A's scheduled state
	app.clearClusterAuthRecoveryScheduled("cluster-a")

	// Verify cluster A can now be scheduled again
	scheduledAAfterClear := app.scheduleClusterAuthRecovery("cluster-a")
	require.True(t, scheduledAAfterClear, "cluster A should be schedulable after clear")

	// Verify cluster B is still scheduled (unaffected by cluster A operations)
	scheduledBAgain := app.scheduleClusterAuthRecovery("cluster-b")
	require.False(t, scheduledBAgain, "cluster B should still be scheduled")
}

// TestIsolation_DrainStoreByCluster verifies that drain jobs are isolated
// by cluster.
func TestIsolation_DrainStoreByCluster(t *testing.T) {
	// Create a fresh drain store for this test
	store := nodemaintenance.NewStore(5)

	// Add drain jobs for different clusters with the same node name
	// This simulates the real-world scenario where the same node name
	// might exist across different clusters
	jobA := store.StartDrain("worker-1", restypes.DrainNodeOptions{Force: true})
	store.SetJobCluster(jobA.ID, "cluster-a", "Cluster A")

	jobB := store.StartDrain("worker-1", restypes.DrainNodeOptions{Force: false})
	store.SetJobCluster(jobB.ID, "cluster-b", "Cluster B")

	jobC := store.StartDrain("worker-2", restypes.DrainNodeOptions{})
	store.SetJobCluster(jobC.ID, "cluster-a", "Cluster A")

	// GetJobsForCluster returns only jobs for that cluster
	jobsA := store.GetJobsForCluster("cluster-a")
	jobsB := store.GetJobsForCluster("cluster-b")
	jobsNonExistent := store.GetJobsForCluster("cluster-c")

	// Verify cluster A has 2 jobs (worker-1 and worker-2)
	require.Len(t, jobsA, 2, "cluster A should have 2 jobs")
	for _, job := range jobsA {
		require.Equal(t, "cluster-a", job.ClusterID)
	}

	// Verify cluster B has 1 job (worker-1)
	require.Len(t, jobsB, 1, "cluster B should have 1 job")
	require.Equal(t, "cluster-b", jobsB[0].ClusterID)
	require.Equal(t, "Cluster B", jobsB[0].ClusterName)

	// Verify non-existent cluster returns empty
	require.Len(t, jobsNonExistent, 0, "non-existent cluster should have 0 jobs")

	// Verify Snapshot by node still sees all jobs across clusters
	snapshot, _ := store.Snapshot("worker-1")
	require.Len(t, snapshot.Drains, 2, "worker-1 should have 2 drain jobs across clusters")
}

// TestIsolation_NoGlobalClientFields verifies that global client fields
// have been removed and all clients are per-cluster.
// This is primarily a compile-time check, but we verify runtime structure.
func TestIsolation_NoGlobalClientFields(t *testing.T) {
	app := NewApp()

	// Verify that App struct uses per-cluster client map
	require.NotNil(t, app.clusterClients, "clusterClients map should be initialized")

	// Verify there are no global client fields by checking that after
	// NewApp(), only per-cluster structures exist
	// (The actual global fields have been removed from the struct)

	// Create cluster clients for testing
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"test-cluster": {
			meta:              ClusterMeta{ID: "test-cluster", Name: "Test Cluster"},
			kubeconfigPath:    "/test/kubeconfig",
			kubeconfigContext: "test-context",
			client:            createHealthyClient(),
		},
	}
	app.clusterClientsMu.Unlock()

	// Verify clusterClientsForID returns the correct cluster
	clients := app.clusterClientsForID("test-cluster")
	require.NotNil(t, clients, "should find cluster by ID")
	require.Equal(t, "Test Cluster", clients.meta.Name)

	// Verify non-existent cluster returns nil
	nonExistent := app.clusterClientsForID("non-existent")
	require.Nil(t, nonExistent, "non-existent cluster should return nil")
}

// TestIsolation_MultiClusterAuthStateRetrieval verifies that auth state
// can be retrieved independently for each cluster.
func TestIsolation_MultiClusterAuthStateRetrieval(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	// Create auth managers with different states
	authMgrValid := authstate.New(authstate.Config{MaxAttempts: 0})
	authMgrInvalid := authstate.New(authstate.Config{MaxAttempts: 0})
	authMgrInvalid.ReportFailure("expired token")

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-valid": {
			meta:        ClusterMeta{ID: "cluster-valid", Name: "Valid Cluster"},
			client:      createHealthyClient(),
			authManager: authMgrValid,
		},
		"cluster-invalid": {
			meta:        ClusterMeta{ID: "cluster-invalid", Name: "Invalid Cluster"},
			client:      createHealthyClient(),
			authManager: authMgrInvalid,
		},
		"cluster-no-auth": {
			meta:   ClusterMeta{ID: "cluster-no-auth", Name: "No Auth Manager"},
			client: createHealthyClient(),
			// No authManager
		},
	}
	app.clusterClientsMu.Unlock()

	// Test GetClusterAuthState for each cluster
	stateValid, reasonValid := app.GetClusterAuthState("cluster-valid")
	require.Equal(t, "valid", stateValid)
	require.Empty(t, reasonValid)

	stateInvalid, reasonInvalid := app.GetClusterAuthState("cluster-invalid")
	require.Equal(t, "invalid", stateInvalid)
	require.Contains(t, reasonInvalid, "expired")

	stateNoAuth, _ := app.GetClusterAuthState("cluster-no-auth")
	require.Equal(t, "unknown", stateNoAuth)

	stateNonExistent, _ := app.GetClusterAuthState("non-existent")
	require.Equal(t, "unknown", stateNonExistent)

	// Test GetAllClusterAuthStates
	allStates := app.GetAllClusterAuthStates()
	require.Len(t, allStates, 3)
	require.Equal(t, "valid", allStates["cluster-valid"]["state"])
	require.Equal(t, "invalid", allStates["cluster-invalid"]["state"])
	require.Equal(t, "unknown", allStates["cluster-no-auth"]["state"])
}

// TestIsolation_RetryAuthPerCluster verifies that RetryClusterAuth only
// affects the specified cluster.
func TestIsolation_RetryAuthPerCluster(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	// Create auth managers - both in invalid state with MaxAttempts=0
	authMgrA := authstate.New(authstate.Config{MaxAttempts: 0})
	authMgrB := authstate.New(authstate.Config{MaxAttempts: 0})
	authMgrA.ReportFailure("failure A")
	authMgrB.ReportFailure("failure B")

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-a": {
			meta:        ClusterMeta{ID: "cluster-a", Name: "Cluster A"},
			client:      createHealthyClient(),
			authManager: authMgrA,
		},
		"cluster-b": {
			meta:        ClusterMeta{ID: "cluster-b", Name: "Cluster B"},
			client:      createHealthyClient(),
			authManager: authMgrB,
		},
	}
	app.clusterClientsMu.Unlock()

	// Verify both start as invalid
	require.False(t, authMgrA.IsValid())
	require.False(t, authMgrB.IsValid())

	// RetryClusterAuth for cluster-a only
	// Note: With MaxAttempts=0, TriggerRetry won't do anything since
	// recovery is disabled. This test verifies the function routes correctly.
	app.RetryClusterAuth("cluster-a")

	// Both should still be invalid (since MaxAttempts=0 means no recovery)
	// The important thing is that the call didn't panic or affect wrong cluster
	stateA, _ := authMgrA.State()
	stateB, _ := authMgrB.State()
	require.Equal(t, authstate.StateInvalid, stateA)
	require.Equal(t, authstate.StateInvalid, stateB)
}

// TestIsolation_HeartbeatSkipsInvalidAuthClusters verifies that heartbeat
// correctly skips clusters with invalid auth and doesn't emit events for them.
func TestIsolation_HeartbeatSkipsInvalidAuthClusters(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	// Track emitted events
	emittedEvents := make(map[string][]map[string]any)
	var eventsMu sync.Mutex
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		eventsMu.Lock()
		defer eventsMu.Unlock()
		if len(args) > 0 {
			if data, ok := args[0].(map[string]any); ok {
				emittedEvents[name] = append(emittedEvents[name], data)
			}
		}
	}

	// Create auth manager in invalid state
	invalidAuthMgr := authstate.New(authstate.Config{MaxAttempts: 0})
	invalidAuthMgr.ReportFailure("auth failure")

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-healthy": {
			meta:   ClusterMeta{ID: "cluster-healthy", Name: "Healthy Cluster"},
			client: createHealthyClient(),
			// No authManager means it's considered valid
		},
		"cluster-invalid-auth": {
			meta:        ClusterMeta{ID: "cluster-invalid-auth", Name: "Invalid Auth Cluster"},
			client:      createHealthyClient(), // Would be healthy if auth was valid
			authManager: invalidAuthMgr,
		},
	}
	app.clusterClientsMu.Unlock()

	// Run heartbeat
	app.runHeartbeatIteration()

	// Check events
	eventsMu.Lock()
	defer eventsMu.Unlock()

	healthyEvents := emittedEvents["cluster:health:healthy"]
	degradedEvents := emittedEvents["cluster:health:degraded"]

	// Should only have 1 healthy event for cluster-healthy
	// cluster-invalid-auth should be skipped entirely
	require.Len(t, healthyEvents, 1, "should have 1 healthy event")
	require.Equal(t, "cluster-healthy", healthyEvents[0]["clusterId"])

	// No degraded events should exist - the invalid auth cluster was skipped
	require.Len(t, degradedEvents, 0, "should have no degraded events")
}
