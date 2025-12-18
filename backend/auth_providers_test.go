package backend

import (
	"os"
	"testing"
)

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
