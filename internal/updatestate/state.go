// Package updatestate owns durable handoff state between the application and
// the detached Wails updater helper.
package updatestate

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatetemp"
)

const (
	SchemaVersion            = 1
	MaxHelperDiagnosticBytes = 64 * 1024
	maxStateBytes            = 64 * 1024
	maxCleanupEntries        = 8
)

type Outcome string

const (
	OutcomeNone       Outcome = ""
	OutcomeSucceeded  Outcome = "succeeded"
	OutcomeFailed     Outcome = "failed"
	OutcomeSuperseded Outcome = "superseded"
)

type PreparedUpdate struct {
	TargetVersion  string                        `json:"targetVersion"`
	StagingDir     string                        `json:"stagingDir"`
	RecoveryTarget updateidentity.RecoveryTarget `json:"recoveryTarget"`
}

type UpdateAttempt struct {
	SourceVersion  string                        `json:"sourceVersion"`
	TargetVersion  string                        `json:"targetVersion"`
	StartedAt      time.Time                     `json:"startedAt"`
	Platform       string                        `json:"platform"`
	Architecture   string                        `json:"architecture"`
	Distribution   updateidentity.Distribution   `json:"distribution"`
	ProcessID      int                           `json:"processId"`
	StagingDir     string                        `json:"stagingDir"`
	RecoveryTarget updateidentity.RecoveryTarget `json:"recoveryTarget"`
}

type AttemptMetadata struct {
	SourceVersion string
	Platform      string
	Architecture  string
	Distribution  updateidentity.Distribution
}

type Document struct {
	SchemaVersion  int             `json:"schemaVersion"`
	SkippedVersion string          `json:"skippedVersion,omitempty"`
	Prepared       *PreparedUpdate `json:"prepared,omitempty"`
	Attempt        *UpdateAttempt  `json:"attempt,omitempty"`
	Cleanup        []string        `json:"cleanup,omitempty"`
}

func (document Document) ProtectedPaths() []string {
	paths := make([]string, 0, len(document.Cleanup)+2)
	if document.Prepared != nil {
		paths = append(paths, document.Prepared.StagingDir)
	}
	if document.Attempt != nil {
		paths = append(paths, document.Attempt.StagingDir)
	}
	paths = append(paths, document.Cleanup...)
	return paths
}

type ReconcileResult struct {
	Outcome          Outcome
	SourceVersion    string
	TargetVersion    string
	Distribution     updateidentity.Distribution
	RecoveryTarget   updateidentity.RecoveryTarget
	HelperDiagnostic string
}

type Config struct {
	StatePath   string
	TempRoot    string
	Now         func() time.Time
	PID         func() int
	ReplaceFile func(string, string) error
	RemoveAll   func(string) error
}

type Store struct {
	mu          sync.Mutex
	statePath   string
	tempRoot    string
	now         func() time.Time
	pid         func() int
	replaceFile func(string, string) error
	removeAll   func(string) error
}

type invalidDocumentError struct {
	cause error
}

func (err *invalidDocumentError) Error() string { return err.cause.Error() }
func (err *invalidDocumentError) Unwrap() error { return err.cause }

func invalidDocument(cause error) error {
	return &invalidDocumentError{cause: cause}
}

func New(config Config) (*Store, error) {
	statePath := filepath.Clean(strings.TrimSpace(config.StatePath))
	tempRoot := filepath.Clean(strings.TrimSpace(config.TempRoot))
	if !filepath.IsAbs(statePath) {
		return nil, fmt.Errorf("application update state path must be absolute: %q", config.StatePath)
	}
	if !filepath.IsAbs(tempRoot) {
		return nil, fmt.Errorf("application update temp root must be absolute: %q", config.TempRoot)
	}
	rootInfo, err := os.Lstat(tempRoot)
	if err != nil {
		return nil, fmt.Errorf("inspect application update temp root: %w", err)
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil, fmt.Errorf("application update temp root must be a non-symlink directory: %s", tempRoot)
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.PID == nil {
		config.PID = os.Getpid
	}
	if config.ReplaceFile == nil {
		config.ReplaceFile = replaceFile
	}
	if config.RemoveAll == nil {
		config.RemoveAll = os.RemoveAll
	}
	return &Store{
		statePath: statePath, tempRoot: tempRoot, now: config.Now, pid: config.PID,
		replaceFile: config.ReplaceFile, removeAll: config.RemoveAll,
	}, nil
}

func (store *Store) Load() (Document, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.loadLocked()
}

func (store *Store) loadLocked() (Document, error) {
	document := Document{SchemaVersion: SchemaVersion}
	info, err := os.Lstat(store.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return document, nil
		}
		return Document{}, fmt.Errorf("inspect application update state: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return Document{}, invalidDocument(fmt.Errorf("application update state must be a regular non-symlink file"))
	}
	if info.Size() > maxStateBytes {
		return Document{}, invalidDocument(fmt.Errorf("application update state exceeds %d bytes", maxStateBytes))
	}
	data, err := os.ReadFile(store.statePath)
	if err != nil {
		return Document{}, fmt.Errorf("read application update state: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return Document{}, invalidDocument(fmt.Errorf("decode application update state: %w", err))
	}
	if err := requireJSONEOF(decoder); err != nil {
		return Document{}, invalidDocument(err)
	}
	if err := store.validateDocument(document); err != nil {
		return Document{}, invalidDocument(err)
	}
	return document, nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("application update state contains multiple JSON values")
		}
		return fmt.Errorf("decode application update state suffix: %w", err)
	}
	return nil
}

func (store *Store) validateDocument(document Document) error {
	if document.SchemaVersion != SchemaVersion {
		return fmt.Errorf("unsupported application update state schema %d", document.SchemaVersion)
	}
	if document.Prepared != nil && document.Attempt != nil {
		return fmt.Errorf("application update state cannot own prepared and attempted updates simultaneously")
	}
	if document.SkippedVersion != "" {
		if err := requireCanonicalVersion(document.SkippedVersion); err != nil {
			return fmt.Errorf("skipped version: %w", err)
		}
	}
	if len(document.Cleanup) > maxCleanupEntries {
		return fmt.Errorf("application update cleanup exceeds %d entries", maxCleanupEntries)
	}
	if document.Prepared != nil {
		if err := store.validatePrepared(*document.Prepared); err != nil {
			return err
		}
	}
	if document.Attempt != nil {
		if err := store.validateAttempt(*document.Attempt); err != nil {
			return err
		}
	}
	seen := make(map[string]struct{}, len(document.Cleanup))
	for _, path := range document.Cleanup {
		if err := store.validateRecordedStaging(path); err != nil {
			return err
		}
		if _, exists := seen[path]; exists {
			return fmt.Errorf("duplicate application update cleanup path: %s", path)
		}
		seen[path] = struct{}{}
	}
	return nil
}

func (store *Store) validatePrepared(prepared PreparedUpdate) error {
	if err := requireCanonicalVersion(prepared.TargetVersion); err != nil {
		return fmt.Errorf("prepared target version: %w", err)
	}
	if err := store.validateRecordedStaging(prepared.StagingDir); err != nil {
		return err
	}
	if !validRecoveryTarget(prepared.RecoveryTarget) {
		return fmt.Errorf("invalid prepared recovery target %q", prepared.RecoveryTarget)
	}
	return nil
}

func (store *Store) validateAttempt(attempt UpdateAttempt) error {
	if err := requireCanonicalVersion(attempt.SourceVersion); err != nil {
		return fmt.Errorf("attempt source version: %w", err)
	}
	if err := requireCanonicalVersion(attempt.TargetVersion); err != nil {
		return fmt.Errorf("attempt target version: %w", err)
	}
	if attempt.StartedAt.IsZero() {
		return fmt.Errorf("attempt start time is required")
	}
	if !validTarget(attempt.Platform, attempt.Architecture, attempt.Distribution) {
		return fmt.Errorf("invalid attempt target %s/%s/%s", attempt.Platform, attempt.Architecture, attempt.Distribution)
	}
	if attempt.ProcessID <= 0 {
		return fmt.Errorf("attempt process ID must be positive")
	}
	if err := store.validateRecordedStaging(attempt.StagingDir); err != nil {
		return err
	}
	if !validRecoveryTarget(attempt.RecoveryTarget) {
		return fmt.Errorf("invalid attempt recovery target %q", attempt.RecoveryTarget)
	}
	if expected := updateidentity.RecoveryForDistribution(attempt.Distribution); attempt.RecoveryTarget != expected {
		return fmt.Errorf(
			"attempt recovery target %q does not match distribution %q recovery target %q",
			attempt.RecoveryTarget,
			attempt.Distribution,
			expected,
		)
	}
	return nil
}

func requireCanonicalVersion(version string) error {
	parsed, err := updateidentity.ParseReleaseVersion(version)
	if err != nil {
		return err
	}
	if parsed.Version != version {
		return fmt.Errorf("version %q is not canonical; use %q", version, parsed.Version)
	}
	return nil
}

func validTarget(platform, architecture string, distribution updateidentity.Distribution) bool {
	if architecture != "amd64" && architecture != "arm64" {
		return false
	}
	switch platform {
	case "darwin":
		return distribution == updateidentity.DistributionMacBundle
	case "windows":
		return distribution == updateidentity.DistributionWindowsNSIS
	case "linux":
		return distribution == updateidentity.DistributionLinuxPortable
	default:
		return false
	}
}

func validRecoveryTarget(target updateidentity.RecoveryTarget) bool {
	switch target {
	case updateidentity.RecoveryMacDownload,
		updateidentity.RecoveryWindowsDownload,
		updateidentity.RecoveryLinuxPortableDownload:
		return true
	default:
		return false
	}
}

func (store *Store) ResolveStagingDirectory(downloadedPath string) (string, error) {
	path := filepath.Clean(strings.TrimSpace(downloadedPath))
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("downloaded update path must be absolute: %q", downloadedPath)
	}
	relative, err := filepath.Rel(store.tempRoot, path)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("downloaded update path is outside the owned temp root: %s", path)
	}
	parts := strings.Split(relative, string(filepath.Separator))
	if len(parts) < 2 {
		return "", fmt.Errorf("downloaded update path must be inside an updater staging directory: %s", path)
	}
	staging := filepath.Join(store.tempRoot, parts[0])
	if err := store.validateRecordedStaging(staging); err != nil {
		return "", err
	}
	info, err := os.Lstat(staging)
	if err != nil {
		return "", fmt.Errorf("inspect updater staging directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("updater staging directory must not be a symlink: %s", staging)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("updater staging path must be a directory: %s", staging)
	}
	return staging, nil
}

func (store *Store) validateRecordedStaging(path string) error {
	path = filepath.Clean(strings.TrimSpace(path))
	if !filepath.IsAbs(path) || filepath.Dir(path) != store.tempRoot ||
		!strings.HasPrefix(filepath.Base(path), "wails-update-") || filepath.Base(path) == "wails-update-" {
		return fmt.Errorf("updater staging path must be a direct child of the owned root: %s", path)
	}
	return nil
}

func (store *Store) RecordPrepared(prepared PreparedUpdate) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.validatePrepared(prepared); err != nil {
		return err
	}
	info, err := os.Lstat(prepared.StagingDir)
	if err != nil {
		return fmt.Errorf("inspect prepared staging directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("prepared staging path must be a non-symlink directory: %s", prepared.StagingDir)
	}
	document, err := store.loadLocked()
	if err != nil {
		return err
	}
	if document.Prepared != nil || document.Attempt != nil {
		return fmt.Errorf("application update state already owns an active update")
	}
	copy := prepared
	document.Prepared = &copy
	return store.saveLocked(document)
}

func (store *Store) SetSkippedVersion(version string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if version != "" {
		if err := requireCanonicalVersion(version); err != nil {
			return fmt.Errorf("skipped version: %w", err)
		}
	}
	document, err := store.loadLocked()
	if err != nil {
		return err
	}
	document.SkippedVersion = version
	return store.saveLocked(document)
}

func (store *Store) BeginAttempt(metadata AttemptMetadata) (UpdateAttempt, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := requireCanonicalVersion(metadata.SourceVersion); err != nil {
		return UpdateAttempt{}, fmt.Errorf("attempt source version: %w", err)
	}
	document, err := store.loadLocked()
	if err != nil {
		return UpdateAttempt{}, err
	}
	if document.Prepared == nil || document.Attempt != nil {
		return UpdateAttempt{}, fmt.Errorf("application update attempt requires a prepared update")
	}
	attempt := UpdateAttempt{
		SourceVersion: metadata.SourceVersion, TargetVersion: document.Prepared.TargetVersion,
		StartedAt: store.now().UTC(), Platform: metadata.Platform, Architecture: metadata.Architecture,
		Distribution: metadata.Distribution, ProcessID: store.pid(),
		StagingDir: document.Prepared.StagingDir, RecoveryTarget: document.Prepared.RecoveryTarget,
	}
	if err := store.validateAttempt(attempt); err != nil {
		return UpdateAttempt{}, err
	}
	document.Prepared = nil
	document.Attempt = &attempt
	if err := store.saveLocked(document); err != nil {
		return UpdateAttempt{}, err
	}
	return attempt, nil
}

func (store *Store) RestorePrepared() error {
	store.mu.Lock()
	defer store.mu.Unlock()
	document, err := store.loadLocked()
	if err != nil {
		return err
	}
	if document.Attempt == nil || document.Prepared != nil {
		return fmt.Errorf("application update restore requires an attempted update")
	}
	document.Prepared = &PreparedUpdate{
		TargetVersion:  document.Attempt.TargetVersion,
		StagingDir:     document.Attempt.StagingDir,
		RecoveryTarget: document.Attempt.RecoveryTarget,
	}
	document.Attempt = nil
	return store.saveLocked(document)
}

func (store *Store) CleanupPrepared() error {
	store.mu.Lock()
	defer store.mu.Unlock()
	document, err := store.loadLocked()
	if err != nil {
		return err
	}
	if document.Prepared == nil {
		return nil
	}
	document.Cleanup = appendCleanup(document.Cleanup, document.Prepared.StagingDir)
	document.Prepared = nil
	if err := store.saveLocked(document); err != nil {
		return err
	}
	return store.retryCleanupLocked(document)
}

// DiscardStaging removes one staging directory that was derived from Wails'
// downloaded payload path but could not be committed to durable ownership.
func (store *Store) DiscardStaging(path string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.removeStaging(path)
}

func appendCleanup(paths []string, path string) []string {
	for _, existing := range paths {
		if existing == path {
			return paths
		}
	}
	return append(paths, path)
}

func (store *Store) RetryCleanup() error {
	store.mu.Lock()
	defer store.mu.Unlock()
	document, err := store.loadLocked()
	if err != nil {
		return err
	}
	return store.retryCleanupLocked(document)
}

// Reset removes updater-owned durable state and dynamic artifacts. An active
// application attempt is recovery state for another process and is never
// deleted by reset.
func (store *Store) Reset() error {
	store.mu.Lock()
	defer store.mu.Unlock()

	document, err := store.loadLocked()
	if err != nil {
		return err
	}
	if document.Attempt != nil {
		return fmt.Errorf("refuse application update reset during an active application attempt")
	}

	owned := append([]string(nil), document.Cleanup...)
	if document.Prepared != nil {
		owned = appendCleanup(owned, document.Prepared.StagingDir)
	}
	remaining := make([]string, 0, len(owned))
	var failures []error
	for _, path := range owned {
		if removeErr := store.removeStaging(path); removeErr != nil {
			remaining = append(remaining, path)
			failures = append(failures, removeErr)
		}
	}
	if _, sweepErr := updatetemp.SweepOrphans(store.tempRoot, remaining); sweepErr != nil {
		failures = append(failures, sweepErr)
	}
	if len(failures) > 0 {
		document.SkippedVersion = ""
		document.Prepared = nil
		document.Cleanup = remaining
		if saveErr := store.saveLocked(document); saveErr != nil {
			failures = append(failures, saveErr)
		}
		return errors.Join(failures...)
	}

	info, statErr := os.Lstat(store.statePath)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return nil
		}
		return fmt.Errorf("inspect application update state before reset: %w", statErr)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return invalidDocument(fmt.Errorf("application update state must be a regular non-symlink file"))
	}
	if removeErr := os.Remove(store.statePath); removeErr != nil {
		return fmt.Errorf("remove application update state: %w", removeErr)
	}
	return nil
}

func (store *Store) retryCleanupLocked(document Document) error {
	remaining := make([]string, 0, len(document.Cleanup))
	var failures []error
	for _, path := range document.Cleanup {
		if err := store.removeStaging(path); err != nil {
			remaining = append(remaining, path)
			failures = append(failures, err)
		}
	}
	if len(remaining) != len(document.Cleanup) {
		document.Cleanup = remaining
		if err := store.saveLocked(document); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (store *Store) removeStaging(path string) error {
	if err := store.validateRecordedStaging(path); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("inspect updater staging path before cleanup: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("refuse cleanup of non-directory or symlink updater path: %s", path)
	}
	if err := store.removeAll(path); err != nil {
		return fmt.Errorf("remove updater staging path %s: %w", path, err)
	}
	return nil
}

func (store *Store) Reconcile(currentVersion string) (ReconcileResult, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := requireCanonicalVersion(currentVersion); err != nil {
		return ReconcileResult{}, fmt.Errorf("running version: %w", err)
	}
	document, err := store.loadLocked()
	if err != nil {
		var invalid *invalidDocumentError
		if errors.As(err, &invalid) {
			clearErr := store.saveLocked(Document{SchemaVersion: SchemaVersion})
			return ReconcileResult{}, errors.Join(
				fmt.Errorf("cleared invalid application update state: %w", err),
				clearErr,
			)
		}
		return ReconcileResult{}, err
	}
	if err := store.retryCleanupLocked(document); err != nil {
		return ReconcileResult{}, err
	}
	document, err = store.loadLocked()
	if err != nil {
		return ReconcileResult{}, err
	}
	if document.Prepared != nil {
		document.Cleanup = appendCleanup(document.Cleanup, document.Prepared.StagingDir)
		document.Prepared = nil
		if err := store.saveLocked(document); err != nil {
			return ReconcileResult{}, err
		}
		return ReconcileResult{}, store.retryCleanupLocked(document)
	}
	if document.Attempt == nil {
		return ReconcileResult{}, nil
	}

	attempt := *document.Attempt
	result := ReconcileResult{
		SourceVersion: attempt.SourceVersion, TargetVersion: attempt.TargetVersion,
		Distribution: attempt.Distribution, RecoveryTarget: attempt.RecoveryTarget,
	}
	switch currentVersion {
	case attempt.TargetVersion:
		result.Outcome = OutcomeSucceeded
	case attempt.SourceVersion:
		result.Outcome = OutcomeFailed
		result.HelperDiagnostic = store.readHelperDiagnostic(attempt.ProcessID)
	default:
		result.Outcome = OutcomeSuperseded
	}

	document.Attempt = nil
	document.Cleanup = appendCleanup(document.Cleanup, attempt.StagingDir)
	if err := store.saveLocked(document); err != nil {
		return ReconcileResult{}, err
	}
	cleanupErr := store.retryCleanupLocked(document)
	store.removeHelperLog(attempt.ProcessID)
	return result, cleanupErr
}

var terminalEscape = regexp.MustCompile(`\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))`)

func (store *Store) readHelperDiagnostic(processID int) string {
	path := store.helperLogPath(processID)
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return ""
	}
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, MaxHelperDiagnosticBytes*2))
	if err != nil {
		return ""
	}
	text := strings.ToValidUTF8(string(data), "�")
	text = terminalEscape.ReplaceAllString(text, "")
	var sanitized strings.Builder
	for _, character := range text {
		if character == '\n' || character == '\t' || !unicode.IsControl(character) {
			sanitized.WriteRune(character)
		}
		if sanitized.Len() >= MaxHelperDiagnosticBytes {
			break
		}
	}
	result := sanitized.String()
	if len(result) > MaxHelperDiagnosticBytes {
		result = result[:MaxHelperDiagnosticBytes]
		for !utf8.ValidString(result) {
			result = result[:len(result)-1]
		}
	}
	return result
}

func (store *Store) helperLogPath(processID int) string {
	return filepath.Join(store.tempRoot, fmt.Sprintf("wails-update-%d.log", processID))
}

func (store *Store) removeHelperLog(processID int) {
	path := store.helperLogPath(processID)
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return
	}
	_ = os.Remove(path)
}

func (store *Store) saveLocked(document Document) error {
	document.SchemaVersion = SchemaVersion
	if err := store.validateDocument(document); err != nil {
		return err
	}
	data, err := json.Marshal(document)
	if err != nil {
		return fmt.Errorf("encode application update state: %w", err)
	}
	data = append(data, '\n')
	directory := filepath.Dir(store.statePath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create application update state directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".application-update-*")
	if err != nil {
		return fmt.Errorf("create temporary application update state: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary application update state: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary application update state: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary application update state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary application update state: %w", err)
	}
	if err := store.replaceFile(temporaryPath, store.statePath); err != nil {
		return fmt.Errorf("replace application update state: %w", err)
	}
	return nil
}
