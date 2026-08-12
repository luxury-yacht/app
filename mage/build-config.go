package mage

import (
	"fmt"
	"time"
)

type BuildConfig struct {
	AppShortName  string   // Short name of the application
	ArtifactsDir  string   // Directory where build artifacts are stored
	BetaExpiry    string   // Beta expiry date in RFC3339 format
	BuildDir      string   // Directory to place build outputs
	FrontendDir   string   // Directory of the frontend source code
	Commit        string   // Git commit hash
	IsBeta        bool     // Indicates if this is a beta build
	ManifestPath  string   // Path to the build manifest file
	PackagePath   string   // Go module package path
	ReleaseAssets []string // List of release asset file paths
	ReleaseRepo   string   // GitHub repository for releases
	Version       string   // Version of the app build
}

func NewBuildConfig() BuildConfig {
	appShortName := "luxury-yacht"
	frontendDir := "frontend"
	now := time.Now().UTC()

	version, err := getProductVersion()
	if err != nil {
		panic(fmt.Sprintf("failed to get app version: %v", err))
	}

	// Determine if this is a beta version and set beta expiry accordingly
	isBeta := isBeta(version)
	betaExpiryDays := 0
	if isBeta {
		betaExpiryDays, err = getBetaExpiryDays()
		if err != nil {
			panic(fmt.Sprintf("failed to get beta expiry days: %v", err))
		}
	}

	cfg := BuildConfig{
		AppShortName:  appShortName,
		ArtifactsDir:  "artifacts",
		BetaExpiry:    now.Add(time.Duration(betaExpiryDays) * 24 * time.Hour).Format(time.RFC3339),
		BuildDir:      "build",
		FrontendDir:   frontendDir,
		Commit:        gitRevParse(),
		IsBeta:        isBeta,
		ManifestPath:  "backend/buildinfo/generated.json",
		PackagePath:   "github.com/luxury-yacht/app",
		ReleaseAssets: []string{".deb", ".rpm", ".dmg", ".exe", ".zip"},
		ReleaseRepo:   "luxury-yacht/app",
		Version:       version,
	}

	return cfg
}
