package backend

import (
	"context"
	"os"
	"strings"
	"testing"

	"k8s.io/client-go/kubernetes/fake"
)

func TestInitKubernetesClientReturnsEarlyWithExistingClient(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.client = fake.NewClientset()

	if err := app.initKubernetesClient(); err != nil {
		t.Fatalf("expected nil error when client already present, got %v", err)
	}
}

func TestInitKubernetesClientErrorsWithoutKubeconfig(t *testing.T) {
	t.Setenv("HOME", "")

	app := NewApp()
	app.logger = NewLogger(10)

	err := app.initKubernetesClient()
	if err == nil {
		t.Fatalf("expected error when no kubeconfig available")
	}
	if !strings.Contains(err.Error(), "no kubeconfig available") {
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
	app.selectedKubeconfig = file

	if err := app.initKubernetesClient(); err != nil {
		t.Fatalf("expected kubeconfig initialization to succeed, got %v", err)
	}
	if app.client == nil || app.restConfig == nil {
		t.Fatalf("expected client and restConfig to be initialized")
	}
}
