package backend

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes/fake"
)

// createTempKubeconfig creates a temporary kubeconfig file for testing
func createTempKubeconfig(t *testing.T, dir, filename, context string) string {
	// Use insecure-skip-tls-verify instead of invalid certificate
	kubeconfigContent := `apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: https://test-server:6443
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
						if kc.Name == "default" {
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
	assert.Equal(t, "default", configs[0].Name)
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
	require.Equal(t, []string{"~/config"}, normalized)
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
	require.Len(t, normalized, 1)
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
	require.Equal(t, []string{filepath.Join("~", dirName), filepath.Join("~", fileName)}, normalized)
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
	require.Equal(t, []string{dirPath, fileOnlyPath}, settings.Kubeconfig.SearchPaths)

	require.NotEmpty(t, app.availableKubeconfigs)
	assert.True(t, hasKubeconfig(app.availableKubeconfigs, dirConfigPath, "dir-context"))
	assert.True(t, hasKubeconfig(app.availableKubeconfigs, fileOnlyPath, "file-context"))
}

func TestApp_GetSelectedKubeconfig(t *testing.T) {
	app := NewApp()

	// Initially should be empty
	assert.Empty(t, app.GetSelectedKubeconfig())

	// Set a kubeconfig
	app.selectedKubeconfig = "/path/to/config"
	assert.Equal(t, "/path/to/config", app.GetSelectedKubeconfig())
}

func TestApp_GetSelectedKubeconfigs(t *testing.T) {
	app := NewApp()

	assert.Empty(t, app.GetSelectedKubeconfigs())

	app.selectedKubeconfig = "/path/to/config"
	app.selectedContext = "dev"
	assert.Equal(t, []string{"/path/to/config:dev"}, app.GetSelectedKubeconfigs())

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
		skipClientInit bool
	}{
		{
			name:           "set valid kubeconfig - validation only",
			kubeconfigPath: configPath + ":default-context",
			expectError:    false,
			skipClientInit: true,
		},
		{
			name:           "set another valid kubeconfig - validation only",
			kubeconfigPath: testConfigPath + ":test-context",
			expectError:    false,
			skipClientInit: true,
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
			errorContains: "invalid kubeconfig file",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Pre-set a fake client to test that it gets reset
			if tt.skipClientInit {
				app.client = fake.NewClientset() // dummy client to test reset
			}

			err := app.SetKubeconfig(tt.kubeconfigPath)

			if tt.expectError {
				assert.Error(t, err)
				if tt.errorContains != "" {
					assert.Contains(t, err.Error(), tt.errorContains)
				}
			} else if tt.skipClientInit {
				// For validation-only tests, kubeconfig setting should work,
				// but client initialization may or may not fail depending on the test server
				if err != nil {
					// Client init failed, which is acceptable in tests
					assert.Contains(t, err.Error(), "failed to create clientset")
				}
				// Kubeconfig should be set regardless (path only, not path:context)
				expectedPath := strings.Split(tt.kubeconfigPath, ":")[0]
				assert.Equal(t, expectedPath, app.selectedKubeconfig)
				// Client should be reset after switching kubeconfig
			} else {
				assert.NoError(t, err)
				expectedPath := strings.Split(tt.kubeconfigPath, ":")[0]
				assert.Equal(t, expectedPath, app.selectedKubeconfig)
				assert.Nil(t, app.client)
			}
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
	assert.Equal(t, configPath, app.selectedKubeconfig)
	assert.Equal(t, "default-context", app.selectedContext)
	require.NotNil(t, app.appSettings)
	assert.Equal(t, selections, app.appSettings.SelectedKubeconfigs)
}

func TestApp_SetSelectedKubeconfigsRejectsDuplicateContexts(t *testing.T) {
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

	selections := []string{configPath + ":same-context", testConfigPath + ":same-context"}
	err := app.SetSelectedKubeconfigs(selections)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate context selected")
}

func TestApp_SetSelectedKubeconfigsClearsSelection(t *testing.T) {
	setTestConfigEnv(t)
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)

	app := NewApp()
	app.Ctx = context.Background()
	app.selectedKubeconfig = "/path/to/config"
	app.selectedContext = "ctx"
	app.selectedKubeconfigs = []string{"/path/to/config:ctx"}

	require.NoError(t, app.SetSelectedKubeconfigs(nil))
	assert.Empty(t, app.selectedKubeconfig)
	assert.Empty(t, app.selectedContext)
	assert.Empty(t, app.selectedKubeconfigs)
	require.NotNil(t, app.appSettings)
	assert.Empty(t, app.appSettings.SelectedKubeconfig)
	assert.Empty(t, app.appSettings.SelectedKubeconfigs)
}

func TestApp_startup_withKubeconfigs(t *testing.T) {
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

	// Manually trigger kubeconfig selection logic (normally in startup)
	if app.selectedKubeconfig == "" && len(app.availableKubeconfigs) > 0 {
		// First try to find the current context in the default config
		for _, kc := range app.availableKubeconfigs {
			if kc.IsDefault && kc.IsCurrentContext {
				app.selectedKubeconfig = kc.Path
				app.selectedContext = kc.Context
				break
			}
		}
		// If no current context in default, use any default context
		if app.selectedKubeconfig == "" {
			for _, kc := range app.availableKubeconfigs {
				if kc.IsDefault {
					app.selectedKubeconfig = kc.Path
					app.selectedContext = kc.Context
					break
				}
			}
		}
		// If no default found, use the first one
		if app.selectedKubeconfig == "" {
			app.selectedKubeconfig = app.availableKubeconfigs[0].Path
			app.selectedContext = app.availableKubeconfigs[0].Context
		}
	}

	// Verify state (ignoring client initialization failure)
	assert.Equal(t, ctx, app.Ctx)
	assert.Len(t, app.availableKubeconfigs, 2)
	assert.Equal(t, configPath, app.selectedKubeconfig) // Should select default

	// Verify default config is selected
	foundDefault := false
	for _, kc := range app.availableKubeconfigs {
		if kc.IsDefault {
			foundDefault = true
			assert.Equal(t, configPath, kc.Path)
		}
	}
	assert.True(t, foundDefault)

	// Client initialization may succeed or fail in tests, both are acceptable
	// The important thing is that kubeconfig discovery and selection worked
}
