package backend

import (
	_ "embed" // Enables go:embed for the pinned updater public key.
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
	configuration := a.prepareApplicationUpdateConfiguration(options)
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: configuration.client, Provider: configuration.provider,
		Eligibility: configuration.eligibility, PublicKey: applicationUpdatePublicKey,
		Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		TempRoot: options.TempRoot, UpdateState: configuration.updateState,
		Reconciled: configuration.reconciled, SkippedVersion: configuration.skippedVersion,
		OnChange: a.storeApplicationUpdateSnapshot,
	})
	a.applicationUpdates = coordinator
	if a.wailsApplication != nil {
		a.applicationUpdateEventUnsubscribers = subscribeApplicationUpdateEvents(
			wailsApplicationUpdateEventSubscriber{events: a.wailsApplication.Event},
			coordinator,
		)
	}
}

type applicationUpdateConfiguration struct {
	client         appupdates.Client
	provider       updater.Provider
	eligibility    updateidentity.BuildEligibility
	updateState    *updatestate.Store
	reconciled     *updatestate.ReconcileResult
	skippedVersion string
}

func (a *App) prepareApplicationUpdateConfiguration(
	options ApplicationUpdateOptions,
) applicationUpdateConfiguration {
	eligibility := a.resolveApplicationUpdateEligibility(options)
	setup, eligibility := a.resolveApplicationUpdateState(options, eligibility)
	client := a.applicationUpdateClient()
	provider, eligibility := a.resolveApplicationUpdateProvider(options, client, eligibility)
	configuration := applicationUpdateConfiguration{
		client: client, provider: provider, eligibility: eligibility,
	}
	if setup != nil {
		configuration.updateState = setup.Store
		configuration.reconciled = &setup.Reconciled
		configuration.skippedVersion = setup.SkippedVersion
	}
	return configuration
}

func (a *App) resolveApplicationUpdateEligibility(
	options ApplicationUpdateOptions,
) updateidentity.BuildEligibility {
	eligibility := disabledApplicationUpdateEligibility()
	if options.TempSetupError != nil {
		a.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", options.TempSetupError), logsources.UpdateCheck)
		return eligibility
	}
	resolved, err := currentApplicationUpdateEligibility(time.Now())
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", err), logsources.UpdateCheck)
		return eligibility
	}
	return resolved
}

func (a *App) resolveApplicationUpdateState(
	options ApplicationUpdateOptions,
	eligibility updateidentity.BuildEligibility,
) (*applicationUpdateStateSetup, updateidentity.BuildEligibility) {
	if options.TempSetupError != nil || options.TempRoot == "" || eligibility.Release.Version == "" {
		return nil, eligibility
	}
	setup, err := prepareApplicationUpdateState(options, eligibility)
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Automatic update recovery state unavailable: %v", err), logsources.UpdateCheck)
		eligibility.CanInstall = false
		eligibility.Installation.CanInstall = false
		return nil, eligibility
	}
	a.logApplicationUpdateReconciliation(setup.Reconciled)
	return &setup, eligibility
}

func (a *App) applicationUpdateClient() appupdates.Client {
	if a.wailsApplication == nil || a.wailsApplication.Updater == nil {
		return nil
	}
	return a.wailsApplication.Updater
}

func (a *App) resolveApplicationUpdateProvider(
	options ApplicationUpdateOptions,
	client appupdates.Client,
	eligibility updateidentity.BuildEligibility,
) (updater.Provider, updateidentity.BuildEligibility) {
	canConfigure := eligibility.CanInitialize && options.TempSetupError == nil && options.TempRoot != "" &&
		len(applicationUpdatePublicKey) > 0 && client != nil
	if !canConfigure {
		if eligibility.CanInitialize {
			eligibility = disableApplicationUpdateInstallation(eligibility)
		}
		return nil, eligibility
	}
	provider, err := newGitHubManifestUpdateProvider(gitHubManifestUpdateProviderConfig{
		Repository: updateRepository,
		Current:    eligibility.Release,
	})
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", err), logsources.UpdateCheck)
		return nil, disableApplicationUpdateInstallation(eligibility)
	}
	return provider, eligibility
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
