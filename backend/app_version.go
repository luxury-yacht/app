// This file handles application versioning and beta expiry checks.
// Version metadata is sourced from the embedded build manifest; in dev it falls back to wails.json.
// The code includes error handling for expired beta builds and logs warnings for builds nearing expiry.

package backend

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Version variables that can be set at build time
// These will be set via ldflags during build
var (
	Version     = "dev"
	BuildTime   = "dev"
	GitCommit   = "dev"
	BetaExpiry  = ""
	IsBetaBuild = "false"
)

//go:embed buildinfo/*.json
var buildInfoFS embed.FS

type embeddedBuildInfo struct {
	Version    string `json:"version"`
	BuildTime  string `json:"buildTime"`
	GitCommit  string `json:"gitCommit"`
	IsBeta     bool   `json:"isBeta"`
	BetaExpiry string `json:"betaExpiry"`
}

func init() {
	if info := loadEmbeddedBuildInfo(); info != nil {
		Version = info.Version
		BuildTime = info.BuildTime
		GitCommit = info.GitCommit
		BetaExpiry = info.BetaExpiry
		IsBetaBuild = strconv.FormatBool(info.IsBeta)
	}
}

// AppInfo contains application version information
type AppInfo struct {
	Version    string `json:"version"`
	BuildTime  string `json:"buildTime"`
	GitCommit  string `json:"gitCommit"`
	IsBeta     bool   `json:"isBeta"`
	ExpiryDate string `json:"expiryDate,omitempty"`
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
func (a *App) GetAppInfo() (*AppInfo, error) {
	if a != nil {
		// Ensure the update check is started so callers can read cached results.
		a.startUpdateCheck()
	}
	if info := loadEmbeddedBuildInfo(); info != nil && info.Version != "dev" {
		return a.withUpdateInfo(&AppInfo{
			Version:    info.Version,
			BuildTime:  info.BuildTime,
			GitCommit:  info.GitCommit,
			IsBeta:     info.IsBeta,
			ExpiryDate: info.BetaExpiry,
		}), nil
	}

	// In dev mode, try to read version from wails.json
	if Version == "dev" {
		// Try multiple paths to find wails.json
		paths := []string{
			"wails.json",
			"../wails.json",
			"../../wails.json",
			"/Volumes/git/personal/luxury-yacht/wails.json",
			"/Users/john/git/personal/luxury-yacht/wails.json",
		}

		for _, path := range paths {
			if data, err := os.ReadFile(path); err == nil {
				var wailsConfig struct {
					Info struct {
						ProductVersion string `json:"productVersion"`
					} `json:"info"`
				}

				if err := json.Unmarshal(data, &wailsConfig); err == nil && wailsConfig.Info.ProductVersion != "" {
					return a.withUpdateInfo(&AppInfo{
						Version:    wailsConfig.Info.ProductVersion + " (dev)",
						BuildTime:  "dev",
						GitCommit:  "dev",
						IsBeta:     false,
						ExpiryDate: "",
					}), nil
				}
			}
		}
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

	return a.withUpdateInfo(info), nil
}

func (a *App) withUpdateInfo(info *AppInfo) *AppInfo {
	if a == nil || info == nil {
		return info
	}
	info.Update = a.getUpdateInfo()
	return info
}

// CheckBetaExpiry checks if this is a beta build and if it has expired
// Returns an error if the beta has expired
func (a *App) checkBetaExpiry() error {
	// Skip check for non-beta builds
	if IsBetaBuild != "true" || BetaExpiry == "" {
		return nil
	}

	// Skip check in dev mode
	if Version == "dev" {
		return nil
	}

	// Parse expiry date
	expiryTime, err := time.Parse(time.RFC3339, BetaExpiry)
	if err != nil {
		return fmt.Errorf("invalid beta expiry date format: %v", err)
	}

	// Check if expired
	if time.Now().After(expiryTime) {
		daysAgo := int(time.Since(expiryTime).Hours() / 24)
		return fmt.Errorf("this beta version expired %d days ago (on %s). Please download the latest version",
			daysAgo, expiryTime.Format("January 2, 2006"))
	}

	// Calculate days until expiry for logging
	daysLeft := int(time.Until(expiryTime).Hours() / 24)
	if daysLeft <= 7 && a != nil && a.logger != nil {
		// Warning if expiring soon
		message := fmt.Sprintf("Beta build expires in %d day(s) on %s", daysLeft, expiryTime.Format("January 2, 2006"))
		a.logger.Warn(message, "App")
	}

	return nil
}
