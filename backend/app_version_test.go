package backend

import (
	"testing"
	"time"
)

func TestGetAppInfoDevReadsWails(t *testing.T) {
	origVersion, origBuild, origCommit := Version, BuildTime, GitCommit
	t.Cleanup(func() {
		Version, BuildTime, GitCommit = origVersion, origBuild, origCommit
	})
	Version, BuildTime, GitCommit = "dev", "dev", "dev"

	app := &App{}
	info, err := app.GetAppInfo()
	if err != nil {
		t.Fatalf("GetAppInfo error: %v", err)
	}
	if embedded := loadEmbeddedBuildInfo(); embedded != nil && embedded.Version != "dev" {
		if info.Version != embedded.Version || info.BuildTime != embedded.BuildTime || info.GitCommit != embedded.GitCommit || info.IsBeta != embedded.IsBeta || info.ExpiryDate != embedded.BetaExpiry {
			t.Fatalf("expected embedded build info %+v, got %+v", embedded, info)
		}
		return
	}
	if info.Version != "1.0.0-beta.1" || info.BuildTime != "dev" || info.GitCommit != "dev" || info.IsBeta {
		t.Fatalf("unexpected app info: %+v", info)
	}
}

func TestGetAppInfoNonDevUsesLdflags(t *testing.T) {
	origVersion, origBuild, origCommit := Version, BuildTime, GitCommit
	t.Cleanup(func() {
		Version, BuildTime, GitCommit = origVersion, origBuild, origCommit
	})
	Version = "1.0.0"
	BuildTime = "2024-01-01T00:00:00Z"
	GitCommit = "abc123"
	IsBetaBuild = "false"

	app := &App{}
	info, err := app.GetAppInfo()
	if err != nil {
		t.Fatalf("GetAppInfo error: %v", err)
	}
	if embedded := loadEmbeddedBuildInfo(); embedded != nil && embedded.Version != "dev" {
		if info.Version != embedded.Version || info.BuildTime != embedded.BuildTime || info.GitCommit != embedded.GitCommit || info.IsBeta != embedded.IsBeta || info.ExpiryDate != embedded.BetaExpiry {
			t.Fatalf("expected embedded build info %+v, got %+v", embedded, info)
		}
		return
	}
	if info.Version != Version || info.BuildTime != BuildTime || info.GitCommit != GitCommit || info.IsBeta {
		t.Fatalf("unexpected info: %+v", info)
	}
}

func TestGetAppInfoIncludesBetaMetadata(t *testing.T) {
	origVersion, origBuild, origCommit, origBeta, origIsBeta := Version, BuildTime, GitCommit, BetaExpiry, IsBetaBuild
	t.Cleanup(func() {
		Version, BuildTime, GitCommit, BetaExpiry, IsBetaBuild = origVersion, origBuild, origCommit, origBeta, origIsBeta
	})

	Version = "2.0.0-beta.1"
	BuildTime = "2024-11-01T00:00:00Z"
	GitCommit = "ffeed"
	IsBetaBuild = "true"
	BetaExpiry = "2025-01-01T00:00:00Z"

	app := &App{}
	info, err := app.GetAppInfo()
	if err != nil {
		t.Fatalf("GetAppInfo error: %v", err)
	}
	if embedded := loadEmbeddedBuildInfo(); embedded != nil && embedded.Version != "dev" {
		if !info.IsBeta || info.ExpiryDate != embedded.BetaExpiry {
			t.Fatalf("expected embedded beta metadata %+v, got %+v", embedded, info)
		}
		return
	}
	if !info.IsBeta || info.ExpiryDate != BetaExpiry {
		t.Fatalf("expected beta metadata to be preserved, got %+v", info)
	}
}

func TestCheckBetaExpiryValidations(t *testing.T) {
	origVersion, origBeta, origIsBeta := Version, BetaExpiry, IsBetaBuild
	t.Cleanup(func() {
		Version, BetaExpiry, IsBetaBuild = origVersion, origBeta, origIsBeta
	})
	app := &App{logger: NewLogger(5)}

	// invalid format
	BetaExpiry = "not-a-time"
	Version = "1.2.3"
	IsBetaBuild = "true"
	err := app.checkBetaExpiry()
	if err == nil {
		t.Fatalf("expected error for invalid beta expiry")
	}

	// expired beta
	expired := time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339)
	BetaExpiry = expired
	Version = "1.0.0"
	err = app.checkBetaExpiry()
	if err == nil || err.Error() == "" {
		t.Fatalf("expected expiry error, got %v", err)
	}

	// valid, near expiry should warn but not error
	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	BetaExpiry = future
	err = app.checkBetaExpiry()
	if err != nil {
		t.Fatalf("expected no error for future beta, got %v", err)
	}
}

func TestCheckBetaExpirySkippedForNonBeta(t *testing.T) {
	origVersion, origBeta, origIsBeta := Version, BetaExpiry, IsBetaBuild
	t.Cleanup(func() {
		Version, BetaExpiry, IsBetaBuild = origVersion, origBeta, origIsBeta
	})

	Version = "1.0.0"
	BetaExpiry = time.Now().Add(-24 * time.Hour).Format(time.RFC3339)
	IsBetaBuild = "false"

	app := &App{}
	if err := app.checkBetaExpiry(); err != nil {
		t.Fatalf("expected skip for non-beta builds, got %v", err)
	}
}
