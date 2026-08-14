package backend

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCredentialHelperCommandInheritsProcessEnvironment(t *testing.T) {
	command := execCommandContext(context.Background(), "kubectl", "version")

	require.Nil(t, command.Env)
}

func TestResolveHomeDirPrefersEnv(t *testing.T) {
	original := os.Getenv("HOME")
	t.Cleanup(func() { os.Setenv("HOME", original) })

	if err := os.Setenv("HOME", "/tmp/test-home"); err != nil {
		t.Fatalf("failed to set HOME: %v", err)
	}

	if home := resolveHomeDir(); home != "/tmp/test-home" {
		t.Fatalf("expected HOME from env, got %s", home)
	}
}
