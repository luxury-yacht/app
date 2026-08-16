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

type applicationUpdateEventSubscriber interface {
	Subscribe(string, func(*application.CustomEvent)) func()
}

type wailsApplicationUpdateEventSubscriber struct {
	events *application.EventManager
}

func (subscriber wailsApplicationUpdateEventSubscriber) Subscribe(
	name string,
	callback func(*application.CustomEvent),
) func() {
	return subscriber.events.On(name, callback)
}

type applicationUpdateEventProjector interface {
	HandleWailsEvent(string, any) appupdates.Snapshot
}

func subscribeApplicationUpdateEvents(
	subscriber applicationUpdateEventSubscriber,
	projector applicationUpdateEventProjector,
) []func() {
	if subscriber == nil || projector == nil {
		return nil
	}
	unsubscribers := make([]func(), 0, len(applicationUpdateEventNames))
	for _, eventName := range applicationUpdateEventNames {
		name := eventName
		unsubscribe := subscriber.Subscribe(name, func(event *application.CustomEvent) {
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

func (u *UpdateCoordinator) storeApplicationUpdateSnapshot(snapshot appupdates.Snapshot) {
	if u == nil {
		return
	}
	info := updateInfoFromSnapshot(snapshot)
	u.emit(appUpdateEventName, info)
}

func (u *UpdateCoordinator) getUpdateInfo() *UpdateInfo {
	if u == nil || u.coordinator == nil {
		return nil
	}
	return updateInfoFromSnapshot(u.coordinator.Snapshot())
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
func (u *UpdateCoordinator) CheckForUpdates() (*UpdateInfo, error) {
	if u == nil || u.coordinator == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}), nil
	}
	snapshot, err := u.coordinator.Check(u.operationContext())
	return updateInfoFromSnapshot(snapshot), err
}

// showAboutAndCheckForUpdates gives native menu users immediate feedback while
// keeping the provider request off the platform menu callback.
func (u *UpdateCoordinator) showAboutAndCheckForUpdates() {
	if u == nil {
		return
	}
	u.shell.ShowAbout()
	go func() {
		if _, err := u.CheckForUpdates(); err != nil && u.logger != nil {
			u.logger.Warn(fmt.Sprintf("Application update check failed: %v", err), logsources.App)
		}
	}()
}

// DownloadApplicationUpdate downloads, verifies, and prepares the exact
// release version the user approved.
func (u *UpdateCoordinator) DownloadApplicationUpdate(version string) (*UpdateInfo, error) {
	if u == nil || u.coordinator == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}),
			fmt.Errorf("automatic updates are disabled")
	}
	snapshot, err := u.coordinator.Download(u.operationContext(), version)
	return updateInfoFromSnapshot(snapshot), err
}

// RestartAndApplyApplicationUpdate starts the prepared updater helper only
// after explicit user consent.
func (u *UpdateCoordinator) RestartAndApplyApplicationUpdate() (*UpdateInfo, error) {
	if u == nil || u.coordinator == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}),
			fmt.Errorf("automatic updates are disabled")
	}
	snapshot, err := u.coordinator.Restart(u.operationContext())
	return updateInfoFromSnapshot(snapshot), err
}

// SkipApplicationUpdate durably suppresses the exact offered version before
// hiding it from the current process.
func (u *UpdateCoordinator) SkipApplicationUpdate(version string) (*UpdateInfo, error) {
	if u == nil || u.coordinator == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}),
			fmt.Errorf("automatic updates are disabled")
	}
	snapshot, err := u.coordinator.Skip(u.operationContext(), version)
	return updateInfoFromSnapshot(snapshot), err
}

// RemoveApplicationUpdateSkip clears the durable version skip and offers the
// release again when it remains available.
func (u *UpdateCoordinator) RemoveApplicationUpdateSkip() (*UpdateInfo, error) {
	if u == nil || u.coordinator == nil {
		return updateInfoFromSnapshot(appupdates.Snapshot{Status: appupdates.StatusDisabled}),
			fmt.Errorf("automatic updates are disabled")
	}
	snapshot, err := u.coordinator.RemoveSkip(u.operationContext())
	return updateInfoFromSnapshot(snapshot), err
}
