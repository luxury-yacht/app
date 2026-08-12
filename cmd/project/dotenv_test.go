package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadDotEnvLoadsValuesWithoutOverwritingEnvironment(t *testing.T) {
	t.Setenv("SENTRY_ORG", "exported-org")
	previousDSN, hadPreviousDSN := os.LookupEnv("SENTRY_FRONTEND_DSN")
	require.NoError(t, os.Unsetenv("SENTRY_FRONTEND_DSN"))
	t.Cleanup(func() {
		if hadPreviousDSN {
			require.NoError(t, os.Setenv("SENTRY_FRONTEND_DSN", previousDSN))
			return
		}
		require.NoError(t, os.Unsetenv("SENTRY_FRONTEND_DSN"))
	})

	envPath := filepath.Join(t.TempDir(), ".env")
	require.NoError(t, os.WriteFile(envPath, []byte(
		"SENTRY_ORG=file-org\nSENTRY_FRONTEND_DSN=https://public@example.com/1\n",
	), 0o600))

	require.NoError(t, LoadDotEnv(envPath))
	require.Equal(t, "exported-org", os.Getenv("SENTRY_ORG"))
	require.Equal(t, "https://public@example.com/1", os.Getenv("SENTRY_FRONTEND_DSN"))
}

func TestLoadDotEnvAllowsMissingFile(t *testing.T) {
	require.NoError(t, LoadDotEnv(filepath.Join(t.TempDir(), ".env")))
}

func TestNewBuildConfigFromDotEnvRejectsMalformedFile(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env")
	require.NoError(t, os.WriteFile(
		envPath,
		[]byte("SENTRY_ORG='unterminated\n"),
		0o600,
	))
	t.Chdir("..")

	_, err := NewBuildConfigFromDotEnv(envPath)
	require.ErrorContains(t, err, "load environment from")
}
