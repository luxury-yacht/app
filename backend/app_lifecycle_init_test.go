package backend

import (
	"context"
	"os"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func TestInitKubernetesClientUsesExistingClusterClients(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.Ctx = context.Background()

	// Seed a selection and client pool so init uses the existing cluster client.
	configPath := "/tmp/config"
	app.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    configPath,
		Context: "ctx",
	}}
	app.selectedKubeconfigs = []string{configPath + ":ctx"}
	clusterID := app.clusterMetaForSelection(kubeconfigSelection{Path: configPath, Context: "ctx"}).ID
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    configPath,
			kubeconfigContext: "ctx",
			client:            cgofake.NewClientset(),
			dynamicClient:     dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
		},
	}

	if err := app.initKubernetesClient(); err != nil {
		t.Fatalf("expected nil error when client already present, got %v", err)
	}
	app.teardownRefreshSubsystem()
}

func TestInitKubernetesClientErrorsWithoutKubeconfig(t *testing.T) {
	t.Setenv("HOME", "")

	app := NewApp()
	app.logger = NewLogger(10)

	err := app.initKubernetesClient()
	if err == nil {
		t.Fatalf("expected error when no kubeconfig available")
	}
	if !strings.Contains(err.Error(), "no kubeconfig selections available") {
		t.Fatalf("unexpected error: %v", err)
	}
	if app.connectionStatus != ConnectionStateOffline {
		t.Fatalf("expected connection status to be marked offline on failure, got %s", app.connectionStatus)
	}
}

func TestInitKubernetesClientFromKubeconfigPath(t *testing.T) {
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

	app := NewApp()
	app.logger = NewLogger(10)
	app.Ctx = context.Background()
	app.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    file,
		Context: "test",
	}}
	app.selectedKubeconfigs = []string{file + ":test"}

	if err := app.initKubernetesClient(); err != nil {
		t.Fatalf("expected kubeconfig initialization to succeed, got %v", err)
	}
	clusterID := app.clusterMetaForSelection(kubeconfigSelection{Path: file, Context: "test"}).ID
	clients := app.clusterClients[clusterID]
	if clients == nil || clients.client == nil || clients.restConfig == nil {
		t.Fatalf("expected cluster clients and restConfig to be initialized")
	}
	app.teardownRefreshSubsystem()
}
