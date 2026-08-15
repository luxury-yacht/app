package backend

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatestate"
	"github.com/luxury-yacht/app/internal/updatetemp"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

//go:embed updater_public_key.pem
var applicationUpdatePublicKey []byte

type ApplicationUpdateOptions struct {
	TempRoot       string
	TempSetupError error
	StatePath      string
}

type applicationUpdateRuntime struct {
	Version           string
	BetaExpiry        string
	Now               time.Time
	Server            bool
	Platform          string
	Architecture      string
	ExecutablePath    string
	HomeDirectory     string
	PackageMarkerPath string
}

// ConfigureApplicationUpdates constructs the one process-owned update
// coordinator before application.Run without adding a frontend service method.
func ConfigureApplicationUpdates(app *App, options ApplicationUpdateOptions) {
	app.configureApplicationUpdates(options)
}

func (a *App) configureApplicationUpdates(options ApplicationUpdateOptions) {
	if a == nil {
		return
	}
	eligibility := disabledApplicationUpdateEligibility()
	if options.TempSetupError == nil {
		resolved, err := currentApplicationUpdateEligibility(time.Now())
		if err != nil {
			a.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", err), logsources.UpdateCheck)
		} else {
			eligibility = resolved
		}
	} else {
		a.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", options.TempSetupError), logsources.UpdateCheck)
	}

	var updateState *updatestate.Store
	var reconciled *updatestate.ReconcileResult
	var skippedVersion string
	if options.TempSetupError == nil && options.TempRoot != "" && eligibility.Release.Version != "" {
		setup, err := prepareApplicationUpdateState(options, eligibility)
		if err != nil {
			a.logger.Warn(fmt.Sprintf("Automatic update recovery state unavailable: %v", err), logsources.UpdateCheck)
			eligibility.CanInstall = false
			eligibility.Installation.CanInstall = false
		} else {
			updateState = setup.Store
			reconciled = &setup.Reconciled
			skippedVersion = setup.SkippedVersion
			a.logApplicationUpdateReconciliation(setup.Reconciled)
		}
	}

	publicKey := applicationUpdatePublicKey
	var provider updater.Provider
	clientAvailable := a.wailsApplication != nil && a.wailsApplication.Updater != nil
	if eligibility.CanInitialize && options.TempSetupError == nil && options.TempRoot != "" &&
		len(publicKey) > 0 && clientAvailable {
		configuredProvider, err := newGitHubManifestUpdateProvider(gitHubManifestUpdateProviderConfig{
			Repository: updateRepository,
			Current:    eligibility.Release,
		})
		if err != nil {
			a.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", err), logsources.UpdateCheck)
			eligibility = disableApplicationUpdateInstallation(eligibility)
		} else {
			provider = configuredProvider
		}
	} else if eligibility.CanInitialize {
		eligibility = disableApplicationUpdateInstallation(eligibility)
	}

	var client appupdates.Client
	if clientAvailable {
		client = a.wailsApplication.Updater
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: client, Provider: provider, Eligibility: eligibility,
		PublicKey: publicKey, Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		TempRoot: options.TempRoot, UpdateState: updateState, Reconciled: reconciled,
		SkippedVersion: skippedVersion,
		OnChange:       a.storeApplicationUpdateSnapshot,
	})
	a.applicationUpdates = coordinator
	if a.wailsApplication != nil {
		a.applicationUpdateEventUnsubscribers = subscribeApplicationUpdateEvents(
			a.wailsApplication.Event,
			coordinator,
		)
	}
}

type applicationUpdateStateSetup struct {
	Store          *updatestate.Store
	Reconciled     updatestate.ReconcileResult
	SkippedVersion string
}

func prepareApplicationUpdateState(
	options ApplicationUpdateOptions,
	eligibility updateidentity.BuildEligibility,
) (applicationUpdateStateSetup, error) {
	statePath := strings.TrimSpace(options.StatePath)
	if statePath == "" {
		configDirectory, err := os.UserConfigDir()
		if err != nil {
			return applicationUpdateStateSetup{}, fmt.Errorf("resolve application update config directory: %w", err)
		}
		statePath = filepath.Join(configDirectory, "luxury-yacht", "application-update.json")
	}
	store, err := updatestate.New(updatestate.Config{
		StatePath: statePath,
		TempRoot:  options.TempRoot,
	})
	if err != nil {
		return applicationUpdateStateSetup{}, err
	}
	reconciled, err := store.Reconcile(eligibility.Release.Version)
	if err != nil {
		return applicationUpdateStateSetup{}, fmt.Errorf("reconcile application update state: %w", err)
	}
	document, err := store.Load()
	if err != nil {
		return applicationUpdateStateSetup{}, fmt.Errorf("load reconciled application update state: %w", err)
	}
	if _, err := updatetemp.SweepOrphans(options.TempRoot, document.ProtectedPaths()); err != nil {
		return applicationUpdateStateSetup{}, fmt.Errorf("sweep orphaned application update staging: %w", err)
	}
	return applicationUpdateStateSetup{
		Store: store, Reconciled: reconciled, SkippedVersion: document.SkippedVersion,
	}, nil
}

func (a *App) logApplicationUpdateReconciliation(result updatestate.ReconcileResult) {
	switch result.Outcome {
	case updatestate.OutcomeSucceeded:
		a.logger.Info(
			fmt.Sprintf("Automatic update to %s applied successfully", result.TargetVersion),
			logsources.UpdateCheck,
		)
	case updatestate.OutcomeFailed:
		message := fmt.Sprintf(
			"Automatic update from %s to %s was not applied",
			result.SourceVersion,
			result.TargetVersion,
		)
		if result.HelperDiagnostic != "" {
			message += ": " + result.HelperDiagnostic
		}
		a.logger.Error(message, logsources.UpdateCheck)
	case updatestate.OutcomeSuperseded:
		a.logger.Info(
			fmt.Sprintf("Automatic update attempt to %s was superseded by version %s", result.TargetVersion, Version),
			logsources.UpdateCheck,
		)
	}
}

func currentApplicationUpdateEligibility(now time.Time) (updateidentity.BuildEligibility, error) {
	executablePath, err := os.Executable()
	if err != nil {
		return disabledApplicationUpdateEligibility(), fmt.Errorf("resolve application executable: %w", err)
	}
	homeDirectory, err := os.UserHomeDir()
	if err != nil && runtime.GOOS == "darwin" {
		return disabledApplicationUpdateEligibility(), fmt.Errorf("resolve application home directory: %w", err)
	}
	return resolveApplicationUpdateEligibility(applicationUpdateRuntime{
		Version: Version, BetaExpiry: BetaExpiry, Now: now,
		Server: updateidentity.CurrentBuildIsServer, Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		ExecutablePath: executablePath, HomeDirectory: homeDirectory,
	})
}

func resolveApplicationUpdateEligibility(runtimeInfo applicationUpdateRuntime) (updateidentity.BuildEligibility, error) {
	preliminary := updateidentity.ResolveBuild(updateidentity.BuildProbe{
		Version: runtimeInfo.Version, Server: runtimeInfo.Server, Now: runtimeInfo.Now,
	})
	switch preliminary.Status {
	case updateidentity.BuildDisabledDevelopment,
		updateidentity.BuildDisabledServer,
		updateidentity.BuildDisabledInvalidVersion:
		return preliminary, nil
	}

	var betaExpiry time.Time
	if preliminary.Release.Channel == updateidentity.ChannelBeta && strings.TrimSpace(runtimeInfo.BetaExpiry) != "" {
		parsed, err := time.Parse(time.RFC3339, runtimeInfo.BetaExpiry)
		if err != nil {
			return disabledApplicationUpdateEligibility(), fmt.Errorf("parse beta expiry for automatic updates: %w", err)
		}
		betaExpiry = parsed
	}
	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.Platform(runtimeInfo.Platform), Architecture: runtimeInfo.Architecture,
		ExecutablePath: runtimeInfo.ExecutablePath, HomeDirectory: runtimeInfo.HomeDirectory,
		PackageMarkerPath: runtimeInfo.PackageMarkerPath,
	})
	if err != nil {
		return disabledApplicationUpdateEligibility(), err
	}
	installation := updateidentity.ResolveInstallation(probe)
	return updateidentity.ResolveBuild(updateidentity.BuildProbe{
		Version: runtimeInfo.Version, Server: runtimeInfo.Server, BetaExpiry: betaExpiry,
		Now: runtimeInfo.Now, Installation: installation,
	}), nil
}

func disabledApplicationUpdateEligibility() updateidentity.BuildEligibility {
	return updateidentity.BuildEligibility{Status: updateidentity.BuildDisabledInstallation}
}

func disableApplicationUpdateInstallation(eligibility updateidentity.BuildEligibility) updateidentity.BuildEligibility {
	eligibility.CanInitialize = false
	eligibility.CanCheck = false
	eligibility.CanInstall = false
	return eligibility
}
