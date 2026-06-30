package backend

import (
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd/api"
)

func TestParseExecWrapperArgs(t *testing.T) {
	command, args, ok := parseExecWrapperArgs([]string{"app"})
	if ok || command != "" || args != nil {
		t.Fatalf("expected parse to fail for short args")
	}

	command, args, ok = parseExecWrapperArgs([]string{"app", "--nope", "kubectl"})
	if ok || command != "" || args != nil {
		t.Fatalf("expected parse to fail for missing wrapper flag")
	}

	command, args, ok = parseExecWrapperArgs([]string{"app", execWrapperFlag, "  "})
	if ok || command != "" || args != nil {
		t.Fatalf("expected parse to fail for empty command")
	}

	command, args, ok = parseExecWrapperArgs([]string{"app", execWrapperFlag, "kubectl", "get", "pods"})
	if !ok || command != "kubectl" || len(args) != 2 {
		t.Fatalf("unexpected parsed args: %v %v %v", command, args, ok)
	}
}

func TestRunExecWrapperExitCodes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("exec wrapper tests use POSIX commands")
	}

	truePath, err := exec.LookPath("true")
	if err != nil {
		t.Skip("true command not available")
	}
	if code := runExecWrapper(truePath, nil); code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}

	falsePath, err := exec.LookPath("false")
	if err != nil {
		t.Skip("false command not available")
	}
	if code := runExecWrapper(falsePath, nil); code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}

	if code := runExecWrapper("definitely-not-a-command", nil); code != 1 {
		t.Fatalf("expected exit code 1 for missing command, got %d", code)
	}
}

func TestIsExecWrapperConfigured(t *testing.T) {
	if isExecWrapperConfigured(nil) {
		t.Fatalf("expected wrapper flag to be false for nil args")
	}
	if isExecWrapperConfigured([]string{"--other"}) {
		t.Fatalf("expected wrapper flag to be false for other args")
	}
	if !isExecWrapperConfigured([]string{execWrapperFlag, "kubectl"}) {
		t.Fatalf("expected wrapper flag to be true")
	}
}

func TestSameExecutablePath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("path comparisons are platform specific")
	}

	left := filepath.Join(string(filepath.Separator), "tmp", "tool")
	right := filepath.Join(string(filepath.Separator), "tmp", ".", "tool")
	if !sameExecutablePath(left, right) {
		t.Fatalf("expected paths to be equivalent")
	}
}

func TestExecDisplayCommand(t *testing.T) {
	t.Run("nil config", func(t *testing.T) {
		if got := execDisplayCommand(nil); got != "" {
			t.Fatalf("expected empty for nil config, got %q", got)
		}
	})

	t.Run("no exec provider", func(t *testing.T) {
		if got := execDisplayCommand(&rest.Config{}); got != "" {
			t.Fatalf("expected empty when no exec provider, got %q", got)
		}
	})

	t.Run("unwrapped command", func(t *testing.T) {
		cfg := &rest.Config{ExecProvider: &api.ExecConfig{
			Command: "gke-gcloud-auth-plugin",
			Args:    []string{"--version"},
		}}
		if got := execDisplayCommand(cfg); got != "gke-gcloud-auth-plugin" {
			t.Fatalf("expected gke-gcloud-auth-plugin, got %q", got)
		}
	})

	t.Run("windows-wrapped command returns the original, not the app exe", func(t *testing.T) {
		// Wrapped form (see wrapExecProviderForWindows): Command is the app
		// executable, the original helper is the first wrapper arg.
		cfg := &rest.Config{ExecProvider: &api.ExecConfig{
			Command: filepath.Join("C:\\", "Program Files", "LuxuryYacht", "app.exe"),
			Args:    []string{execWrapperFlag, "gke-gcloud-auth-plugin", "--version"},
		}}
		if got := execDisplayCommand(cfg); got != "gke-gcloud-auth-plugin" {
			t.Fatalf("expected original command gke-gcloud-auth-plugin, got %q", got)
		}
	})
}

// TestExecDisplayCommandWindowsDiagnosticEndToEnd confirms the two halves of the
// Windows credential-failure path compose correctly: execDisplayCommand recovers
// the original helper from a wrapper-rewritten config, and the credential
// classifier turns a wrapped exec failure into an auth-class diagnostic naming
// that helper — the exact diagnostic a Windows preflight hands the overlay.
//
// This runs on any OS because it constructs the wrapped config directly (the same
// shape wrapExecProviderForWindows produces); it does not depend on runtime.GOOS.
func TestExecDisplayCommandWindowsDiagnosticEndToEnd(t *testing.T) {
	// A config as wrapExecProviderForWindows would leave it: Command is the app
	// executable; the real helper is the first wrapper arg.
	cfg := &rest.Config{ExecProvider: &api.ExecConfig{
		Command: filepath.Join("C:\\", "Program Files", "LuxuryYacht", "app.exe"),
		Args:    []string{execWrapperFlag, "gke-gcloud-auth-plugin", "--version"},
	}}

	command := execDisplayCommand(cfg)
	require.Equal(t, "gke-gcloud-auth-plugin", command, "must recover the real helper, not the app exe")

	// The wrapper exits non-zero when the real helper fails; client-go surfaces
	// that to the preflight as a credential error.
	diag := credentialerrors.Classify(
		errors.New(`getting credentials: exec: executable C:\Program Files\LuxuryYacht\app.exe failed with exit code 1`),
		credentialerrors.Context{ExecCommand: command},
	)

	require.True(t, diag.IsAuth(), "a wrapped Windows exec failure must be auth-class")
	require.Equal(t, "gke-gcloud-auth-plugin", diag.ExecCommand, "the overlay must name the real helper")
}

func TestWrapExecProviderForWindowsNoop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test covers non-windows no-op behavior")
	}

	cfg := &rest.Config{
		ExecProvider: &api.ExecConfig{
			Command: "kubectl",
			Args:    []string{"version"},
		},
	}

	wrapExecProviderForWindows(cfg)

	if cfg.ExecProvider.Command != "kubectl" || len(cfg.ExecProvider.Args) != 1 {
		t.Fatalf("expected exec config to remain unchanged on non-windows")
	}
}
