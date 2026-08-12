package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGenerateWritesManifestFromWailsConfigAndEnvironment(t *testing.T) {
	withoutEnvironment(t, sentryBackendDSN)
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yml")
	envPath := filepath.Join(root, ".env")
	outputPath := filepath.Join(root, "generated.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`info:
  version: "2.0.0-beta.4"
luxuryYacht:
  betaExpiryDays: 30
`), 0o600))
	require.NoError(t, os.WriteFile(envPath, []byte("SENTRY_BACKEND_DSN=https://public@example.com/1\n"), 0o600))
	var summary bytes.Buffer

	manifest, err := generateBuildMetadata(buildMetadataOptions{
		ConfigPath: configPath,
		EnvPath:    envPath,
		OutputPath: outputPath,
		Now:        func() time.Time { return time.Date(2026, time.August, 11, 12, 0, 0, 0, time.UTC) },
		GitCommit:  func() string { return "abc123def" },
		Summary:    &summary,
	})

	require.NoError(t, err)
	require.Equal(t, "2.0.0-beta.4", manifest.Version)
	require.True(t, manifest.IsBeta)
	require.Equal(t, "2026-09-10T12:00:00Z", manifest.BetaExpiry)
	require.Equal(t, "https://public@example.com/1", manifest.SentryDSN)
	require.NotContains(t, summary.String(), manifest.SentryDSN)
	require.Contains(t, summary.String(), `"sentryDsn": "<configured>"`)

	data, err := os.ReadFile(outputPath)
	require.NoError(t, err)
	var stored buildManifest
	require.NoError(t, json.Unmarshal(data, &stored))
	require.Equal(t, manifest, stored)
}

func TestGenerateDoesNotOverrideExportedEnvironment(t *testing.T) {
	t.Setenv("SENTRY_BACKEND_DSN", "https://exported@example.com/2")
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yml")
	envPath := filepath.Join(root, ".env")
	require.NoError(t, os.WriteFile(configPath, []byte(`info:
  version: "2.0.0"
`), 0o600))
	require.NoError(t, os.WriteFile(envPath, []byte("SENTRY_BACKEND_DSN=https://file@example.com/1\n"), 0o600))

	manifest, err := generateBuildMetadata(buildMetadataOptions{
		ConfigPath: configPath,
		EnvPath:    envPath,
		OutputPath: filepath.Join(root, "generated.json"),
		Now:        func() time.Time { return time.Unix(0, 0).UTC() },
		GitCommit:  func() string { return "abc123def" },
	})

	require.NoError(t, err)
	require.Equal(t, "https://exported@example.com/2", manifest.SentryDSN)
}

func TestGenerateAllowsMissingEnvironmentFileForStableBuild(t *testing.T) {
	withoutEnvironment(t, sentryBackendDSN)
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yml")
	require.NoError(t, os.WriteFile(configPath, []byte("info:\n  version: 2.0.0\n"), 0o600))

	manifest, err := generateBuildMetadata(buildMetadataOptions{
		ConfigPath: configPath,
		EnvPath:    filepath.Join(root, ".env"),
		OutputPath: filepath.Join(root, "generated.json"),
		Now:        func() time.Time { return time.Unix(0, 0).UTC() },
		GitCommit:  func() string { return " abc123def\n" },
	})

	require.NoError(t, err)
	require.False(t, manifest.IsBeta)
	require.Empty(t, manifest.BetaExpiry)
	require.Empty(t, manifest.SentryDSN)
	require.Equal(t, "abc123def", manifest.GitCommit)
}

func TestGenerateReportsInvalidInputs(t *testing.T) {
	root := t.TempDir()
	tests := map[string]struct {
		config string
		env    string
		output string
		want   string
	}{
		"missing config": {
			output: filepath.Join(root, "generated.json"),
			want:   "read Wails config",
		},
		"malformed config": {
			config: "info: [",
			output: filepath.Join(root, "generated.json"),
			want:   "parse Wails config",
		},
		"missing version": {
			config: "info: {}\n",
			output: filepath.Join(root, "generated.json"),
			want:   "has no info.version",
		},
		"malformed environment": {
			config: "info:\n  version: 2.0.0\n",
			env:    "SENTRY_BACKEND_DSN='unterminated",
			output: filepath.Join(root, "generated.json"),
			want:   "read environment",
		},
		"missing output": {
			config: "info:\n  version: 2.0.0\n",
			want:   "build manifest output path is required",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			caseRoot := t.TempDir()
			configPath := filepath.Join(caseRoot, "config.yml")
			if test.config != "" {
				require.NoError(t, os.WriteFile(configPath, []byte(test.config), 0o600))
			}
			envPath := ""
			if test.env != "" {
				envPath = filepath.Join(caseRoot, ".env")
				require.NoError(t, os.WriteFile(envPath, []byte(test.env), 0o600))
			}
			_, err := generateBuildMetadata(buildMetadataOptions{
				ConfigPath: configPath,
				EnvPath:    envPath,
				OutputPath: test.output,
			})
			require.ErrorContains(t, err, test.want)
		})
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}

func withoutEnvironment(t *testing.T, name string) {
	t.Helper()
	previous, existed := os.LookupEnv(name)
	require.NoError(t, os.Unsetenv(name))
	t.Cleanup(func() {
		if existed {
			require.NoError(t, os.Setenv(name, previous))
			return
		}
		require.NoError(t, os.Unsetenv(name))
	})
}

func TestGenerateReportsSummaryWriteFailure(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yml")
	require.NoError(t, os.WriteFile(configPath, []byte("info:\n  version: 2.0.0\n"), 0o600))

	_, err := generateBuildMetadata(buildMetadataOptions{
		ConfigPath: configPath,
		OutputPath: filepath.Join(root, "generated.json"),
		Summary:    failingWriter{},
	})

	require.EqualError(t, err, "encode build manifest summary: write failed")
}

func TestWindowsNumericVersion(t *testing.T) {
	tests := map[string]string{
		"v1.2.3":        "1.2.3.1000",
		"1.2.3-beta.5":  "1.2.3.5",
		"1.2.3-rc":      "1.2.3.0",
		"1.2.3+build.7": "1.2.3.1000",
	}
	for version, want := range tests {
		t.Run(version, func(t *testing.T) {
			got, err := windowsNumericVersion(version)
			require.NoError(t, err)
			require.Equal(t, want, got)
		})
	}
}

func TestWindowsNumericVersionRejectsInvalidVersion(t *testing.T) {
	_, err := windowsNumericVersion("beta")
	require.EqualError(t, err, `invalid semantic version "beta"`)
}
