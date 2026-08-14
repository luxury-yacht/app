// Package appupdates owns application update orchestration above Wails' updater
// state machine.
package appupdates

import (
	"context"
	"crypto/ed25519"
	"crypto/sha512"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

type Status string

const (
	StatusDisabled     Status = "disabled"
	StatusIdle         Status = "idle"
	StatusChecking     Status = "checking"
	StatusCurrent      Status = "current"
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
}

type Dependencies struct {
	Client       Client
	Provider     updater.Provider
	Eligibility  updateidentity.BuildEligibility
	PublicKey    []byte
	Platform     string
	Architecture string
	TempRoot     string
	Scheduler    Scheduler
	OnChange     func(Snapshot)
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
	mu               sync.Mutex
	client           Client
	eligibility      updateidentity.BuildEligibility
	platform         string
	architecture     string
	runtimeReady     bool
	started          bool
	inFlight         bool
	restartRequested bool
	pending          *updater.Release
	snapshot         Snapshot
	scheduler        Scheduler
	onChange         func(Snapshot)
	lifecycleDone    chan struct{}
	stopOnce         sync.Once
}

func New(dependencies Dependencies) *Coordinator {
	coordinator := &Coordinator{
		client:        dependencies.Client,
		eligibility:   dependencies.Eligibility,
		platform:      dependencies.Platform,
		architecture:  dependencies.Architecture,
		scheduler:     dependencies.Scheduler,
		onChange:      dependencies.OnChange,
		lifecycleDone: make(chan struct{}),
	}
	coordinator.snapshot = coordinator.baseSnapshot(StatusDisabled)
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
	coordinator.snapshot = coordinator.baseSnapshot(StatusIdle)
	return coordinator
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
	if coordinator.runtimeReady {
		coordinator.mu.Unlock()
		return
	}
	coordinator.runtimeReady = true
	if coordinator.snapshot.Status == StatusDisabled {
		coordinator.mu.Unlock()
		return
	}
	coordinator.started = true
	scheduler := coordinator.scheduler
	coordinator.mu.Unlock()
	scheduler.Start(6*time.Hour, func(ctx context.Context) {
		_, _ = coordinator.Check(ctx)
	})
}

func (coordinator *Coordinator) Stop() {
	coordinator.mu.Lock()
	started := coordinator.started
	coordinator.started = false
	scheduler := coordinator.scheduler
	coordinator.mu.Unlock()
	coordinator.stopOnce.Do(func() { close(coordinator.lifecycleDone) })
	if started {
		scheduler.Stop()
	}
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
		coordinator.snapshot = coordinator.baseSnapshot(StatusCurrent)
	case updater.EventUpdateAvailable:
		if release, ok := releasePayload(payload); ok {
			if err := coordinator.validateRelease(&release); err != nil {
				coordinator.snapshot = coordinator.baseSnapshot(StatusCheckError)
				coordinator.snapshot.Error = err.Error()
			} else {
				coordinator.snapshot = coordinator.snapshotForRelease(StatusAvailable, &release)
			}
		}
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
		coordinator.snapshot.Status = StatusReady
		coordinator.snapshot.ProgressPercent = nil
		coordinator.snapshot.Error = ""
	case updater.EventError:
		if info, ok := errorPayload(payload); ok {
			if info.Stage == updater.StageCheck {
				coordinator.snapshot.Status = StatusCheckError
			} else {
				coordinator.snapshot.Status = StatusPrepareError
			}
			coordinator.snapshot.ProgressPercent = nil
			coordinator.snapshot.Error = info.Message
		}
	}

	snapshot := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, snapshot)
	return snapshot
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
	return Snapshot{
		Status:            status,
		CurrentVersion:    coordinator.eligibility.Release.Version,
		CanCheck:          coordinator.eligibility.CanCheck,
		CanInstall:        coordinator.eligibility.CanInstall,
		Distribution:      coordinator.eligibility.Installation.Distribution,
		EligibilityReason: coordinator.eligibility.Installation.Reason,
		RecoveryTarget:    recovery,
	}
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

func (coordinator *Coordinator) Check(ctx context.Context) (Snapshot, error) {
	coordinator.mu.Lock()
	if coordinator.snapshot.Status == StatusDisabled {
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
	if coordinator.pending != nil && preservesPendingRelease(coordinator.snapshot.Status) {
		snapshot := cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		return snapshot, nil
	}
	coordinator.inFlight = true
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.snapshot = coordinator.baseSnapshot(StatusChecking)
	checking := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, checking)

	operationCtx, operationDone := coordinator.operationContext(ctx)
	release, err := coordinator.client.Check(operationCtx)
	operationDone()

	coordinator.mu.Lock()
	previous = cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	var result Snapshot
	if err != nil {
		coordinator.snapshot = coordinator.baseSnapshot(StatusCheckError)
		coordinator.snapshot.Error = err.Error()
		result = cloneSnapshot(coordinator.snapshot)
	} else if release == nil {
		coordinator.pending = nil
		coordinator.snapshot = coordinator.baseSnapshot(StatusCurrent)
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

func (coordinator *Coordinator) Download(ctx context.Context, version string) (Snapshot, error) {
	coordinator.mu.Lock()
	if coordinator.snapshot.Status == StatusDisabled {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("automatic updates are disabled")
	}
	if !coordinator.runtimeReady {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update download requires runtime readiness")
	}
	if coordinator.inFlight {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, nil
	}
	if !coordinator.eligibility.CanInstall {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("this installation is not eligible for automatic installation")
	}
	if coordinator.pending == nil ||
		(coordinator.snapshot.Status != StatusAvailable && coordinator.snapshot.Status != StatusPrepareError) {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update download requires a pending release")
	}
	if version != coordinator.pending.Version {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf(
			"requested version %q does not match pending release %q",
			version,
			coordinator.pending.Version,
		)
	}

	coordinator.inFlight = true
	previous := cloneSnapshot(coordinator.snapshot)
	coordinator.snapshot.Status = StatusDownloading
	coordinator.snapshot.ProgressPercent = nil
	coordinator.snapshot.Error = ""
	downloading := cloneSnapshot(coordinator.snapshot)
	coordinator.mu.Unlock()
	coordinator.publishIfChanged(previous, downloading)

	operationCtx, operationDone := coordinator.operationContext(ctx)
	err := coordinator.client.DownloadAndInstall(operationCtx)
	operationDone()

	coordinator.mu.Lock()
	previous = cloneSnapshot(coordinator.snapshot)
	coordinator.inFlight = false
	var result Snapshot
	if err != nil {
		coordinator.snapshot.Status = StatusPrepareError
		coordinator.snapshot.Error = err.Error()
		result = cloneSnapshot(coordinator.snapshot)
	} else if coordinator.client.State() != updater.StateReady {
		err := fmt.Errorf("updater completed download without reaching ready state")
		coordinator.snapshot.Status = StatusPrepareError
		coordinator.snapshot.Error = err.Error()
		result = cloneSnapshot(coordinator.snapshot)
		coordinator.mu.Unlock()
		coordinator.publishIfChanged(previous, result)
		return result, err
	} else {
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

func (coordinator *Coordinator) Restart(ctx context.Context) (Snapshot, error) {
	coordinator.mu.Lock()
	if coordinator.inFlight || coordinator.restartRequested {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, nil
	}
	if (coordinator.snapshot.Status != StatusReady && coordinator.snapshot.Status != StatusRestartError) ||
		coordinator.client.State() != updater.StateReady {
		snapshot := coordinator.snapshot
		coordinator.mu.Unlock()
		return snapshot, fmt.Errorf("application update restart requires a ready update")
	}
	coordinator.inFlight = true
	coordinator.restartRequested = true
	coordinator.mu.Unlock()

	operationCtx, operationDone := coordinator.operationContext(ctx)
	err := coordinator.client.Restart(operationCtx)
	operationDone()

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

func (coordinator *Coordinator) operationContext(parent context.Context) (context.Context, func()) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	operationDone := make(chan struct{})
	go func() {
		select {
		case <-coordinator.lifecycleDone:
			cancel()
		case <-operationDone:
		}
	}()
	return ctx, func() {
		close(operationDone)
		cancel()
	}
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
	if release.Channel != string(coordinator.eligibility.Release.Channel) {
		return fmt.Errorf("update release channel %q does not match build channel %q", release.Channel, coordinator.eligibility.Release.Channel)
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
