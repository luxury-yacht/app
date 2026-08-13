/*
 * backend/cluster_auth_test.go
 *
 * Tests for per-cluster auth subsystem rebuild wiring.
 */

package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

type recoveryStartInformerHub struct {
	started chan struct{}
	once    sync.Once
}

type blockingShutdownInformerHub struct {
	shutdownStarted chan struct{}
	releaseShutdown chan struct{}
	startOnce       sync.Once
	releaseOnce     sync.Once
}

func (*blockingShutdownInformerHub) Start(context.Context) error { return nil }
func (*blockingShutdownInformerHub) HasSynced(context.Context) bool {
	return true
}
func (*blockingShutdownInformerHub) ResourcesSettled([]string) bool { return true }
func (h *blockingShutdownInformerHub) Shutdown() error {
	h.startOnce.Do(func() { close(h.shutdownStarted) })
	<-h.releaseShutdown
	return nil
}

func (h *blockingShutdownInformerHub) release() {
	h.releaseOnce.Do(func() { close(h.releaseShutdown) })
}

func (h *recoveryStartInformerHub) Start(context.Context) error {
	h.once.Do(func() { close(h.started) })
	return nil
}

func (*recoveryStartInformerHub) HasSynced(context.Context) bool { return true }
func (*recoveryStartInformerHub) ResourcesSettled([]string) bool { return true }
func (*recoveryStartInformerHub) Shutdown() error                { return nil }

func (h *recoveryStartInformerHub) isStarted() bool {
	select {
	case <-h.started:
		return true
	default:
		return false
	}
}

// TestRebuildClusterSubsystemPreservesAuthManagerWiring reproduces the
// "zombie manager" failure: rebuildClusterSubsystem used to build new clients
// around a freshly created auth manager, shut that manager down, and swap the
// old manager onto the struct — leaving every rebuilt transport reporting to
// a dead manager. A 401 after any rebuild then blocked all traffic forever
// while the tracked manager stayed valid, so RetryClusterAuth was a no-op.
//
// The contract: after a rebuild, the clients stored for the cluster must
// track the SAME manager as before, and auth failures seen by the rebuilt
// transports must transition that manager.
func TestRebuildClusterSubsystemPreservesAuthManagerWiring(t *testing.T) {
	// The server rejects everything with 401: the rebuild's preflight check
	// reports the credential failure through the transport under test and
	// rebuildClusterSubsystem stops before building a refresh subsystem.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	app := newTestAppWithDefaults(t)
	setTestAppRuntimeReady(t, app, context.Background())
	app.clusterOps = newClusterOperationCoordinator()
	configPath := writeTestKubeconfig(t, server.URL)

	app.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: configPath, Context: "test-context"},
	}
	app.selectedKubeconfigs = []string{configPath + ":test-context"}

	meta := app.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "test-context"})
	require.NotEmpty(t, meta.ID)

	originalMgr := authstate.New(authstate.Config{MaxAttempts: 0})
	defer originalMgr.Shutdown()

	originalClients := &clusterClients{
		meta:              meta,
		kubeconfigPath:    configPath,
		kubeconfigContext: "test-context",
		authManager:       originalMgr,
	}
	app.clusterClients = map[string]*clusterClients{meta.ID: originalClients}

	app.rebuildClusterSubsystem(meta.ID)

	rebuilt := app.clusterClientsForID(meta.ID)
	require.NotNil(t, rebuilt)
	require.Same(t, originalClients, rebuilt,
		"a rebuild rejected by auth validation must leave the previous client generation installed")
	require.Same(t, originalMgr, rebuilt.authManager,
		"rebuild must keep tracking the original auth manager")

	// The preflight 401 travelled through the rebuilt transport; it must have
	// reached the original manager, not a discarded internal one.
	state, _ := originalMgr.State()
	require.Equal(t, authstate.StateInvalid, state,
		"auth failures seen by rebuilt transports must transition the tracked manager")
}

func TestRebuildClusterSubsystemGuardsMissingInputs(t *testing.T) {
	var nilApp *App
	nilApp.rebuildClusterSubsystem("cluster-a")

	app := newTestAppWithDefaults(t)
	app.rebuildClusterSubsystem("")
	app.rebuildClusterSubsystem("missing")

	app.clusterClients = make(map[string]*clusterClients)
	app.clusterClients["cluster-a"] = &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}}
	app.rebuildClusterSubsystem("cluster-a")
}

func TestClusterSubsystemRebuildHelperPaths(t *testing.T) {
	app := newTestAppWithDefaults(t)
	rebuild := clusterSubsystemRebuild{
		app: app, clusterID: "cluster-a", clusterName: "Cluster A",
		selection:  kubeconfigSelection{Path: "/missing/config", Context: "ctx"},
		oldClients: &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}},
	}

	clients, ok := rebuild.rebuildClients()
	require.False(t, ok)
	require.Nil(t, clients)

	require.False(t, rebuild.startManager(nil))
	setRefreshRuntimeContextForTest(app, context.Background())
	require.False(t, rebuild.startManager(&system.Subsystem{}))

	subsystems, order := refreshSubsystemTopology(map[string]*system.Subsystem{
		"cluster-b": {},
		"cluster-a": {},
	})
	require.Len(t, subsystems, 2)
	require.ElementsMatch(t, []string{"cluster-a", "cluster-b"}, order)

	setRefreshServiceReadyForTest(app)
	app.refreshAggregates.Store(&refreshAggregateHandlers{})
	require.True(t, rebuild.updateRefreshRouting(subsystems, order))

	rebuild.startObjectCatalog(&clusterClients{meta: rebuild.oldClients.meta})
}

func TestClusterClientsAuthInvalid(t *testing.T) {
	require.False(t, clusterClientsAuthInvalid(&clusterClients{}))
	require.True(t, clusterClientsAuthInvalid(&clusterClients{authFailedOnInit: true}))

	manager := authstate.New(authstate.Config{MaxAttempts: 0})
	t.Cleanup(manager.Shutdown)
	manager.ReportFailure("expired")
	require.True(t, clusterClientsAuthInvalid(&clusterClients{authManager: manager}))
}

// When the first selected cluster fails authentication, refresh setup never
// runs and the refresh lifetime remains absent. Recovery must create that runtime before it
// starts the rebuilt manager; otherwise the HTTP/catalog shell comes up around
// stopped informers and the cluster remains loading_slow forever.
func TestClusterSubsystemRebuildStartsMissingRefreshRuntimeBeforeReadiness(t *testing.T) {
	const clusterID = "cluster-a"
	app := newTestAppWithDefaults(t)
	setTestAppRuntimeReady(t, app, context.Background())
	t.Cleanup(func() {
		if app.refreshCancel != nil {
			app.refreshCancel()
		}
	})
	emitter, _ := collectingEmitter()
	app.clusterLifecycle = newClusterLifecycleWithSlowThreshold(emitter, time.Minute)
	app.clusterLifecycle.SetState(clusterID, ClusterStateLoading)
	require.Nil(t, app.currentRefreshRuntimeContext(), "precondition: initial auth failure left refresh uninitialised")

	hub := &recoveryStartInformerHub{started: make(chan struct{})}
	service := stubSnapshotService{build: func(context.Context, string, string) (*refresh.Snapshot, error) {
		return &refresh.Snapshot{
			Domain:  "namespaces",
			Payload: snapshot.NamespaceSnapshot{WorkloadsReady: hub.isStarted()},
		}, nil
	}}
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{clusterID},
		services:     map[string]refresh.SnapshotBuilder{clusterID: service},
		onNamespaceSnapshot: func(id string) {
			if app.clusterLifecycle.GetState(id) == ClusterStateLoading {
				app.clusterLifecycle.SetState(id, ClusterStateReady)
			}
		},
	}
	app.refreshAggregates.Store(&refreshAggregateHandlers{snapshot: aggregate})
	subsystem := &system.Subsystem{
		Manager:            refresh.NewManager(nil, hub, nil, nil, nil),
		SnapshotService:    service,
		NamespacesDoorbell: &system.NamespacesDoorbellObserver{},
	}

	// The readiness gate must reject the invalid early snapshot.
	_, err := aggregate.Build(context.Background(), "namespaces", refresh.JoinClusterScope(clusterID, ""))
	require.NoError(t, err)
	require.Equal(t, ClusterStateLoading, app.clusterLifecycle.GetState(clusterID))

	rebuild := clusterSubsystemRebuild{app: app, clusterID: clusterID, clusterName: "Cluster A"}
	require.True(t, rebuild.startManager(subsystem))
	require.Eventually(t, hub.isStarted, time.Second, 10*time.Millisecond,
		"auth recovery must start the rebuilt manager even when refresh setup never ran")
	require.NotNil(t, app.currentRefreshRuntimeContext())

	app.sweepNamespacesReadiness(map[string]*system.Subsystem{clusterID: subsystem})
	require.Eventually(t, func() bool {
		return app.clusterLifecycle.GetState(clusterID) == ClusterStateReady
	}, time.Second, 10*time.Millisecond,
		"the started manager must allow the server-owned readiness build to reach Ready")
}

func TestClusterSubsystemRebuildDoesNotPublishWhenRefreshRuntimeStopped(t *testing.T) {
	app := newTestAppWithDefaults(t)
	setTestAppRuntimeReady(t, app, context.Background())
	require.NotNil(t, app.ensureRefreshRuntimeContext())
	app.stopRefreshRuntimeContext()

	hub := &recoveryStartInformerHub{started: make(chan struct{})}
	subsystem := &system.Subsystem{Manager: refresh.NewManager(nil, hub, nil, nil, nil)}
	rebuild := clusterSubsystemRebuild{app: app, clusterID: "cluster-a", clusterName: "Cluster A"}
	published := rebuild.activateSubsystem(&clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}}, subsystem)

	require.False(t, published)
	require.Nil(t, app.getRefreshSubsystem("cluster-a"),
		"a subsystem whose manager cannot start must not be published")
	require.Never(t, hub.isStarted, 100*time.Millisecond, 10*time.Millisecond,
		"a late auth rebuild must not restart producers after global refresh teardown")
}

func TestClusterSubsystemRebuildPublishesAfterManagerStartIsScheduled(t *testing.T) {
	app := newTestAppWithDefaults(t)
	previousClients := &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}}
	app.clusterClients = map[string]*clusterClients{"cluster-a": previousClients}
	setTestAppRuntimeReady(t, app, context.Background())
	require.NotNil(t, app.ensureRefreshRuntimeContext())
	setRefreshServiceReadyForTest(app)
	app.refreshAggregates.Store(&refreshAggregateHandlers{})

	hub := &recoveryStartInformerHub{started: make(chan struct{})}
	subsystem := &system.Subsystem{Manager: refresh.NewManager(nil, hub, nil, nil, nil)}
	clients := &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}}
	rebuild := clusterSubsystemRebuild{app: app, clusterID: "cluster-a", clusterName: "Cluster A"}

	require.True(t, rebuild.activateSubsystem(clients, subsystem))
	require.Same(t, subsystem, app.getRefreshSubsystem("cluster-a"))
	require.Same(t, clients, app.clusterClientsForID("cluster-a"),
		"client and subsystem replacements must be committed by the same successful activation")
	require.Eventually(t, hub.isStarted, time.Second, 10*time.Millisecond)

	app.stopRefreshSubsystem(subsystem)
	app.stopRefreshRuntimeContext()
}

func TestClusterSubsystemRebuildRoutesReplacementBeforeStoppingPrevious(t *testing.T) {
	const clusterID = "cluster-a"
	app := newTestAppWithDefaults(t)
	setTestAppRuntimeReady(t, app, context.Background())
	require.NotNil(t, app.ensureRefreshRuntimeContext())
	setRefreshServiceReadyForTest(app)

	oldStream := resourcestream.NewManager(nil, nil, nil, snapshot.ClusterMeta{ClusterID: clusterID}, nil, nil)
	newStream := resourcestream.NewManager(nil, nil, nil, snapshot.ClusterMeta{ClusterID: clusterID}, nil, nil)
	resources, err := newAggregateResourceStreamHandler(map[string]*system.Subsystem{
		clusterID: {ResourceStream: oldStream},
	}, nil, nil)
	require.NoError(t, err)
	app.refreshAggregates.Store(&refreshAggregateHandlers{resources: resources})

	oldHub := &blockingShutdownInformerHub{
		shutdownStarted: make(chan struct{}),
		releaseShutdown: make(chan struct{}),
	}
	t.Cleanup(oldHub.release)
	oldManager := refresh.NewManager(nil, oldHub, nil, nil, nil)
	require.NoError(t, oldManager.Start(context.Background()))
	app.setRefreshSubsystem(clusterID, &system.Subsystem{
		Manager:        oldManager,
		ResourceStream: oldStream,
	})

	newManager := refresh.NewManager(nil, nil, nil, nil, nil)
	next := &system.Subsystem{Manager: newManager, ResourceStream: newStream}
	rebuild := clusterSubsystemRebuild{app: app, clusterID: clusterID, clusterName: "Cluster A"}
	result := make(chan bool, 1)
	go func() {
		result <- rebuild.activateSubsystem(&clusterClients{meta: ClusterMeta{ID: clusterID}}, next)
	}()

	select {
	case <-oldHub.shutdownStarted:
	case <-time.After(time.Second):
		t.Fatal("previous subsystem shutdown did not start")
	}
	require.Same(t, newStream, resources.managerFor(clusterID),
		"aggregate routing must publish the replacement before old stream shutdown can trigger resubscription")

	oldHub.release()
	require.True(t, <-result)
	app.stopRefreshSubsystem(next)
	app.stopRefreshRuntimeContext()
}
