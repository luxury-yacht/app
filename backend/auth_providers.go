package backend

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"k8s.io/client-go/util/homedir"

	// Register all client-go authentication plugins (including the exec-based
	// providers used by clusters such as GKE's `gke-gcloud-auth-plugin`). The
	// blank import ensures client-go executes external helpers declared in
	// kubeconfigs instead of returning "no Auth Provider found" errors.
	_ "k8s.io/client-go/plugin/pkg/client/auth"
)

var (
	envSetupTimeout   = 500 * time.Millisecond
	envSetupOnce      sync.Once
	defaultShellPaths = []string{
		"/bin/zsh",
		"/bin/bash",
		"/bin/sh",
	}
)

// setupEnvironment merges PATH from a login shell (when available) with a few
// known helper locations. The login shell probe runs with a short timeout so
// bundled builds are never blocked by interactive shell configuration.
func (a *App) setupEnvironment() {
	if a == nil {
		return
	}
	if a.logger == nil {
		a.logger = NewLogger(1000)
	}
	envSetupOnce.Do(func() {
		current := os.Getenv("PATH")

		loginPath, err := readLoginShellPath(envSetupTimeout)
		if err != nil {
			a.logger.Warn("Login shell PATH probe failed", "Auth")
		}

		merged := mergePathLists(loginPath, current)
		for _, candidate := range authHelperDirectories() {
			merged = ensurePathContains(merged, candidate)
		}

		if merged != "" && merged != current {
			os.Setenv("PATH", merged)
		}

		_, _ = exec.LookPath("gke-gcloud-auth-plugin")
	})
}

func readLoginShellPath(timeout time.Duration) (string, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		for _, candidate := range defaultShellPaths {
			if _, err := os.Stat(candidate); err == nil {
				shell = candidate
				break
			}
		}
	}
	if shell == "" {
		return "", errors.New("no shell available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := execCommandContext(ctx, shell, "-lc", "printf %s \"$PATH\"")
	output, err := cmd.Output()
	if ctx.Err() == context.DeadlineExceeded {
		return "", errors.New("login shell command timed out")
	}
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(output)), nil
}

func ensurePathContains(existing, candidate string) string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return existing
	}

	entries := filepath.SplitList(existing)
	for _, entry := range entries {
		if entry == candidate {
			return existing
		}
	}

	if existing == "" {
		return candidate
	}

	return existing + string(os.PathListSeparator) + candidate
}

func mergePathLists(pathLists ...string) string {
	seen := make(map[string]struct{})
	var merged []string

	for _, list := range pathLists {
		if list == "" {
			continue
		}

		for _, entry := range filepath.SplitList(list) {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			if _, ok := seen[entry]; ok {
				continue
			}
			seen[entry] = struct{}{}
			merged = append(merged, entry)
		}
	}

	return strings.Join(merged, string(os.PathListSeparator))
}

func execCommandContext(ctx context.Context, name string, arg ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, arg...)
	// Prevent inherited stdin so shells cannot block waiting for input.
	cmd.Stdin = nil
	return cmd
}

func authHelperDirectories() []string {
	home := resolveHomeDir()
	candidates := []string{
		"/usr/local/bin",
		"/opt/homebrew/bin",
		"/usr/bin",
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, "google-cloud-sdk", "bin"),
		"/usr/local/share/google-cloud-sdk/bin",
		"/opt/homebrew/share/google-cloud-sdk/bin",
		"/usr/local/google-cloud-sdk/bin",
		"/opt/homebrew/google-cloud-sdk/bin",
	}

	globs := []string{
		"/opt/homebrew/Caskroom/google-cloud-sdk/*/google-cloud-sdk/bin",
		"/usr/local/Caskroom/google-cloud-sdk/*/google-cloud-sdk/bin",
	}

	for _, pattern := range globs {
		matches, err := filepath.Glob(pattern)
		if err == nil {
			candidates = append(candidates, matches...)
		}
	}

	seen := make(map[string]struct{})
	var results []string
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		if stat, err := os.Stat(candidate); err == nil && stat.IsDir() {
			seen[candidate] = struct{}{}
			results = append(results, candidate)
		}
	}

	return results
}

func resolveHomeDir() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	return homedir.HomeDir()
}
