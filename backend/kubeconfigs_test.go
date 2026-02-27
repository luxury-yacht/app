package backend

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createTempKubeconfig creates a temporary kubeconfig file for testing
func createTempKubeconfig(t *testing.T, dir, filename, context string) string {
	// Use insecure-skip-tls-verify instead of invalid certificate
	kubeconfigContent := `apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: https://127.0.0.1:6443
  name: test-cluster
contexts:
- context:
    cluster: test-cluster
    user: test-user
  name: ` + context + `
current-context: ` + context + `
kind: Config
preferences: {}
users:
- name: test-user
  user:
    token: test-token
`

	configPath := filepath.Join(dir, filename)
	err := os.WriteFile(configPath, []byte(kubeconfigContent), 0644)
	require.NoError(t, err)
	return configPath
}

// hasKubeconfig returns true when a matching path/context entry exists.
func hasKubeconfig(configs []KubeconfigInfo, path string, context string) bool {
	for _, config := range configs {
		if config.Path == path && config.Context == context {
			return true
		}
	}
	return false
}

func TestApp_discoverKubeconfigs(t *testing.T) {
	tests := []struct {
		name        string
		setup       func(t *testing.T) (string, func())
		expectError bool
		expectedLen int
	}{
		{
			name: "discover multiple kubeconfigs",
			setup: func(t *testing.T) (string, func()) {
				tempDir := t.TempDir()
				kubeDir := filepath.Join(tempDir, ".kube")
				err := os.MkdirAll(kubeDir, 0755)
				require.NoError(t, err)

				// Create test kubeconfig files
				createTempKubeconfig(t, kubeDir, "config", "default-context")
				createTempKubeconfig(t, kubeDir, "test-config", "test-context")
				createTempKubeconfig(t, kubeDir, ".kubeconfig", "hidden-context")

				// Create an invalid file that should be skipped
				invalidPath := filepath.Join(kubeDir, "invalid.txt")
				err = os.WriteFile(invalidPath, []byte("not a kubeconfig"), 0644)
				require.NoError(t, err)

				return tempDir, func() {}
			},
			expectError: false,
			expectedLen: 3,
		},
		{
			name: "no kube directory",
			setup: func(t *testing.T) (string, func()) {
				tempDir := t.TempDir()
				return tempDir, func() {}
			},
			expectError: true,
			expectedLen: 0,
		},
		{
			name: "empty kube directory",
			setup: func(t *testing.T) (string, func()) {
				tempDir := t.TempDir()
				kubeDir := filepath.Join(tempDir, ".kube")
				err := os.MkdirAll(kubeDir, 0755)
				require.NoError(t, err)
				return tempDir, func() {}
			},
			expectError: false,
			expectedLen: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setTestConfigEnv(t)
			homeDir, cleanup := tt.setup(t)
			defer cleanup()

			// Temporarily override home directory for kubeconfig expansion.
			t.Setenv("HOME", homeDir)

			app := NewApp()
			err := app.discoverKubeconfigs()

			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Len(t, app.availableKubeconfigs, tt.expectedLen)

				if tt.expectedLen > 0 {
					// Check that default config is marked as default
					foundDefault := false
					for _, kc := range app.availableKubeconfigs {
						if kc.Name == "config" {
							assert.True(t, kc.IsDefault)
							foundDefault = true
						}
						assert.NotEmpty(t, kc.Path)
						assert.NotEmpty(t, kc.Context)
					}
					if tt.expectedLen >= 3 { // Only check if we expect the default config
						assert.True(t, foundDefault, "Should have found default kubeconfig")
					}
				}
			}
		})
	}
}

func TestApp_GetKubeconfigs(t *testing.T) {
	setTestConfigEnv(t)
	// Setup temp directory with kubeconfig
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	err := os.MkdirAll(kubeDir, 0755)
	require.NoError(t, err)
	createTempKubeconfig(t, kubeDir, "config", "default-context")

	// Override home directory for kubeconfig expansion.
	t.Setenv("HOME", tempDir)

	app := NewApp()

	// Test that GetKubeconfigs discovers configs if not already done
	configs, err := app.GetKubeconfigs()
	assert.NoError(t, err)
	assert.Len(t, configs, 1)
	assert.Equal(t, "config", configs[0].Name)
	assert.True(t, configs[0].IsDefault)

	// Test that subsequent calls return cached results
	configs2, err := app.GetKubeconfigs()
	assert.NoError(t, err)
	assert.Equal(t, configs, configs2)
}

func TestNormalizeKubeconfigSearchPathsDedupesResolvedPaths(t *testing.T) {
	setTestConfigEnv(t)
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	paths := []string{
		"~/config",
		filepath.Join(homeDir, "config"),
		"  ~/config  ",
	}

	normalized := normalizeKubeconfigSearchPaths(paths)
	require.Equal(t, []string{"~/config", "~/.kube"}, normalized)
}

func TestNormalizeKubeconfigSearchPathsWindowsCaseInsensitive(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-only path normalization")
	}

	paths := []string{
		`C:\Users\Example\.kube`,
		`c:\Users\Example\.kube`,
		`C:/Users/Example/.kube`,
	}

	normalized := normalizeKubeconfigSearchPaths(paths)
	require.Len(t, normalized, 2)
	require.Contains(t, normalized, "~/.kube")
}

func TestNormalizeKubeconfigSearchPathsMixedFilesAndDirs(t *testing.T) {
	setTestConfigEnv(t)
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	dirName := "configs"
	fileName := "config"
	dirPath := filepath.Join(homeDir, dirName)
	require.NoError(t, os.MkdirAll(dirPath, 0o755))
	filePath := filepath.Join(homeDir, fileName)
	require.NoError(t, os.WriteFile(filePath, []byte("data"), 0o644))

	paths := []string{
		filepath.Join("~", dirName),
		dirPath,
		filepath.Join("~", fileName),
		filePath,
	}

	normalized := normalizeKubeconfigSearchPaths(paths)
	require.Equal(
		t,
		[]string{filepath.Join("~", dirName), filepath.Join("~", fileName), "~/.kube"},
		normalized,
	)
}

func TestApp_GetKubeconfigSearchPathsDefaults(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp()

	paths, err := app.GetKubeconfigSearchPaths()
	require.NoError(t, err)
	require.Equal(t, defaultKubeconfigSearchPaths(), paths)
}

func TestApp_SetKubeconfigSearchPathsPersistsAndDiscovers(t *testing.T) {
	setTestConfigEnv(t)
	app := NewApp()

	baseDir := t.TempDir()
	dirPath := filepath.Join(baseDir, "configs")
	require.NoError(t, os.MkdirAll(dirPath, 0o755))
	dirConfigPath := createTempKubeconfig(t, dirPath, "config", "dir-context")

	fileOnlyDir := filepath.Join(baseDir, "explicit")
	require.NoError(t, os.MkdirAll(fileOnlyDir, 0o755))
	fileOnlyPath := createTempKubeconfig(t, fileOnlyDir, "custom-config", "file-context")

	paths := []string{dirPath, "  ", fileOnlyPath, dirPath}
	require.NoError(t, app.SetKubeconfigSearchPaths(paths))

	settings, err := app.loadSettingsFile()
	require.NoError(t, err)
	require.Equal(t, []string{dirPath, fileOnlyPath, "~/.kube"}, settings.Kubeconfig.SearchPaths)

	require.NotEmpty(t, app.availableKubeconfigs)
	assert.True(t, hasKubeconfig(app.availableKubeconfigs, dirConfigPath, "dir-context"))
	assert.True(t, hasKubeconfig(app.availableKubeconfigs, fileOnlyPath, "file-context"))
}

func TestApp_GetSelectedKubeconfigs(t *testing.T) {
	app := NewApp()

	assert.Empty(t, app.GetSelectedKubeconfigs())

	app.selectedKubeconfigs = []string{"/path/one:ctx", "/path/two:other"}
	assert.Equal(t, []string{"/path/one:ctx", "/path/two:other"}, app.GetSelectedKubeconfigs())
}

func TestApp_SetKubeconfig(t *testing.T) {
	setTestConfigEnv(t)
	// Setup temp directory with kubeconfig
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	err := os.MkdirAll(kubeDir, 0755)
	require.NoError(t, err)

	configPath := createTempKubeconfig(t, kubeDir, "config", "default-context")
	testConfigPath := createTempKubeconfig(t, kubeDir, "test-config", "test-context")

	// Override home directory for kubeconfig expansion.
	t.Setenv("HOME", tempDir)

	app := NewApp()
	app.Ctx = context.Background()

	// Discover kubeconfigs first
	err = app.discoverKubeconfigs()
	require.NoError(t, err)

	tests := []struct {
		name           string
		kubeconfigPath string
		expectError    bool
		errorContains  string
	}{
		{
			name:           "set valid kubeconfig - validation only",
			kubeconfigPath: configPath + ":default-context",
			expectError:    false,
		},
		{
			name:           "set another valid kubeconfig - validation only",
			kubeconfigPath: testConfigPath + ":test-context",
			expectError:    false,
		},
		{
			name:           "set non-existent kubeconfig",
			kubeconfigPath: "/non/existent/path:nonexistent-context",
			expectError:    true,
			errorContains:  "kubeconfig context not found",
		},
		{
			name: "set invalid kubeconfig",
			kubeconfigPath: func() string {
				invalidPath := filepath.Join(kubeDir, "invalid")
				os.WriteFile(invalidPath, []byte("invalid content"), 0644)
				// Add to available configs to test validation
				app.availableKubeconfigs = append(app.availableKubeconfigs, KubeconfigInfo{
					Name:    "invalid",
					Path:    invalidPath,
					Context: "invalid-context",
				})
				return invalidPath + ":invalid-context"
			}(),
			expectError:   true,
			errorContains: "failed to build config from",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := app.SetKubeconfig(tt.kubeconfigPath)

			if tt.expectError {
				assert.Error(t, err)
				if tt.errorContains != "" {
					assert.Contains(t, err.Error(), tt.errorContains)
				}
			} else {
				assert.NoError(t, err)
				assert.Equal(t, []string{tt.kubeconfigPath}, app.selectedKubeconfigs)
			}
			// Serialize teardown with auth/watcher mutation paths under race mode.
			app.selectionMutationMu.Lock()
			app.teardownRefreshSubsystem()
			app.selectionMutationMu.Unlock()
		})
	}
}

func TestApp_SetSelectedKubeconfigs(t *testing.T) {
	setTestConfigEnv(t)
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	require.NoError(t, os.MkdirAll(kubeDir, 0755))

	configPath := createTempKubeconfig(t, kubeDir, "config", "default-context")
	testConfigPath := createTempKubeconfig(t, kubeDir, "test-config", "test-context")

	t.Setenv("HOME", tempDir)

	app := NewApp()
	app.Ctx = context.Background()
	app.kubeClientInitializer = func() error { return nil }

	require.NoError(t, app.discoverKubeconfigs())

	selections := []string{configPath + ":default-context", testConfigPath + ":test-context"}
	require.NoError(t, app.SetSelectedKubeconfigs(selections))

	assert.Equal(t, selections, app.selectedKubeconfigs)
	assert.GreaterOrEqual(t, app.selectionGeneration.Load(), uint64(1))
	require.NotNil(t, app.appSettings)
	assert.Equal(t, selections, app.appSettings.SelectedKubeconfigs)
	// Serialize teardown with auth/watcher mutation paths under race mode.
	app.selectionMutationMu.Lock()
	app.teardownRefreshSubsystem()
	app.selectionMutationMu.Unlock()
}

func TestApp_SetSelectedKubeconfigsAllowsSameContextNameFromDifferentFiles(t *testing.T) {
	setTestConfigEnv(t)
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	require.NoError(t, os.MkdirAll(kubeDir, 0755))

	configPath := createTempKubeconfig(t, kubeDir, "config", "same-context")
	testConfigPath := createTempKubeconfig(t, kubeDir, "test-config", "same-context")

	t.Setenv("HOME", tempDir)

	app := NewApp()
	app.Ctx = context.Background()
	app.kubeClientInitializer = func() error { return nil }

	require.NoError(t, app.discoverKubeconfigs())

	// Same context name from different files should be allowed.
	selections := []string{configPath + ":same-context", testConfigPath + ":same-context"}
	err := app.SetSelectedKubeconfigs(selections)
	require.NoError(t, err)
}

func TestApp_SetSelectedKubeconfigsRejectsDuplicateSelections(t *testing.T) {
	setTestConfigEnv(t)
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	require.NoError(t, os.MkdirAll(kubeDir, 0755))

	configPath := createTempKubeconfig(t, kubeDir, "config", "my-context")

	t.Setenv("HOME", tempDir)

	app := NewApp()
	app.Ctx = context.Background()
	app.kubeClientInitializer = func() error { return nil }

	require.NoError(t, app.discoverKubeconfigs())

	// Exact same selection twice should be rejected.
	selections := []string{configPath + ":my-context", configPath + ":my-context"}
	err := app.SetSelectedKubeconfigs(selections)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate selection")
}

func TestApp_SetSelectedKubeconfigsClearsSelection(t *testing.T) {
	setTestConfigEnv(t)
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)

	app := NewApp()
	app.Ctx = context.Background()
	app.selectedKubeconfigs = []string{"/path/to/config:ctx"}

	require.NoError(t, app.SetSelectedKubeconfigs(nil))
	assert.Empty(t, app.selectedKubeconfigs)
	require.NotNil(t, app.appSettings)
	assert.Empty(t, app.appSettings.SelectedKubeconfigs)
}

func TestApp_discoverKubeconfigs_noAutoSelection(t *testing.T) {
	setTestConfigEnv(t)
	// Setup temp directory with multiple kubeconfigs
	tempDir := t.TempDir()
	kubeDir := filepath.Join(tempDir, ".kube")
	err := os.MkdirAll(kubeDir, 0755)
	require.NoError(t, err)

	configPath := createTempKubeconfig(t, kubeDir, "config", "default-context")
	createTempKubeconfig(t, kubeDir, "test-config", "test-context")

	// Override home directory for kubeconfig expansion.
	t.Setenv("HOME", tempDir)

	app := NewApp()
	ctx := context.Background()

	// Setup app state (avoid startup which has runtime calls)
	app.Ctx = ctx
	app.setupEnvironment()
	err = app.discoverKubeconfigs()
	require.NoError(t, err)

	// Verify kubeconfigs were discovered but not auto-selected
	assert.Equal(t, ctx, app.Ctx)
	assert.Len(t, app.availableKubeconfigs, 2)
	assert.Empty(t, app.selectedKubeconfigs) // No auto-selection

	// Verify default config is marked correctly
	foundDefault := false
	for _, kc := range app.availableKubeconfigs {
		if kc.IsDefault {
			foundDefault = true
			assert.Equal(t, configPath, kc.Path)
		}
	}
	assert.True(t, foundDefault)
}
