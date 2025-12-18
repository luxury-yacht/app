package mage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type manifestInfo struct {
	BetaExpiry string `json:"betaExpiry,omitempty"`
	BuildTime  string `json:"buildTime"`
	IsBeta     bool   `json:"isBeta"`
	GitCommit  string `json:"gitCommit"`
	Version    string `json:"version"`
}

func generateBuildManifest(cfg BuildConfig) error {
	info := manifestInfo{
		BetaExpiry: cfg.BetaExpiry,
		BuildTime:  cfg.BuildTime,
		IsBeta:     cfg.IsBeta,
		GitCommit:  cfg.Commit,
		Version:    cfg.Version,
	}

	writeManifest(cfg.ManifestPath, info)
	return nil
}

func writeManifest(path string, info manifestInfo) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}

	fmt.Println("\n✏️ Writing build manifest to", path)
	fmt.Println(string(data))

	return os.WriteFile(path, data, 0o644)
}
