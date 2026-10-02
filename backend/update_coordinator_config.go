package backend

import (
	_ "embed" // Enables go:embed for the pinned updater public key.
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/appstate"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatestate"
	"github.com/luxury-yacht/app/internal/updatetemp"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

//go:embed updater_public_key.pem
var applicationUpdatePublicKey []byte

type ApplicationUpdateOptions struct {
	TempRoot                       string
	TempSetupError                 error
	StatePath                      string
	ReconcileWindowsDisplayVersion func(string) error
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
	UpdaterTargets    []string
}

func (u *UpdateCoordinator) initializeApplicationUpdates(options ApplicationUpdateOptions) {
	if u == nil {
		return
	}
	u.resetState, u.resetStateErr = newApplicationUpdateStateStore(options)
	configuration := u.prepareApplicationUpdateConfiguration(options)
	var updateState appupdates.UpdateState
	if configuration.updateState != nil {
		updateState = configuration.updateState
	}
	coordinator := appupdates.New(appupdates.Dependencies{
		Client: configuration.client, Provider: configuration.provider,
		Eligibility: configuration.eligibility, PublicKey: applicationUpdatePublicKey,
		Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		TempRoot: options.TempRoot, UpdateState: updateState,
		Reconciled: configuration.reconciled, SkippedVersion: configuration.skippedVersion,
		OnChange: u.storeApplicationUpdateSnapshot,
	})
	u.coordinator = coordinator
	if u.shell != nil && u.shell.Application() != nil {
		u.unsubscribers = subscribeApplicationUpdateEvents(
			wailsApplicationUpdateEventSubscriber{events: u.shell.Application().Event},
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

func (u *UpdateCoordinator) prepareApplicationUpdateConfiguration(
	options ApplicationUpdateOptions,
) applicationUpdateConfiguration {
	eligibility := u.resolveApplicationUpdateEligibility(options)
	setup, eligibility := u.resolveApplicationUpdateState(options, eligibility)
	client := u.applicationUpdateClient()
	provider, eligibility := u.resolveApplicationUpdateProvider(options, client, eligibility)
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

func (u *UpdateCoordinator) resolveApplicationUpdateEligibility(
	options ApplicationUpdateOptions,
) updateidentity.BuildEligibility {
	eligibility := disabledApplicationUpdateEligibility()
	if options.TempSetupError != nil {
		u.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", options.TempSetupError), logsources.UpdateCheck)
		return eligibility
	}
	resolved, err := currentApplicationUpdateEligibility(time.Now())
	if err != nil {
		u.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", err), logsources.UpdateCheck)
		return eligibility
	}
	return resolved
}

func (u *UpdateCoordinator) resolveApplicationUpdateState(
	options ApplicationUpdateOptions,
	eligibility updateidentity.BuildEligibility,
) (*applicationUpdateStateSetup, updateidentity.BuildEligibility) {
	if options.TempSetupError != nil || options.TempRoot == "" || eligibility.Release.Version == "" {
		return nil, eligibility
	}
	setup, err := prepareApplicationUpdateState(options, eligibility)
	if err != nil {
		u.logger.Warn(fmt.Sprintf("Automatic update recovery state unavailable: %v", err), logsources.UpdateCheck)
		eligibility.CanInstall = false
		eligibility.Installation.CanInstall = false
		return nil, eligibility
	}
	u.logApplicationUpdateReconciliation(setup.Reconciled)
	if setup.MetadataReconcileError != nil {
		u.logger.Warn(
			fmt.Sprintf("Automatic update applied, but Windows Installed Apps metadata was not updated: %v", setup.MetadataReconcileError),
			logsources.UpdateCheck,
		)
	}
	return &setup, eligibility
}

func (u *UpdateCoordinator) applicationUpdateClient() appupdates.Client {
	if u.shell == nil {
		return nil
	}
	return u.shell.UpdateClient()
}

func (u *UpdateCoordinator) resolveApplicationUpdateProvider(
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
		u.logger.Warn(fmt.Sprintf("Automatic updates disabled: %v", err), logsources.UpdateCheck)
		return nil, disableApplicationUpdateInstallation(eligibility)
	}
	return provider, eligibility
}

type applicationUpdateStateSetup struct {
	Store                  *updatestate.Store
	Reconciled             updatestate.ReconcileResult
	SkippedVersion         string
	MetadataReconcileError error
}

func prepareApplicationUpdateState(
	options ApplicationUpdateOptions,
	eligibility updateidentity.BuildEligibility,
) (applicationUpdateStateSetup, error) {
	store, err := newApplicationUpdateStateStore(options)
	if err != nil {
		return applicationUpdateStateSetup{}, err
	}
	reconciled, err := store.Reconcile(eligibility.Release.Version)
	if err != nil {
		return applicationUpdateStateSetup{}, fmt.Errorf("reconcile application update state: %w", err)
	}
	var metadataReconcileError error
	if reconciled.Outcome == updatestate.OutcomeSucceeded &&
		reconciled.Distribution == updateidentity.DistributionWindowsNSIS {
		reconcileDisplayVersion := options.ReconcileWindowsDisplayVersion
		if reconcileDisplayVersion == nil {
			reconcileDisplayVersion = reconcileWindowsDisplayVersion
		}
		metadataReconcileError = reconcileDisplayVersion(reconciled.TargetVersion)
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
		MetadataReconcileError: metadataReconcileError,
	}, nil
}

func newApplicationUpdateStateStore(options ApplicationUpdateOptions) (*updatestate.Store, error) {
	if options.TempSetupError != nil {
		// No temp root was accepted as app-owned, so reset must leave that path
		// untouched instead of replaying the startup diagnostic as a reset failure.
		return nil, nil
	}
	if strings.TrimSpace(options.TempRoot) == "" {
		return nil, nil
	}
	statePath := strings.TrimSpace(options.StatePath)
	if statePath == "" {
		manifest, err := appstate.Resolve("luxury-yacht")
		if err != nil {
			return nil, fmt.Errorf("resolve application update config directory: %w", err)
		}
		statePath = manifest.UpdateStatePath()
	}
	return updatestate.New(updatestate.Config{
		StatePath: statePath,
		TempRoot:  options.TempRoot,
	})
}

func (u *UpdateCoordinator) logApplicationUpdateReconciliation(result updatestate.ReconcileResult) {
	switch result.Outcome {
	case updatestate.OutcomeSucceeded:
		u.logger.Info(
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
		u.logger.Error(message, logsources.UpdateCheck)
	case updatestate.OutcomeSuperseded:
		u.logger.Info(
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
		UpdaterTargets: UpdaterTargets,
	})
}

func resolveApplicationUpdateEligibility(runtimeInfo applicationUpdateRuntime) (updateidentity.BuildEligibility, error) {
	preliminary := updateidentity.ResolveBuild(updateidentity.BuildProbe{
		Version: runtimeInfo.Version, Server: runtimeInfo.Server, Now: runtimeInfo.Now,
		PayloadAvailable: true,
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
		PayloadAvailable: updateidentity.HasUpdaterTarget(
			runtimeInfo.UpdaterTargets, probe.Platform, probe.Architecture,
		),
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
