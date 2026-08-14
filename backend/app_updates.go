package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

type UpdateInfo struct {
	Status            appupdates.Status                `json:"status"`
	CurrentVersion    string                           `json:"currentVersion,omitempty"`
	AvailableVersion  string                           `json:"availableVersion,omitempty"`
	ReleaseName       string                           `json:"releaseName,omitempty"`
	PublishedAt       string                           `json:"publishedAt,omitempty"`
	ReleaseNotes      string                           `json:"releaseNotes,omitempty"`
	ProgressPercent   *float64                         `json:"progressPercent,omitempty"`
	CanCheck          bool                             `json:"canCheck"`
	CanInstall        bool                             `json:"canInstall"`
	Distribution      updateidentity.Distribution      `json:"distribution,omitempty"`
	EligibilityReason updateidentity.EligibilityReason `json:"eligibilityReason,omitempty"`
	RecoveryTarget    updateidentity.RecoveryTarget    `json:"recoveryTarget,omitempty"`
	Error             string                           `json:"error,omitempty"`
}

var applicationUpdateEventNames = []string{
	updater.EventCheckStarted,
	updater.EventUpdateAvailable,
	updater.EventNoUpdate,
	updater.EventDownloadStarted,
	updater.EventDownloadProgress,
	updater.EventVerifying,
	updater.EventInstalling,
	updater.EventUpdateReady,
	updater.EventError,
}

type applicationUpdateEventRegistrar interface {
	On(string, func(*application.CustomEvent)) func()
}

type applicationUpdateEventProjector interface {
	HandleWailsEvent(string, any) appupdates.Snapshot
}

func subscribeApplicationUpdateEvents(
	registrar applicationUpdateEventRegistrar,
	projector applicationUpdateEventProjector,
) []func() {
	if registrar == nil || projector == nil {
		return nil
	}
	unsubscribers := make([]func(), 0, len(applicationUpdateEventNames))
	for _, eventName := range applicationUpdateEventNames {
		name := eventName
		unsubscribe := registrar.On(name, func(event *application.CustomEvent) {
			var payload any
			if event != nil {
				payload = event.Data
			}
			projector.HandleWailsEvent(name, payload)
		})
		unsubscribers = append(unsubscribers, unsubscribe)
	}
	return unsubscribers
}

func (a *App) storeApplicationUpdateSnapshot(snapshot appupdates.Snapshot) {
	if a == nil {
		return
	}
	info := updateInfoFromSnapshot(snapshot)
	a.emitEvent("app-update", info)
}

func (a *App) getUpdateInfo() *UpdateInfo {
	if a == nil || a.applicationUpdates == nil {
		return nil
	}
	return updateInfoFromSnapshot(a.applicationUpdates.Snapshot())
}

func updateInfoFromSnapshot(snapshot appupdates.Snapshot) *UpdateInfo {
	info := &UpdateInfo{
		Status:            snapshot.Status,
		CurrentVersion:    snapshot.CurrentVersion,
		AvailableVersion:  snapshot.AvailableVersion,
		ReleaseName:       snapshot.ReleaseName,
		PublishedAt:       snapshot.PublishedAt,
		ReleaseNotes:      snapshot.ReleaseNotes,
		CanCheck:          snapshot.CanCheck,
		CanInstall:        snapshot.CanInstall,
		Distribution:      snapshot.Distribution,
		EligibilityReason: snapshot.EligibilityReason,
		RecoveryTarget:    snapshot.RecoveryTarget,
		Error:             snapshot.Error,
	}
	if snapshot.ProgressPercent != nil {
		progress := *snapshot.ProgressPercent
		info.ProgressPercent = &progress
	}
	return info
}

// CheckForUpdates performs only release discovery. Download and restart remain
// separate user-consent commands.
func (a *App) CheckForUpdates() (*UpdateInfo, error) {
	if a == nil || a.applicationUpdates == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}), nil
	}
	snapshot, err := a.applicationUpdates.Check(a.CtxOrBackground())
	return updateInfoFromSnapshot(snapshot), err
}

// showAboutAndCheckForUpdates gives native menu users immediate feedback while
// keeping the provider request off the platform menu callback.
func (a *App) showAboutAndCheckForUpdates() {
	if a == nil {
		return
	}
	a.ShowAbout()
	go func() {
		if _, err := a.CheckForUpdates(); err != nil && a.logger != nil {
			a.logger.Warn(fmt.Sprintf("Application update check failed: %v", err), logsources.App)
		}
	}()
}

// DownloadApplicationUpdate downloads, verifies, and prepares the exact
// release version the user approved.
func (a *App) DownloadApplicationUpdate(version string) (*UpdateInfo, error) {
	if a == nil || a.applicationUpdates == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}),
			fmt.Errorf("automatic updates are disabled")
	}
	snapshot, err := a.applicationUpdates.Download(a.CtxOrBackground(), version)
	return updateInfoFromSnapshot(snapshot), err
}

// RestartAndApplyApplicationUpdate starts the prepared updater helper only
// after explicit user consent.
func (a *App) RestartAndApplyApplicationUpdate() (*UpdateInfo, error) {
	if a == nil || a.applicationUpdates == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}),
			fmt.Errorf("automatic updates are disabled")
	}
	snapshot, err := a.applicationUpdates.Restart(a.CtxOrBackground())
	return updateInfoFromSnapshot(snapshot), err
}
