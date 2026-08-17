package backend

import (
	"testing"

	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

const shellClusterID = "config:ctx"

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

	_, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "default", PodName: "demo"})
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

	_, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "default", PodName: "demo"})
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

	_, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{PodName: "demo"})
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

	_, err := operations.StartShellSession(shellClusterID, ShellSessionRequest{Namespace: "default"})
	if err == nil {
		t.Fatalf("expected pod name validation error")
	}
}
