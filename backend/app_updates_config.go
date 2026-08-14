package backend

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// applicationUpdatePublicKey remains empty until the one-time updater signing
// key is provisioned. Released builds fail closed while no trust root exists.
var applicationUpdatePublicKey []byte

type ApplicationUpdateOptions struct {
	TempRoot       string
	TempSetupError error
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

	publicKey := applicationUpdatePublicKey
	var provider updater.Provider
	clientAvailable := a.wailsApplication != nil && a.wailsApplication.Updater != nil
	if eligibility.CanInitialize && options.TempSetupError == nil && options.TempRoot != "" &&
		len(publicKey) > 0 && clientAvailable {
		configuredProvider, err := newEndpointUpdateProvider(updateManifestURL, eligibility.Release, nil)
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
		TempRoot: options.TempRoot, OnChange: a.storeApplicationUpdateSnapshot,
	})
	a.applicationUpdates = coordinator
	if a.wailsApplication != nil {
		a.applicationUpdateEventUnsubscribers = subscribeApplicationUpdateEvents(
			a.wailsApplication.Event,
			coordinator,
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
