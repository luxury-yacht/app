/*
 * backend/app_heartbeat_test.go
 *
 * Tests for the application's per-cluster heartbeat functionality.
 * startHeartbeatLoop drives periodic calls to runHeartbeatIteration,
 * which checks each cluster independently via checkClusterHealth.
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
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	restfake "k8s.io/client-go/rest/fake"
	cgotesting "k8s.io/client-go/testing"
)

// heartbeatDiscovery wraps FakeDiscovery with a configurable REST client.
type heartbeatDiscovery struct {
	*fakediscovery.FakeDiscovery
	restClient rest.Interface
}

func (h *heartbeatDiscovery) RESTClient() rest.Interface {
	return h.restClient
}

// heartbeatClientSet overrides Discovery() to return a custom discovery impl.
type heartbeatClientSet struct {
	*cgofake.Clientset
	disco *heartbeatDiscovery
}

func (h *heartbeatClientSet) Discovery() discovery.DiscoveryInterface {
	return h.disco
}

// TestPerClusterHeartbeat tests that the heartbeat iterates all clusters independently.
func TestPerClusterHeartbeat(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
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

	// Create a healthy cluster with a working client
	healthyDisco := &heartbeatDiscovery{
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
	healthyClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: healthyDisco}

	// Create an unhealthy cluster with a failing client
	unhealthyDisco := &heartbeatDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("connection refused")
			}),
		},
	}
	unhealthyClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: unhealthyDisco}

	// Set up cluster clients
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-healthy": {
			meta:   ClusterMeta{ID: "cluster-healthy", Name: "Healthy Cluster"},
			client: healthyClient,
		},
		"cluster-unhealthy": {
			meta:   ClusterMeta{ID: "cluster-unhealthy", Name: "Unhealthy Cluster"},
			client: unhealthyClient,
		},
	}
	app.clusterClientsMu.Unlock()

	// Run the heartbeat iteration
	app.runHeartbeatIteration()

	// Check events were emitted for both clusters
	eventsMu.Lock()
	defer eventsMu.Unlock()

	healthyEvents := emittedEvents["cluster:health:healthy"]
	degradedEvents := emittedEvents["cluster:health:degraded"]

	if len(healthyEvents) != 1 {
		t.Errorf("expected 1 healthy event, got %d", len(healthyEvents))
	}
	if len(degradedEvents) != 1 {
		t.Errorf("expected 1 degraded event, got %d", len(degradedEvents))
	}

	// Verify the healthy event contains correct cluster info
	if len(healthyEvents) > 0 {
		if healthyEvents[0]["clusterId"] != "cluster-healthy" {
			t.Errorf("expected healthy event for cluster-healthy, got %v", healthyEvents[0]["clusterId"])
		}
	}

	// Verify the degraded event contains correct cluster info
	if len(degradedEvents) > 0 {
		if degradedEvents[0]["clusterId"] != "cluster-unhealthy" {
			t.Errorf("expected degraded event for cluster-unhealthy, got %v", degradedEvents[0]["clusterId"])
		}
	}
}

// TestPerClusterHeartbeatSkipsInvalidAuth tests that clusters with invalid auth are skipped.
func TestPerClusterHeartbeatSkipsInvalidAuth(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
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

	// Create a healthy cluster with working client
	healthyDisco := &heartbeatDiscovery{
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
	healthyClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: healthyDisco}

	// Create an auth manager in invalid state
	invalidAuthMgr := authstate.New(authstate.Config{MaxAttempts: 0})
	invalidAuthMgr.ReportFailure("token expired") // transitions to invalid since MaxAttempts=0

	// Set up cluster clients
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-healthy": {
			meta:   ClusterMeta{ID: "cluster-healthy", Name: "Healthy Cluster"},
			client: healthyClient,
		},
		"cluster-invalid-auth": {
			meta:        ClusterMeta{ID: "cluster-invalid-auth", Name: "Invalid Auth Cluster"},
			client:      healthyClient, // Has a working client, but auth is invalid
			authManager: invalidAuthMgr,
		},
	}
	app.clusterClientsMu.Unlock()

	// Run the heartbeat iteration
	app.runHeartbeatIteration()

	// Check events - should only see event for the healthy cluster
	eventsMu.Lock()
	defer eventsMu.Unlock()

	healthyEvents := emittedEvents["cluster:health:healthy"]
	degradedEvents := emittedEvents["cluster:health:degraded"]

	// We should only have 1 healthy event (from cluster-healthy)
	// and no events for cluster-invalid-auth since it was skipped
	if len(healthyEvents) != 1 {
		t.Errorf("expected 1 healthy event, got %d", len(healthyEvents))
	}

	if len(healthyEvents) > 0 && healthyEvents[0]["clusterId"] != "cluster-healthy" {
		t.Errorf("expected healthy event for cluster-healthy, got %v", healthyEvents[0]["clusterId"])
	}

	// No degraded events should be emitted for the invalid auth cluster
	if len(degradedEvents) != 0 {
		t.Errorf("expected 0 degraded events (invalid auth clusters should be skipped), got %d", len(degradedEvents))
	}
}

// TestPerClusterHeartbeatReportsToAuthManager tests that auth failures (401) are reported
// to the cluster's auth manager, not global state.
func TestPerClusterHeartbeatReportsToAuthManager(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	// Track emitted events (required by the heartbeat implementation)
	app.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {}

	// Create a cluster that returns 401 Unauthorized
	authFailDisco := &heartbeatDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 401,
					Body:       io.NopCloser(strings.NewReader(`{"kind":"Status","apiVersion":"v1","status":"Failure","message":"Unauthorized","reason":"Unauthorized","code":401}`)),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			}),
		},
	}
	authFailClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: authFailDisco}

	// Create an auth manager in valid state with MaxAttempts=0 so it transitions to invalid
	authMgr := authstate.New(authstate.Config{MaxAttempts: 0})

	// Verify auth manager starts as valid
	if !authMgr.IsValid() {
		t.Fatal("auth manager should start as valid")
	}

	// Set up cluster clients
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-auth-fail": {
			meta:        ClusterMeta{ID: "cluster-auth-fail", Name: "Auth Failing Cluster"},
			client:      authFailClient,
			authManager: authMgr,
		},
	}
	app.clusterClientsMu.Unlock()

	// Run the heartbeat iteration
	app.runHeartbeatIteration()

	// Auth manager should have been notified of the auth failure
	if authMgr.IsValid() {
		t.Error("auth manager should have been marked invalid after auth failure")
	}

	state, reason := authMgr.State()
	if state != authstate.StateInvalid {
		t.Errorf("expected StateInvalid, got %v", state)
	}
	if reason == "" {
		t.Error("expected failure reason to be set")
	}
}

// TestPerClusterHeartbeatConnectivityDoesNotAffectAuth tests that connectivity
// failures (connection refused, timeout) do NOT report to the auth manager.
func TestPerClusterHeartbeatConnectivityDoesNotAffectAuth(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	app.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {}

	// Create a cluster with a connectivity failure (connection refused)
	connFailDisco := &heartbeatDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("connection refused")
			}),
		},
	}
	connFailClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: connFailDisco}

	// Create an auth manager in valid state
	authMgr := authstate.New(authstate.Config{MaxAttempts: 0})
	if !authMgr.IsValid() {
		t.Fatal("auth manager should start as valid")
	}

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-conn-fail": {
			meta:        ClusterMeta{ID: "cluster-conn-fail", Name: "Connectivity Failing Cluster"},
			client:      connFailClient,
			authManager: authMgr,
		},
	}
	app.clusterClientsMu.Unlock()

	app.runHeartbeatIteration()

	// Auth manager should still be valid — connectivity failures don't affect auth state
	if !authMgr.IsValid() {
		t.Error("auth manager should remain valid after connectivity failure")
	}
}

// TestPerClusterHeartbeatEmitsDegradedEvent verifies that the per-cluster
// heartbeat emits a cluster:health:degraded event for failing clusters.
// Note: Global connection status tracking has been removed, so we only
// verify per-cluster events are emitted correctly.
func TestPerClusterHeartbeatEmitsDegradedEvent(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
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

	// Create an unhealthy cluster with a failing client
	unhealthyDisco := &heartbeatDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("connection refused")
			}),
		},
	}
	unhealthyClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: unhealthyDisco}

	// Set up cluster clients (no authManager so no indirect status update)
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-failing": {
			meta:   ClusterMeta{ID: "cluster-failing", Name: "Failing Cluster"},
			client: unhealthyClient,
			// No authManager - so ReportFailure won't trigger OnStateChange callback
		},
	}
	app.clusterClientsMu.Unlock()

	// Run the heartbeat iteration
	app.runHeartbeatIteration()

	// Check that a degraded event was emitted for the failing cluster
	eventsMu.Lock()
	defer eventsMu.Unlock()

	degradedEvents := emittedEvents["cluster:health:degraded"]
	if len(degradedEvents) != 1 {
		t.Errorf("expected 1 degraded event, got %d", len(degradedEvents))
	}
	if len(degradedEvents) > 0 && degradedEvents[0]["clusterId"] != "cluster-failing" {
		t.Errorf("expected degraded event for cluster-failing, got %v", degradedEvents[0]["clusterId"])
	}
}

// TestCheckClusterHealth tests the health check function for a cluster.
func TestCheckClusterHealth(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	t.Run("healthy cluster returns healthOK", func(t *testing.T) {
		healthyDisco := &heartbeatDiscovery{
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
		healthyClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: healthyDisco}

		cc := &clusterClients{
			meta:   ClusterMeta{ID: "healthy", Name: "Healthy"},
			client: healthyClient,
		}

		if got := app.checkClusterHealth(cc); got != healthOK {
			t.Errorf("expected healthOK, got %v", got)
		}
	})

	t.Run("connection refused returns healthConnectivityFailure", func(t *testing.T) {
		unhealthyDisco := &heartbeatDiscovery{
			FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
			restClient: &restfake.RESTClient{
				NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
				Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
					return nil, errors.New("connection refused")
				}),
			},
		}
		unhealthyClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: unhealthyDisco}

		cc := &clusterClients{
			meta:   ClusterMeta{ID: "unhealthy", Name: "Unhealthy"},
			client: unhealthyClient,
		}

		if got := app.checkClusterHealth(cc); got != healthConnectivityFailure {
			t.Errorf("expected healthConnectivityFailure, got %v", got)
		}
	})

	t.Run("401 returns healthAuthFailure", func(t *testing.T) {
		authDisco := &heartbeatDiscovery{
			FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
			restClient: &restfake.RESTClient{
				NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
				Client: restfake.CreateHTTPClient(func(*http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: 401,
						Body:       io.NopCloser(strings.NewReader(`{"kind":"Status","apiVersion":"v1","status":"Failure","message":"Unauthorized","reason":"Unauthorized","code":401}`)),
						Header:     http.Header{"Content-Type": []string{"application/json"}},
					}, nil
				}),
			},
		}
		authClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: authDisco}

		cc := &clusterClients{
			meta:   ClusterMeta{ID: "auth-fail", Name: "Auth Fail"},
			client: authClient,
		}

		if got := app.checkClusterHealth(cc); got != healthAuthFailure {
			t.Errorf("expected healthAuthFailure, got %v", got)
		}
	})

	t.Run("nil client returns healthConnectivityFailure", func(t *testing.T) {
		cc := &clusterClients{
			meta:   ClusterMeta{ID: "nil-client", Name: "Nil Client"},
			client: nil,
		}

		if got := app.checkClusterHealth(cc); got != healthConnectivityFailure {
			t.Errorf("expected healthConnectivityFailure, got %v", got)
		}
	})
}

// TestCheckClusterHealthUsesReadyz verifies that checkClusterHealth calls /readyz (not /healthz).
func TestCheckClusterHealthUsesReadyz(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	var requestedPath string
	disco := &heartbeatDiscovery{
		FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &cgotesting.Fake{}},
		restClient: &restfake.RESTClient{
			NegotiatedSerializer: scheme.Codecs.WithoutConversion(),
			Client: restfake.CreateHTTPClient(func(req *http.Request) (*http.Response, error) {
				requestedPath = req.URL.Path
				return &http.Response{
					StatusCode: 200,
					Body:       io.NopCloser(strings.NewReader("ok")),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			}),
		},
	}
	client := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: disco}

	cc := &clusterClients{
		meta:   ClusterMeta{ID: "test", Name: "Test"},
		client: client,
	}

	app.checkClusterHealth(cc)

	if requestedPath != "/readyz" {
		t.Errorf("expected request to /readyz, got %q", requestedPath)
	}
}

// TestStartHeartbeatLoopStopsOnContextCancel verifies the loop exits when the context is cancelled.
func TestStartHeartbeatLoopStopsOnContextCancel(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	bgCtx, bgCancel := context.WithCancel(context.Background())
	defer bgCancel()
	app.Ctx = bgCtx

	// No-op event emitter
	app.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {}

	// Empty cluster clients — runHeartbeatIteration will be a no-op.
	app.clusterClients = map[string]*clusterClients{}

	loopCtx, loopCancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		app.startHeartbeatLoop(loopCtx)
		close(done)
	}()

	// Cancel the context; the loop should return promptly.
	loopCancel()

	select {
	case <-done:
		// success
	case <-time.After(2 * time.Second):
		t.Fatal("startHeartbeatLoop did not exit after context cancellation")
	}
}

// TestStartHeartbeatLoopRunsImmediately verifies that the loop fires an iteration
// right away without waiting for the first ticker tick.
func TestStartHeartbeatLoopRunsImmediately(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	bgCtx, bgCancel := context.WithCancel(context.Background())
	defer bgCancel()
	app.Ctx = bgCtx

	// Track how many times runHeartbeatIteration executes by counting emitted events.
	var iterationCount int
	var mu sync.Mutex
	app.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {
		mu.Lock()
		iterationCount++
		mu.Unlock()
	}

	// Set up one healthy cluster so each iteration emits exactly one event.
	healthyDisco := &heartbeatDiscovery{
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
	healthyClient := &heartbeatClientSet{Clientset: cgofake.NewClientset(), disco: healthyDisco}

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"test-cluster": {
			meta:   ClusterMeta{ID: "test-cluster", Name: "Test Cluster"},
			client: healthyClient,
		},
	}
	app.clusterClientsMu.Unlock()

	loopCtx, loopCancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		app.startHeartbeatLoop(loopCtx)
		close(done)
	}()

	// Give a brief moment for the immediate iteration to fire.
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	count := iterationCount
	mu.Unlock()

	// Cancel so the loop exits.
	loopCancel()
	<-done

	if count < 1 {
		t.Fatalf("expected at least 1 immediate iteration, got %d", count)
	}
}
