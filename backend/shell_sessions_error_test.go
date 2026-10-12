package backend

import (
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

const shellClusterID = "config:ctx"

// shellPodTarget is the complete identity of a Pod in the shell test cluster.
func shellPodTarget(namespace, name string) resourcemodel.ResourceRef {
	return resourcemodel.ResourceRef{ClusterID: shellClusterID, Version: "v1", Kind: "Pod", Namespace: namespace, Name: name}
}

// A shell can only exec into a Pod; any other object reference is refused
// before the cluster is contacted.
func TestStartShellSessionRejectsNonPodTarget(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	operations := fixture.coordinator

	_, err := operations.StartShellSession(ShellSessionRequest{Target: resourcemodel.ResourceRef{
		ClusterID: shellClusterID, Group: "apps", Version: "v1", Kind: "Deployment", Namespace: "default", Name: "web",
	}})
	if err == nil || !strings.Contains(err.Error(), "v1 Pod target required, got apps/v1 Deployment") {
		t.Fatalf("expected pod target error, got %v", err)
	}
	if len(operations.ListShellSessions()) != 0 {
		t.Fatal("rejected shell start registered a session")
	}
}

func TestStartShellSessionRequiresClient(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	app.AppLogs = NewAppLogService(NewLogger(10))
	// Per-cluster clients are stored in clusterClients, not in global fields.
	// Create a cluster entry WITHOUT a client to test the error path.
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			// client is intentionally nil
		},
	}

	_, err := operations.StartShellSession(ShellSessionRequest{Target: shellPodTarget("default", "demo")})
	if err == nil {
		t.Fatalf("expected error when client not initialized")
	}
}

func TestStartShellSessionRequiresRestConfig(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	app.AppLogs = NewAppLogService(NewLogger(10))
	// Per-cluster clients are stored in clusterClients, not in global fields.
	fakeClient := fake.NewClientset()
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			// restConfig is intentionally nil
		},
	}

	_, err := operations.StartShellSession(ShellSessionRequest{Target: shellPodTarget("default", "demo")})
	if err == nil {
		t.Fatalf("expected rest config error when missing")
	}
}

func TestStartShellSessionRequiresNamespace(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	app.AppLogs = NewAppLogService(NewLogger(10))
	// Per-cluster clients are stored in clusterClients, not in global fields.
	fakeClient := fake.NewClientset()
	restConfig := &rest.Config{}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	_, err := operations.StartShellSession(ShellSessionRequest{Target: shellPodTarget("", "demo")})
	if err == nil {
		t.Fatalf("expected namespace validation error")
	}
}

func TestStartShellSessionRequiresPodName(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	app.AppLogs = NewAppLogService(NewLogger(10))
	// Per-cluster clients are stored in clusterClients, not in global fields.
	fakeClient := fake.NewClientset()
	restConfig := &rest.Config{}
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		shellClusterID: {
			meta:              ClusterMeta{ID: shellClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
			restConfig:        restConfig,
		},
	}

	_, err := operations.StartShellSession(ShellSessionRequest{Target: shellPodTarget("default", "")})
	if err == nil {
		t.Fatalf("expected pod name validation error")
	}
}
