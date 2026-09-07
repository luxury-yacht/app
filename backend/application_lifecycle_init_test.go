package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func TestStartupClusterConnectionUsesExistingClusterClients(t *testing.T) {
	setTestConfigEnv(t)
	// Startup launches real refresh workers, which require a REST transport.
	// A typed fake client has a nil RESTClient and can panic inside ListWatch.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/version" {
			fmt.Fprint(w, `{"major":"1","minor":"30"}`)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"apiVersion":"v1","kind":"Status","status":"Failure","reason":"ServiceUnavailable","code":503}`)
	}))
	defer server.Close()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)
	app := NewApplicationRuntime(nil)
	t.Cleanup(app.Refresh.teardownRefreshSubsystem)
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
			client:            client,
			dynamicClient:     dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
		},
	}

	if err := app.Workspace.connectSelectedClustersAtStartup(context.Background()); err != nil {
		t.Fatalf("expected nil error when client already present, got %v", err)
	}
	require.Same(t, client, app.ClusterRuntime.clusterClientsForID(clusterID).client)
	app.Refresh.teardownRefreshSubsystem()
}

func TestStartupClusterConnectionFromKubeconfigPath(t *testing.T) {
	setTestConfigEnv(t)
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
