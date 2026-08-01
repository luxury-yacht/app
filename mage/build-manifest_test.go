package mage

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGenerateBuildManifestIncludesBackendSentryDSN(t *testing.T) {
	manifestPath := filepath.Join(t.TempDir(), "generated.json")
	cfg := BuildConfig{
		ManifestPath: manifestPath,
		Version:      "v1.2.3",
		SentryDSN:    "https://public@example.com/1",
	}

	require.NoError(t, generateBuildManifest(cfg))
	data, err := os.ReadFile(manifestPath)
	require.NoError(t, err)

	var manifest map[string]any
	require.NoError(t, json.Unmarshal(data, &manifest))
	require.Equal(t, "https://public@example.com/1", manifest["sentryDsn"])
}

func TestWriteManifestSummaryRedactsBackendSentryDSN(t *testing.T) {
	var output bytes.Buffer
	info := manifestInfo{
		Version:   "v1.2.3",
		SentryDSN: "https://public@example.com/1",
	}

	require.NoError(t, writeManifestSummary(&output, info))
	require.NotContains(t, output.String(), "https://public@example.com/1")
	require.Contains(t, output.String(), `"sentryDsn": "\u003cconfigured\u003e"`)
}
