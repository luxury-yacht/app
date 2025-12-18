package backend

import (
	"testing"

	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

func TestStartShellSessionRequiresClient(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)

	_, err := app.StartShellSession(ShellSessionRequest{})
	if err == nil {
		t.Fatalf("expected error when client not initialized")
	}
}

func TestStartShellSessionRequiresRestConfig(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.client = fake.NewSimpleClientset()

	_, err := app.StartShellSession(ShellSessionRequest{Namespace: "default", PodName: "demo"})
	if err == nil {
		t.Fatalf("expected rest config error when missing")
	}
}

func TestStartShellSessionRequiresNamespace(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.client = fake.NewSimpleClientset()
	app.restConfig = &rest.Config{}

	_, err := app.StartShellSession(ShellSessionRequest{PodName: "demo"})
	if err == nil {
		t.Fatalf("expected namespace validation error")
	}
}

func TestStartShellSessionRequiresPodName(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	app.client = fake.NewSimpleClientset()
	app.restConfig = &rest.Config{}

	_, err := app.StartShellSession(ShellSessionRequest{Namespace: "default"})
	if err == nil {
		t.Fatalf("expected pod name validation error")
	}
}
