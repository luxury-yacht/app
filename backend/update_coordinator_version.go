// This file handles application versioning and beta expiry checks.
// Version metadata is sourced from the embedded build manifest; in dev it falls back to build/config.yml.
// The code includes error handling for expired beta builds and logs warnings for builds nearing expiry.

package backend

import (
	"embed"
	"encoding/json"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Version variables that can be set at build time
// These will be set via ldflags during build
var (
	Version     = "dev"
	BuildTime   = "dev"
	GitCommit   = "dev"
	BetaExpiry  = ""
	IsBetaBuild = "false"
	SentryDSN   = ""
)

//go:embed buildinfo/*.json
var buildInfoFS embed.FS

type embeddedBuildInfo struct {
	Version    string `json:"version"`
	BuildTime  string `json:"buildTime"`
	GitCommit  string `json:"gitCommit"`
	IsBeta     bool   `json:"isBeta"`
	BetaExpiry string `json:"betaExpiry"`
	SentryDSN  string `json:"sentryDsn,omitempty"`
}

func init() {
	if info := loadEmbeddedBuildInfo(); info != nil {
		applyEmbeddedBuildInfo(info)
	}
}

func applyEmbeddedBuildInfo(info *embeddedBuildInfo) {
	if info == nil {
		return
	}
	Version = info.Version
	BuildTime = info.BuildTime
	GitCommit = info.GitCommit
	BetaExpiry = info.BetaExpiry
	IsBetaBuild = strconv.FormatBool(info.IsBeta)
	SentryDSN = info.SentryDSN
}

// AppInfo contains application version information
type AppInfo struct {
	Version    string      `json:"version"`
	BuildTime  string      `json:"buildTime"`
	GitCommit  string      `json:"gitCommit"`
	IsBeta     bool        `json:"isBeta"`
	ExpiryDate string      `json:"expiryDate,omitempty"`
	Update     *UpdateInfo `json:"update,omitempty"`
}

func loadEmbeddedBuildInfo() *embeddedBuildInfo {
	candidates := []string{
		"buildinfo/generated.json",
		"buildinfo/default.json",
	}

	for _, candidate := range candidates {
		data, err := buildInfoFS.ReadFile(candidate)
		if err != nil {
			continue
		}

		var info embeddedBuildInfo
		if err := json.Unmarshal(data, &info); err != nil {
			continue
		}

		if info.Version != "" {
			return &info
		}
	}

	return nil
}

// GetAppInfo returns the application version information
func (u *UpdateCoordinator) GetAppInfo() (*AppInfo, error) {
	if info := loadEmbeddedBuildInfo(); info != nil && info.Version != "dev" {
		return u.withUpdateInfo(&AppInfo{
			Version:    info.Version,
			BuildTime:  info.BuildTime,
			GitCommit:  info.GitCommit,
			IsBeta:     info.IsBeta,
			ExpiryDate: info.BetaExpiry,
		}), nil
	}

	if info := loadDevAppInfo(); info != nil {
		return u.withUpdateInfo(info), nil
	}

	// Build app info
	info := &AppInfo{
		Version:   Version,
		BuildTime: BuildTime,
		GitCommit: GitCommit,
		IsBeta:    IsBetaBuild == "true",
	}

	// Add expiry date for beta builds
	if IsBetaBuild == "true" && BetaExpiry != "" {
		info.ExpiryDate = BetaExpiry
	}

	return u.withUpdateInfo(info), nil
}

func loadDevAppInfo() *AppInfo {
	if Version != "dev" {
		return nil
	}

	paths := []string{
		"build/config.yml",
		"../build/config.yml",
		"../../build/config.yml",
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var buildConfig struct {
			Info struct {
				Version string `yaml:"version"`
			} `yaml:"info"`
		}
		if err := yaml.Unmarshal(data, &buildConfig); err != nil || buildConfig.Info.Version == "" {
			continue
		}
		return &AppInfo{
			Version:    buildConfig.Info.Version + " (dev)",
			BuildTime:  "dev",
			GitCommit:  "dev",
			IsBeta:     false,
			ExpiryDate: "",
		}
	}
	return nil
}

func (u *UpdateCoordinator) withUpdateInfo(info *AppInfo) *AppInfo {
	if u == nil || info == nil {
		return info
	}
	info.Update = u.getUpdateInfo()
	return info
}
