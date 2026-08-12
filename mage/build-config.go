package mage

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"
)

type BuildConfig struct {
	AppLongName    string   // Long Name of the application
	AppShortName   string   // Short name of the application
	ArchType       string   // Architecture type (e.g., amd64, arm64)
	ArtifactsDir   string   // Directory where build artifacts are stored
	BetaExpiry     string   // Beta expiry date in RFC3339 format
	BetaExpiryDays int      // Number of days until beta expiry
	BuildDir       string   // Directory to place build outputs
	BuildTime      string   // Build time in RFC3339 format
	FrontendDir    string   // Directory of the frontend source code
	Commit         string   // Git commit hash
	IconSource     string   // Path to the icon source file
	IsBeta         bool     // Indicates if this is a beta build
	ManifestPath   string   // Path to the build manifest file
	OsType         string   // Operating system type (e.g., linux, windows)
	PackagePath    string   // Go module package path
	ReleaseAssets  []string // List of release asset file paths
	ReleaseRepo    string   // GitHub repository for releases
	SentryDSN      string   // Backend Sentry DSN embedded in release builds
	Version        string   // Version of the app build
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
		AppLongName:    "Luxury Yacht",
		AppShortName:   appShortName,
		ArchType:       runtime.GOARCH,
		ArtifactsDir:   "build/artifacts",
		BetaExpiry:     now.Add(time.Duration(betaExpiryDays) * 24 * time.Hour).Format(time.RFC3339),
		BetaExpiryDays: betaExpiryDays,
		BuildDir:       "build",
		BuildTime:      now.Format(time.RFC3339),
		FrontendDir:    frontendDir,
		Commit:         gitRevParse(),
		IconSource:     "frontend/src/assets/captain-k8s-color.png",
		IsBeta:         isBeta,
		ManifestPath:   "backend/buildinfo/generated.json",
		OsType:         runtime.GOOS,
		PackagePath:    "github.com/luxury-yacht/app",
		ReleaseAssets:  []string{".deb", ".rpm", ".dmg", ".exe", ".zip"},
		ReleaseRepo:    "luxury-yacht/app",
		SentryDSN:      strings.TrimSpace(os.Getenv("SENTRY_BACKEND_DSN")),
		Version:        version,
	}

	return cfg
}
