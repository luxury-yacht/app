package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadProjectMetadataFromWailsV3BuildConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yml")
	config := `version: '3'
info:
  version: "v2.0.0-beta.3"
luxuryYacht:
  betaExpiryDays: 45
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	metadata, err := readProjectMetadata(configPath)
	if err != nil {
		t.Fatalf("readProjectMetadata: %v", err)
	}
	if metadata.Info.Version != "v2.0.0-beta.3" {
		t.Errorf("Version = %q, want v2.0.0-beta.3", metadata.Info.Version)
	}
	if metadata.LuxuryYacht.BetaExpiryDays != 45 {
		t.Errorf("BetaExpiryDays = %d, want 45", metadata.LuxuryYacht.BetaExpiryDays)
	}
}
