package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// Runs as a real client-go credential subprocess, with no AWS installation or
// credentials required. stdout remains the ExecCredential protocol.
func TestCredentialDiagnosticHelper(t *testing.T) {
	mode := os.Getenv("LY_TEST_CREDENTIAL_MODE")
	if mode == "" {
		return
	}
	if stateFile := os.Getenv("LY_TEST_CREDENTIAL_STATE_FILE"); stateFile != "" {
		data, err := os.ReadFile(stateFile)
		if err != nil {
			os.Exit(255)
		}
		mode = string(data)
	}
	switch mode {
	case "expired":
		fmt.Fprintln(os.Stderr, "Error loading SSO Token: Token has expired and refresh failed. secret-must-not-reach-ui")
	case "failed":
		fmt.Fprintln(os.Stderr, "credential service is unavailable. secret-must-not-reach-ui")
	case "missing-cache":
		fmt.Fprintln(os.Stderr, "exec credential cache file not found")
	default:
		fmt.Fprintln(os.Stdout, `{"apiVersion":"client.authentication.k8s.io/v1","kind":"ExecCredential","status":{"token":"fixture-token"}}`)
		os.Exit(0)
	}
	os.Exit(255)
}

func TestRestoredClustersPublishRealAuthFailureAndRecovery(t *testing.T) {
	setTestConfigEnv(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"major":"1","minor":"30"}`)
	}))
	defer server.Close()
	app := newWorkspaceCoordinatorTestFixture(t)
	defer app.ClusterRuntime.stopAuthRecovery()
	statePath := filepath.Join(t.TempDir(), "credential-state")
	require.NoError(t, os.WriteFile(statePath, []byte("expired"), 0o600))
	selections := make([]string, 0, 2)
	ids := make(map[string]string)
	for _, mode := range []string{"expired", "healthy"} {
		path := writeExecDiagnosticKubeconfig(t, server.URL, mode)
		if mode == "expired" {
			config, err := clientcmd.LoadFromFile(path)
			require.NoError(t, err)
			config.AuthInfos["test"].Exec.Env = append(config.AuthInfos["test"].Exec.Env,
				clientcmdapi.ExecEnvVar{Name: "LY_TEST_CREDENTIAL_STATE_FILE", Value: statePath})
			require.NoError(t, clientcmd.WriteToFile(*config, path))
		}
		app.ClusterRuntime.availableKubeconfigs = append(app.ClusterRuntime.availableKubeconfigs,
			KubeconfigInfo{Name: mode, Path: path, Context: "test"})
		ids[mode] = app.ClusterRuntime.clusterMetaForSelection(kubeconfigSelection{Path: path, Context: "test"}).ID
		selections = append(selections, path+":test")
	}
	settings := defaultSettingsFile()
	settings.Kubeconfig.Selected = selections
	require.NoError(t, app.Preferences.saveSettingsFile(settings))
	_, startupCtx, err := app.Workspace.initializeSelectedClustersAtStartup()
	require.NoError(t, err)
	consumerCtx, cancelConsumer := context.WithCancel(context.Background())
	defer cancelConsumer()
	consumed := make(chan struct{})
	go func() {
		defer close(consumed)
		app.ClusterRuntime.consumeIntents(consumerCtx, app.Workspace.consumeClusterRuntimeIntent)
	}()
	app.Workspace.kubeClientInitializer = func(ctx context.Context) error {
		_, err := app.Workspace.preflightSelectedClusterClients(ctx)
		return err
	}
	require.NoError(t, app.Workspace.connectSelectedClustersAtStartup(startupCtx))
	require.NoError(t, startupCtx.Err())
	require.Eventually(t, func() bool {
		state := app.Workspace.GetClusterWorkspaceState()
		return state.Clusters[ids["expired"]].Auth.ErrorClass == "auth"
	}, 3*time.Second, time.Millisecond)
	state := app.Workspace.GetClusterWorkspaceState()
	require.Equal(t, "expired-credentials", state.Clusters[ids["expired"]].Auth.DiagnosticKind)
	require.Equal(t, "valid", state.Clusters[ids["healthy"]].Auth.State)
	require.NotContains(t, state.Clusters[ids["expired"]].Auth.DiagnosticSummary, "secret-must-not-reach-ui")
	// Recovery publishes the existing rebuild intent; refresh reconstruction has
	// its own integration tests. Stop this consumer before exercising that edge.
	cancelConsumer()
	<-consumed
	require.True(t, app.Workspace.waitForSelectionMutationIdle(time.Second))
	require.NoError(t, os.WriteFile(statePath, []byte("healthy"), 0o600))
	app.ClusterRuntime.RetryClusterAuth(ids["expired"])
	require.Eventually(t, func() bool {
		return app.Workspace.GetClusterWorkspaceState().Clusters[ids["expired"]].Auth.State == "valid"
	}, 3*time.Second, time.Millisecond)
	require.Equal(t, "valid", app.Workspace.GetClusterWorkspaceState().Clusters[ids["healthy"]].Auth.State)
	require.Empty(t, app.Workspace.GetClusterWorkspaceState().Clusters[ids["expired"]].Auth.DiagnosticKind)
}

func TestClusterPreflightPreservesExecDiagnostic(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"major":"1","minor":"30"}`)
	}))
	t.Cleanup(server.Close)
	app := newClusterRuntimeTestFixture(t)
	t.Cleanup(app.ClusterRuntime.execDiagnostics.close)
	for _, mode := range []string{"expired", "failed", "missing-cache", "healthy"} {
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			path := writeExecDiagnosticKubeconfig(t, server.URL, mode)
			manager := authstate.New(authstate.Config{MaxAttempts: 0})
			defer manager.Shutdown()
			clients, err := app.ClusterRuntime.buildClusterClientsWithManager(context.Background(),
				kubeconfigSelection{Path: path, Context: "test"}, ClusterMeta{ID: mode, Name: mode}, manager)
			require.NoError(t, err)
			if mode == "healthy" {
				require.False(t, clients.authFailedOnInit)
				require.True(t, manager.IsValid())
				return
			}
			require.True(t, clients.authFailedOnInit)
			diagnostic := manager.FailureDiagnostic()
			want := "helper-failed"
			if mode == "expired" {
				want = "expired-credentials"
			}
			require.Equal(t, want, diagnostic.Kind)
			require.NotContains(t, diagnostic.Summary, "secret-must-not-reach-ui")
			require.Equal(t, os.Args[0], diagnostic.ExecCommand)
		})
	}
}

func writeExecDiagnosticKubeconfig(t *testing.T, serverURL, mode string) string {
	t.Helper()
	config := clientcmdapi.NewConfig()
	config.Clusters["test"] = &clientcmdapi.Cluster{Server: serverURL, InsecureSkipTLSVerify: true}
	config.Contexts["test"] = &clientcmdapi.Context{Cluster: "test", AuthInfo: "test"}
	config.CurrentContext = "test"
	config.AuthInfos["test"] = &clientcmdapi.AuthInfo{Exec: &clientcmdapi.ExecConfig{
		Command: os.Args[0], Args: []string{"-test.run=^TestCredentialDiagnosticHelper$"},
		APIVersion: "client.authentication.k8s.io/v1", InteractiveMode: clientcmdapi.NeverExecInteractiveMode,
		Env: []clientcmdapi.ExecEnvVar{{Name: "LY_TEST_CREDENTIAL_MODE", Value: mode}},
	}}
	path := filepath.Join(t.TempDir(), "config")
	require.NoError(t, clientcmd.WriteToFile(*config, path))
	return path
}
