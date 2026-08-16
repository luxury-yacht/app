// Package appupdates owns application update orchestration above Wails' updater
// state machine.
package appupdates

import (
	"context"
	"crypto/ed25519"
	"crypto/sha512"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatestate"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"golang.org/x/mod/semver"
)

type Status string

const (
	StatusDisabled     Status = "disabled"
	StatusIdle         Status = "idle"
	StatusChecking     Status = "checking"
	StatusCurrent      Status = "current"
	StatusSkipped      Status = "skipped"
	StatusAvailable    Status = "available"
	StatusDownloading  Status = "downloading"
	StatusVerifying    Status = "verifying"
	StatusPreparing    Status = "preparing"
	StatusPrepareError Status = "prepare-error"
	StatusReady        Status = "ready"
	StatusRestartError Status = "restart-error"
	StatusApplyError   Status = "apply-error"
	StatusCheckError   Status = "check-error"
)

type Client interface {
	Init(updater.Config) error
	Check(context.Context) (*updater.Release, error)
	DownloadAndInstall(context.Context) error
	Restart(context.Context) error
	State() updater.State
	DownloadedPath() string
	SkipVersion(string)
}

type UpdateState interface {
	ResolveStagingDirectory(string) (string, error)
	RecordPrepared(updatestate.PreparedUpdate) error
	BeginAttempt(updatestate.AttemptMetadata) (updatestate.UpdateAttempt, error)
	RestorePrepared() error
	CleanupPrepared() error
	DiscardStaging(string) error
	SetSkippedVersion(string) error
}

type Dependencies struct {
	Client         Client
	Provider       updater.Provider
	Eligibility    updateidentity.BuildEligibility
	PublicKey      []byte
	Platform       string
	Architecture   string
	TempRoot       string
	UpdateState    UpdateState
	Reconciled     *updatestate.ReconcileResult
	SkippedVersion string
	Scheduler      Scheduler
	OnChange       func(Snapshot)
}

type Snapshot struct {
	Status            Status                           `json:"status"`
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

type Coordinator struct {
	mu                          sync.Mutex
	client                      Client
	eligibility                 updateidentity.BuildEligibility
	platform                    string
	architecture                string
	updateState                 UpdateState
	runtimeReady                bool
	started                     bool
	stopped                     bool
	inFlight                    bool
	resetting                   bool
	activeOperation             string
	activeCancel                context.CancelFunc
	activeDone                  chan struct{}
	checkIncludesSkippedVersion bool
	restartRequested            bool
	preparedOwned               bool
	skippedVersion              string
	pending                     *updater.Release
	snapshot                    Snapshot
	scheduler                   Scheduler
	onChange                    func(Snapshot)
	lifecycleDone               chan struct{}
	stopOnce                    sync.Once
}

func New(dependencies Dependencies) *Coordinator {
	eligibility := dependencies.Eligibility
	if eligibility.CanInstall && dependencies.UpdateState == nil {
		eligibility.CanInstall = false
		eligibility.Installation.CanInstall = false
	}
	skippedVersion := availableSkippedVersion(
		dependencies.SkippedVersion,
		eligibility.Release.Version,
	)
	coordinator := &Coordinator{
		client:         dependencies.Client,
		eligibility:    eligibility,
		platform:       dependencies.Platform,
		architecture:   dependencies.Architecture,
		updateState:    dependencies.UpdateState,
		skippedVersion: skippedVersion,
		scheduler:      dependencies.Scheduler,
		onChange:       dependencies.OnChange,
		lifecycleDone:  make(chan struct{}),
	}
	coordinator.snapshot = coordinator.baseSnapshot(StatusDisabled)
	coordinator.applyReconciliation(dependencies.Reconciled)
	if coordinator.scheduler == nil {
		coordinator.scheduler = newIntervalScheduler()
	}
	if !dependencies.Eligibility.CanInitialize ||
		dependencies.Client == nil || dependencies.Provider == nil ||
		len(dependencies.PublicKey) == 0 || dependencies.TempRoot == "" {
		coordinator.disableCapabilities()
		return coordinator
	}
	if err := validatePublicKey(dependencies.PublicKey); err != nil {
		coordinator.disableCapabilities()
		coordinator.snapshot.Error = err.Error()
		return coordinator
	}
	err := dependencies.Client.Init(updater.Config{
		CurrentVersion: dependencies.Eligibility.Release.Version,
		Providers:      []updater.Provider{dependencies.Provider},
		PublicKey:      append([]byte(nil), dependencies.PublicKey...),
		Platform:       dependencies.Platform,
		Arch:           dependencies.Architecture,
		Window:         updater.WindowNone,
	})
	if err != nil {
		coordinator.disableCapabilities()
		coordinator.snapshot.Error = err.Error()
		return coordinator
	}
	if coordinator.skippedVersion != "" {
		dependencies.Client.SkipVersion(coordinator.skippedVersion)
	}
	if coordinator.snapshot.Status != StatusApplyError {
		coordinator.snapshot = coordinator.baseSnapshot(StatusIdle)
	}
	return coordinator
}

func availableSkippedVersion(skippedVersion, currentVersion string) string {
	skipped := "v" + skippedVersion
	current := "v" + currentVersion
	if !semver.IsValid(skipped) || !semver.IsValid(current) || semver.Compare(skipped, current) <= 0 {
		return ""
	}
	return skippedVersion
}

func (coordinator *Coordinator) applyReconciliation(result *updatestate.ReconcileResult) {
	if result == nil || result.Outcome != updatestate.OutcomeFailed {
		return
	}
	coordinator.snapshot = coordinator.baseSnapshot(StatusApplyError)
	coordinator.snapshot.AvailableVersion = result.TargetVersion
	coordinator.snapshot.Distribution = result.Distribution
	coordinator.snapshot.RecoveryTarget = result.RecoveryTarget
	coordinator.snapshot.CanCheck = false
	coordinator.snapshot.CanInstall = false
}

func (coordinator *Coordinator) disableCapabilities() {
	coordinator.snapshot.CanCheck = false
	coordinator.snapshot.CanInstall = false
}

func validatePublicKey(raw []byte) error {
	if len(raw) == ed25519.PublicKeySize {
		return nil
	}
	if block, _ := pem.Decode(raw); block != nil {
		raw = block.Bytes
	}
	publicKey, err := x509.ParsePKIXPublicKey(raw)
	if err != nil {
		return fmt.Errorf("invalid updater Ed25519 public key: %w", err)
	}
	if _, ok := publicKey.(ed25519.PublicKey); !ok {
		return fmt.Errorf("invalid updater public key type %T: require Ed25519", publicKey)
	}
	return nil
}

// Snapshot returns a detached copy of the current application update state.
func (coordinator *Coordinator) Snapshot() Snapshot {
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	return cloneSnapshot(coordinator.snapshot)
}

func (coordinator *Coordinator) RuntimeReady() {
	coordinator.mu.Lock()
	if coordinator.runtimeReady || coordinator.stopped {
		coordinator.mu.Unlock()
		return
	}
	coordinator.runtimeReady = true
	if coordinator.snapshot.Status == StatusDisabled || coordinator.snapshot.Status == StatusApplyError {
		coordinator.mu.Unlock()
		return
	}
	coordinator.started = true
	scheduler := coordinator.scheduler
	coordinator.mu.Unlock()
	scheduler.Start(6*time.Hour, func(ctx context.Context) {
		_, _ = coordinator.check(ctx, false)
	})
}

func (coordinator *Coordinator) Stop() {
	coordinator.mu.Lock()
	coordinator.stopped = true
	started := coordinator.started
	coordinator.started = false
	scheduler := coordinator.scheduler
	updateState := coordinator.updateState
	preserveAttempt := coordinator.restartRequested
	coordinator.mu.Unlock()
	coordinator.stopOnce.Do(func() {
		close(coordinator.lifecycleDone)
		if started {
			scheduler.Stop()
		}
		if updateState != nil && !preserveAttempt {
			_ = updateState.CleanupPrepared()
		}
	})
}

// HandleWailsEvent projects Wails updater lifecycle events into the semantic
// state exposed to application consumers.
func (coordinator *Coordinator) HandleWailsEvent(name string, payload any) Snapshot {
	coordinator.mu.Lock()
	previous := cloneSnapshot(coordinator.snapshot)

	switch name {
	case updater.EventCheckStarted:
		coordinator.snapshot = coordinator.baseSnapshot(StatusChecking)
	case updater.EventNoUpdate:
		coordinator.pending = nil
		coordinator.preparedOwned = false
		if coordinator.skippedVersion != "" && !coordinator.checkIncludesSkippedVersion {
			coordinator.snapshot = coordinator.baseSnapshot(StatusSkipped)
		} else {
			coordinator.snapshot = coordinator.baseSnapshot(StatusCurrent)
		}
	case updater.EventUpdateAvailable:
		coordinator.projectAvailableRelease(payload)
	case updater.EventDownloadStarted:
		coordinator.snapshot.Status = StatusDownloading
		coordinator.snapshot.ProgressPercent = nil
		coordinator.snapshot.Error = ""
	case updater.EventDownloadProgress:
		coordinator.snapshot.Status = StatusDownloading
		coordinator.snapshot.ProgressPercent = boundedProgress(payload)
	case updater.EventVerifying:
		coordinator.snapshot.Status = StatusVerifying
		coordinator.snapshot.ProgressPercent = nil
	case updater.EventInstalling:
		coordinator.snapshot.Status = StatusPreparing
		coordinator.snapshot.ProgressPercent = nil
	case updater.EventUpdateReady:
		coordinator.projectUpdateReady()
	case updater.EventError:
		coordinator.projectUpdateError(payload)
	}

	snapshot := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, snapshot)
	return snapshot
}

func (coordinator *Coordinator) projectAvailableRelease(payload any) {
	release, ok := releasePayload(payload)
	if !ok {
		return
	}
	if err := coordinator.validateRelease(&release); err != nil {
		coordinator.snapshot = coordinator.baseSnapshot(StatusCheckError)
		coordinator.snapshot.Error = err.Error()
		return
	}
	coordinator.snapshot = coordinator.snapshotForRelease(StatusAvailable, &release)
}

func (coordinator *Coordinator) projectUpdateReady() {
	if coordinator.preparedOwned {
		coordinator.snapshot.Status = StatusReady
	} else {
		coordinator.snapshot.Status = StatusPreparing
	}
	coordinator.snapshot.ProgressPercent = nil
	coordinator.snapshot.Error = ""
}

func (coordinator *Coordinator) projectUpdateError(payload any) {
	info, ok := errorPayload(payload)
	if !ok {
		return
	}
	if info.Stage == updater.StageCheck {
		coordinator.snapshot.Status = StatusCheckError
	} else {
		coordinator.snapshot.Status = StatusPrepareError
	}
	coordinator.snapshot.ProgressPercent = nil
	coordinator.snapshot.Error = info.Message
}

func releasePayload(payload any) (updater.Release, bool) {
	switch release := payload.(type) {
	case updater.Release:
		return release, true
	case *updater.Release:
		if release != nil {
			return *release, true
		}
	}
	return updater.Release{}, false
}

func errorPayload(payload any) (updater.ErrorInfo, bool) {
	switch info := payload.(type) {
	case updater.ErrorInfo:
		return info, true
	case *updater.ErrorInfo:
		if info != nil {
			return *info, true
		}
	}
	return updater.ErrorInfo{}, false
}

func boundedProgress(payload any) *float64 {
	var progress updater.Progress
	switch value := payload.(type) {
	case updater.Progress:
		progress = value
	case *updater.Progress:
		if value == nil {
			return nil
		}
		progress = *value
	default:
		return nil
	}
	if progress.Total <= 0 || progress.Written < 0 || progress.Written > progress.Total {
		return nil
	}
	percent := float64(progress.Written) / float64(progress.Total) * 100
	return &percent
}

func cloneSnapshot(snapshot Snapshot) Snapshot {
	if snapshot.ProgressPercent != nil {
		progress := *snapshot.ProgressPercent
		snapshot.ProgressPercent = &progress
	}
	return snapshot
}

func snapshotsEqual(left, right Snapshot) bool {
	if left.Status != right.Status ||
		left.CurrentVersion != right.CurrentVersion ||
		left.AvailableVersion != right.AvailableVersion ||
		left.ReleaseName != right.ReleaseName ||
		left.PublishedAt != right.PublishedAt ||
		left.ReleaseNotes != right.ReleaseNotes ||
		left.CanCheck != right.CanCheck ||
		left.CanInstall != right.CanInstall ||
		left.Distribution != right.Distribution ||
		left.EligibilityReason != right.EligibilityReason ||
		left.RecoveryTarget != right.RecoveryTarget ||
		left.Error != right.Error {
		return false
	}
	if left.ProgressPercent == nil || right.ProgressPercent == nil {
		return left.ProgressPercent == nil && right.ProgressPercent == nil
	}
	return *left.ProgressPercent == *right.ProgressPercent
}

func (coordinator *Coordinator) publishIfChanged(previous, current Snapshot) {
	if coordinator.onChange != nil && !snapshotsEqual(previous, current) {
		coordinator.onChange(cloneSnapshot(current))
	}
}

func (coordinator *Coordinator) baseSnapshot(status Status) Snapshot {
	recovery := coordinator.eligibility.Recovery
	if recovery == "" {
		recovery = coordinator.eligibility.Installation.Recovery
	}
	snapshot := Snapshot{
		Status:            status,
		CurrentVersion:    coordinator.eligibility.Release.Version,
		CanCheck:          coordinator.eligibility.CanCheck,
		CanInstall:        coordinator.eligibility.CanInstall,
		Distribution:      coordinator.eligibility.Installation.Distribution,
		EligibilityReason: coordinator.eligibility.Installation.Reason,
		RecoveryTarget:    recovery,
	}
	if status == StatusSkipped {
		snapshot.AvailableVersion = coordinator.skippedVersion
	}
	return snapshot
}

func (coordinator *Coordinator) snapshotForRelease(status Status, release *updater.Release) Snapshot {
	snapshot := coordinator.baseSnapshot(status)
	if release == nil {
		return snapshot
	}
	snapshot.AvailableVersion = release.Version
	snapshot.ReleaseName = release.Name
	snapshot.ReleaseNotes = release.Notes
	if !release.PublishedAt.IsZero() {
		snapshot.PublishedAt = release.PublishedAt.UTC().Format(time.RFC3339)
	}
	return snapshot
}

// Check performs a user-requested check, including a release the user
// previously skipped. Automatic checks continue to honor that skipped release.
func (coordinator *Coordinator) Check(ctx context.Context) (Snapshot, error) {
	return coordinator.check(ctx, true)
}

func (coordinator *Coordinator) check(ctx context.Context, includeSkippedVersion bool) (Snapshot, error) {
	coordinator.mu.Lock()
	if coordinator.stopped {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, context.Canceled
	}
	if coordinator.snapshot.Status == StatusDisabled || coordinator.snapshot.Status == StatusApplyError {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, nil
	}
	if !coordinator.runtimeReady {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update check requires runtime readiness")
	}
	if coordinator.inFlight {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, nil
	}
	if coordinator.resetting {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update reset is in progress")
	}
	if coordinator.pending != nil && preservesPendingRelease(coordinator.snapshot.Status) {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, nil
	}
	coordinator.inFlight = true
	operationContext, operationDone := coordinator.beginOperationLocked(ctx, "check")
	coordinator.checkIncludesSkippedVersion = includeSkippedVersion
	skippedVersion := coordinator.skippedVersion
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.snapshot = coordinator.baseSnapshot(StatusChecking)
	checking := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	defer coordinator.endOperation(operationDone)
	coordinator.publishIfChanged(previous, checking)

	release, err := coordinator.checkClient(operationContext, includeSkippedVersion, skippedVersion)

	coordinator.mu.Lock()
	previous = cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	coordinator.checkIncludesSkippedVersion = false
	var result Snapshot
	if err != nil {
		coordinator.snapshot = coordinator.baseSnapshot(StatusCheckError)
		coordinator.snapshot.Error = err.Error()
		result = cloneSnapshot(coordinator.snapshot)
	} else if release == nil {
		coordinator.pending = nil
		if !includeSkippedVersion && coordinator.skippedVersion != "" {
			coordinator.snapshot = coordinator.baseSnapshot(StatusSkipped)
		} else {
			coordinator.snapshot = coordinator.baseSnapshot(StatusCurrent)
		}
		result = cloneSnapshot(coordinator.snapshot)
	} else if validationErr := coordinator.validateRelease(release); validationErr != nil {
		coordinator.pending = nil
		coordinator.snapshot = coordinator.baseSnapshot(StatusCheckError)
		coordinator.snapshot.Error = validationErr.Error()
		result = cloneSnapshot(coordinator.snapshot)
		err = validationErr
	} else {
		copy := *release
		coordinator.pending = &copy
		coordinator.snapshot = coordinator.snapshotForRelease(StatusAvailable, release)
		result = cloneSnapshot(coordinator.snapshot)
	}
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, result)
	return result, err
}

func (coordinator *Coordinator) checkClient(
	ctx context.Context,
	includeSkippedVersion bool,
	skippedVersion string,
) (*updater.Release, error) {
	if !includeSkippedVersion || skippedVersion == "" {
		return runCoordinatorOperation(coordinator, ctx, coordinator.client.Check)
	}
	coordinator.client.SkipVersion("")
	defer coordinator.client.SkipVersion(skippedVersion)
	return runCoordinatorOperation(coordinator, ctx, coordinator.client.Check)
}

func (coordinator *Coordinator) Download(ctx context.Context, version string) (Snapshot, error) {
	start, operationContext, err := coordinator.beginDownload(ctx, version)
	if !start.started {
		return start.snapshot, err
	}
	defer coordinator.endOperation(start.operationDone)
	coordinator.publishIfChanged(start.previous, start.snapshot)

	err = runCoordinatorOperationError(coordinator, operationContext, coordinator.client.DownloadAndInstall)
	if err == nil {
		err = coordinator.recordPreparedUpdate(start.pending)
	}
	return coordinator.finishDownload(err)
}

type downloadStart struct {
	pending       updater.Release
	previous      Snapshot
	snapshot      Snapshot
	started       bool
	operationDone chan struct{}
}

func (coordinator *Coordinator) beginDownload(ctx context.Context, version string) (downloadStart, context.Context, error) {
	coordinator.mu.Lock()
	defer coordinator.mu.Unlock()
	if coordinator.stopped {
		return downloadStart{snapshot: cloneSnapshot(coordinator.snapshot)}, nil, context.Canceled
	}
	if coordinator.snapshot.Status == StatusDisabled {
		return downloadStart{snapshot: coordinator.snapshot}, nil, fmt.Errorf("automatic updates are disabled")
	}
	if !coordinator.runtimeReady {
		return downloadStart{snapshot: coordinator.snapshot}, nil, fmt.Errorf("application update download requires runtime readiness")
	}
	if coordinator.inFlight {
		return downloadStart{snapshot: coordinator.snapshot}, nil, nil
	}
	if coordinator.resetting {
		return downloadStart{snapshot: coordinator.snapshot}, nil, fmt.Errorf("application update reset is in progress")
	}
	if !coordinator.eligibility.CanInstall {
		return downloadStart{snapshot: coordinator.snapshot}, nil, fmt.Errorf("this installation is not eligible for automatic installation")
	}
	if coordinator.pending == nil ||
		(coordinator.snapshot.Status != StatusAvailable && coordinator.snapshot.Status != StatusPrepareError) {
		return downloadStart{snapshot: coordinator.snapshot}, nil, fmt.Errorf("application update download requires a pending release")
	}
	if version != coordinator.pending.Version {
		return downloadStart{snapshot: coordinator.snapshot}, nil, fmt.Errorf(
			"requested version %q does not match pending release %q",
			version,
			coordinator.pending.Version,
		)
	}

	coordinator.inFlight = true
	operationContext, operationDone := coordinator.beginOperationLocked(ctx, "download")
	coordinator.preparedOwned = false
	pending := *coordinator.pending
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.snapshot.Status = StatusDownloading
	coordinator.snapshot.ProgressPercent = nil
	coordinator.snapshot.Error = ""
	downloading := cloneSnapshot(coordinator.snapshot)
	return downloadStart{
		pending: pending, previous: previous, snapshot: downloading, started: true,
		operationDone: operationDone,
	}, operationContext, nil
}

func (coordinator *Coordinator) recordPreparedUpdate(pending updater.Release) error {
	if coordinator.client.State() != updater.StateReady {
		return fmt.Errorf("updater completed download without reaching ready state")
	}
	stagingDir, err := coordinator.updateState.ResolveStagingDirectory(coordinator.client.DownloadedPath())
	if err != nil {
		return err
	}
	prepared := updatestate.PreparedUpdate{
		TargetVersion:  pending.Version,
		StagingDir:     stagingDir,
		RecoveryTarget: updateidentity.RecoveryForDistribution(coordinator.eligibility.Installation.Distribution),
	}
	if err := coordinator.updateState.RecordPrepared(prepared); err != nil {
		return errors.Join(err, coordinator.updateState.DiscardStaging(stagingDir))
	}
	coordinator.mu.Lock()
	stopped := coordinator.stopped
	coordinator.mu.Unlock()
	if stopped {
		return errors.Join(context.Canceled, coordinator.updateState.CleanupPrepared())
	}
	return nil
}

func (coordinator *Coordinator) finishDownload(err error) (Snapshot, error) {
	coordinator.mu.Lock()
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	var result Snapshot
	if err != nil {
		coordinator.snapshot.Status = StatusPrepareError
		coordinator.snapshot.Error = err.Error()
		result = cloneSnapshot(coordinator.snapshot)
	} else {
		coordinator.preparedOwned = true
		coordinator.snapshot.Status = StatusReady
		coordinator.snapshot.Error = ""
		result = cloneSnapshot(coordinator.snapshot)
	}
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, result)
	return result, err
}

func preservesPendingRelease(status Status) bool {
	switch status {
	case StatusAvailable, StatusPrepareError, StatusReady, StatusRestartError:
		return true
	default:
		return false
	}
}

func (coordinator *Coordinator) rejectSkipMutationLocked(unavailableMessage, runtimeNotReadyMessage string) (Snapshot, error, bool) {
	if coordinator.stopped {
		return cloneSnapshot(coordinator.snapshot), context.Canceled, true
	}
	if coordinator.snapshot.Status == StatusDisabled || coordinator.snapshot.Status == StatusApplyError {
		return cloneSnapshot(coordinator.snapshot), errors.New(unavailableMessage), true
	}
	if !coordinator.runtimeReady {
		return cloneSnapshot(coordinator.snapshot), errors.New(runtimeNotReadyMessage), true
	}
	if coordinator.inFlight {
		return cloneSnapshot(coordinator.snapshot), nil, true
	}
	if coordinator.resetting {
		return cloneSnapshot(coordinator.snapshot), errors.New("application update reset is in progress"), true
	}
	return Snapshot{}, nil, false
}

func (coordinator *Coordinator) Skip(_ context.Context, version string) (Snapshot, error) {
	coordinator.mu.Lock()
	if snapshot, err, rejected := coordinator.rejectSkipMutationLocked(
		"automatic update skipping is unavailable",
		"application update skip requires runtime readiness",
	); rejected {
		coordinator.mu.Unlock()
		return snapshot, err
	}
	if coordinator.updateState == nil || coordinator.pending == nil || coordinator.snapshot.Status != StatusAvailable {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update skip requires a pending release")
	}
	if version != coordinator.pending.Version {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf(
			"requested version %q does not match pending release %q",
			version,
			coordinator.pending.Version,
		)
	}
	coordinator.inFlight = true
	coordinator.mu.Unlock()

	if err := coordinator.updateState.SetSkippedVersion(version); err != nil {
		coordinator.mu.Lock()
		previous := cloneSnapshot(coordinator.snapshot)
		coordinator.inFlight = false
		coordinator.snapshot.Error = err.Error()
		result := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		coordinator.publishIfChanged(previous, result)
		return result, err
	}
	coordinator.client.SkipVersion(version)

	coordinator.mu.Lock()
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	coordinator.skippedVersion = version
	coordinator.preparedOwned = false
	coordinator.snapshot = coordinator.snapshotForRelease(StatusSkipped, coordinator.pending)
	result := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, result)
	return result, nil
}

func (coordinator *Coordinator) RemoveSkip(ctx context.Context) (Snapshot, error) {
	coordinator.mu.Lock()
	if snapshot, err, rejected := coordinator.rejectSkipMutationLocked(
		"application update skip removal is unavailable",
		"application update skip removal requires runtime readiness",
	); rejected {
		coordinator.mu.Unlock()
		return snapshot, err
	}
	if coordinator.updateState == nil || coordinator.skippedVersion == "" {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update skip removal requires a skipped version")
	}
	coordinator.inFlight = true
	hasPendingRelease := coordinator.pending != nil
	coordinator.mu.Unlock()

	if err := coordinator.updateState.SetSkippedVersion(""); err != nil {
		coordinator.mu.Lock()
		previous := cloneSnapshot(coordinator.snapshot)
		coordinator.inFlight = false
		coordinator.snapshot.Error = err.Error()
		result := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		coordinator.publishIfChanged(previous, result)
		return result, err
	}
	coordinator.client.SkipVersion("")

	coordinator.mu.Lock()
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	coordinator.skippedVersion = ""
	if hasPendingRelease {
		coordinator.snapshot = coordinator.snapshotForRelease(StatusAvailable, coordinator.pending)
	} else {
		coordinator.snapshot = coordinator.baseSnapshot(StatusIdle)
	}
	result := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, result)
	if hasPendingRelease {
		return result, nil
	}
	return coordinator.Check(ctx)
}

func (coordinator *Coordinator) Restart(ctx context.Context) (Snapshot, error) {
	coordinator.mu.Lock()
	if coordinator.stopped {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, context.Canceled
	}
	if coordinator.inFlight || coordinator.restartRequested {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, nil
	}
	if coordinator.resetting {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update reset is in progress")
	}
	if (coordinator.snapshot.Status != StatusReady && coordinator.snapshot.Status != StatusRestartError) ||
		coordinator.client.State() != updater.StateReady {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update restart requires a ready update")
	}
	coordinator.inFlight = true
	operationContext, operationDone := coordinator.beginOperationLocked(ctx, "restart")
	coordinator.mu.Unlock()
	defer coordinator.endOperation(operationDone)

	_, err := coordinator.updateState.BeginAttempt(updatestate.AttemptMetadata{
		SourceVersion: coordinator.eligibility.Release.Version,
		Platform:      coordinator.platform,
		Architecture:  coordinator.architecture,
		Distribution:  coordinator.eligibility.Installation.Distribution,
	})
	if err != nil {
		return coordinator.finishRestartError(err)
	}

	coordinator.mu.Lock()
	if coordinator.stopped {
		coordinator.mu.Unlock()
		err = errors.Join(context.Canceled, coordinator.updateState.RestorePrepared())
		err = errors.Join(err, coordinator.updateState.CleanupPrepared())
		return coordinator.finishRestartError(err)
	}
	coordinator.restartRequested = true
	coordinator.mu.Unlock()

	err = runCoordinatorOperationError(coordinator, operationContext, coordinator.client.Restart)
	if err != nil {
		err = errors.Join(err, coordinator.updateState.RestorePrepared())
	}

	coordinator.mu.Lock()
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	if err != nil {
		coordinator.restartRequested = false
		coordinator.snapshot.Status = StatusRestartError
		coordinator.snapshot.Error = err.Error()
	} else {
		coordinator.snapshot.Status = StatusReady
		coordinator.snapshot.Error = ""
	}
	result := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, result)
	return result, err
}

func (coordinator *Coordinator) finishRestartError(err error) (Snapshot, error) {
	coordinator.mu.Lock()
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	coordinator.restartRequested = false
	coordinator.snapshot.Status = StatusRestartError
	coordinator.snapshot.Error = err.Error()
	result := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, result)
	return result, err
}

func runCoordinatorOperation[T any](
	coordinator *Coordinator,
	parent context.Context,
	operation func(context.Context) (T, error),
) (T, error) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	go func() {
		select {
		case <-coordinator.lifecycleDone:
			cancel()
		case <-ctx.Done():
		}
	}()
	return operation(ctx)
}

func runCoordinatorOperationError(
	coordinator *Coordinator,
	parent context.Context,
	operation func(context.Context) error,
) error {
	_, err := runCoordinatorOperation(coordinator, parent, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, operation(ctx)
	})
	return err
}

type resettableUpdateState interface {
	Reset() error
}

func (coordinator *Coordinator) beginOperationLocked(parent context.Context, kind string) (context.Context, chan struct{}) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	coordinator.activeOperation = kind
	coordinator.activeCancel = cancel
	coordinator.activeDone = done
	go func() {
		select {
		case <-coordinator.lifecycleDone:
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, done
}

func (coordinator *Coordinator) endOperation(done chan struct{}) {
	coordinator.mu.Lock()
	if coordinator.activeDone == done {
		coordinator.activeOperation = ""
		coordinator.activeCancel = nil
		coordinator.activeDone = nil
		close(done)
	}
	coordinator.mu.Unlock()
}

// Reset quiesces cancellable updater work before clearing durable and
// projected update state. Restart/apply handoff is recovery-critical and must
// complete outside reset.
func (coordinator *Coordinator) Reset(ctx context.Context) error {
	coordinator.mu.Lock()
	if coordinator.resetting {
		coordinator.mu.Unlock()
		return fmt.Errorf("application update reset is already in progress")
	}
	if coordinator.restartRequested || coordinator.activeOperation == "restart" {
		coordinator.mu.Unlock()
		return fmt.Errorf("refuse application update reset during an application/restart attempt")
	}
	if coordinator.inFlight && coordinator.activeOperation == "" {
		coordinator.mu.Unlock()
		return fmt.Errorf("refuse application update reset during a durable state mutation")
	}
	coordinator.resetting = true
	cancel := coordinator.activeCancel
	done := coordinator.activeDone
	coordinator.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done != nil {
		if ctx == nil {
			ctx = context.Background()
		}
		select {
		case <-done:
		case <-ctx.Done():
			coordinator.mu.Lock()
			coordinator.resetting = false
			coordinator.mu.Unlock()
			return fmt.Errorf("quiesce application update operation: %w", ctx.Err())
		}
	}

	var err error
	if state, ok := coordinator.updateState.(resettableUpdateState); ok {
		err = state.Reset()
	}
	coordinator.mu.Lock()
	previous := cloneSnapshot(coordinator.snapshot)
	if err == nil {
		if coordinator.client != nil {
			coordinator.client.SkipVersion("")
		}
		coordinator.pending = nil
		coordinator.preparedOwned = false
		coordinator.skippedVersion = ""
		coordinator.checkIncludesSkippedVersion = false
		status := StatusIdle
		if previous.Status == StatusDisabled {
			status = StatusDisabled
		}
		coordinator.snapshot = coordinator.baseSnapshot(status)
	}
	coordinator.resetting = false
	current := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, current)
	return err
}

func (coordinator *Coordinator) validateRelease(release *updater.Release) error {
	if release.Version == "" {
		return fmt.Errorf("update release version is required")
	}
	releaseIdentity, err := updateidentity.ParseReleaseVersion(release.Version)
	if err != nil {
		return fmt.Errorf("invalid update release version: %w", err)
	}
	if coordinator.eligibility.Release.Channel == updateidentity.ChannelStable &&
		releaseIdentity.Channel != updateidentity.ChannelStable {
		return fmt.Errorf("stable builds cannot install prerelease version %q", release.Version)
	}
	if release.Channel != string(releaseIdentity.Channel) {
		return fmt.Errorf(
			"update release channel %q does not match version channel %q",
			release.Channel,
			releaseIdentity.Channel,
		)
	}
	if release.Artifact.Platform != coordinator.platform || release.Artifact.Arch != coordinator.architecture {
		return fmt.Errorf(
			"update artifact target %s/%s does not match runtime %s/%s",
			release.Artifact.Platform,
			release.Artifact.Arch,
			coordinator.platform,
			coordinator.architecture,
		)
	}
	verification := release.Verification
	if verification == nil || verification.DigestAlgo != "sha512" ||
		len(verification.Digest) != sha512.Size ||
		verification.SignatureAlgo != "ed25519ph" ||
		len(verification.Signature) != ed25519.SignatureSize {
		return fmt.Errorf("update release requires authenticated sha512/ed25519ph verification")
	}
	return nil
}
