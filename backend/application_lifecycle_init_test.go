package backend

import (
	"context"
	"os"
	"testing"

	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func TestStartupClusterConnectionUsesExistingClusterClients(t *testing.T) {
	app := NewApplicationRuntime(nil)
	app.AppLogs = NewAppLogService(NewLogger(10))
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// Seed a selection and client pool so startup uses the existing cluster client.
	configPath := "/tmp/config"
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    configPath,
		Context: "ctx",
	}}
	app.Workspace.selectedKubeconfigs = []string{configPath + ":ctx"}
	clusterID := app.ClusterRuntime.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "ctx"}).ID
	app.ClusterRuntime.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    configPath,
			kubeconfigContext: "ctx",
			client:            cgofake.NewClientset(),
			dynamicClient:     dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
		},
	}

	if err := app.Workspace.connectSelectedClustersAtStartup(context.Background()); err != nil {
		t.Fatalf("expected nil error when client already present, got %v", err)
	}
	app.Refresh.teardownRefreshSubsystem()
}

func TestStartupClusterConnectionFromKubeconfigPath(t *testing.T) {
	kubeconfig := `
apiVersion: v1
clusters:
- cluster:
    server: https://127.0.0.1
  name: test
contexts:
- context:
    cluster: test
    user: test-user
  name: test
current-context: test
kind: Config
preferences: {}
users:
- name: test-user
  user:
    token: dummy
`
	file := t.TempDir() + "/config"
	if err := os.WriteFile(file, []byte(kubeconfig), 0o644); err != nil {
		t.Fatalf("failed to write kubeconfig: %v", err)
	}

	app := NewApplicationRuntime(nil)
	app.AppLogs = NewAppLogService(NewLogger(10))
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    file,
		Context: "test",
	}}
	app.Workspace.selectedKubeconfigs = []string{file + ":test"}

	if err := app.Workspace.connectSelectedClustersAtStartup(context.Background()); err != nil {
		t.Fatalf("expected kubeconfig initialization to succeed, got %v", err)
	}
	clusterID := app.ClusterRuntime.clusterMetaForSelection(kubeconfigSelection{Path: file, Context: "test"}).ID
	clients := app.ClusterRuntime.clusterClientsForID(clusterID)
	if clients == nil || clients.client == nil || clients.restConfig == nil {
		t.Fatalf("expected cluster clients and restConfig to be initialized")
	}
	app.Refresh.teardownRefreshSubsystem()
}
