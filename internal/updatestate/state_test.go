package updatestate_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatestate"
	"github.com/stretchr/testify/require"
)

func newStore(t *testing.T, configure ...func(*updatestate.Config)) (*updatestate.Store, string, string) {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "owned-temp")
	require.NoError(t, os.Mkdir(root, 0o700))
	statePath := filepath.Join(base, "config", "application-update.json")
	config := updatestate.Config{
		StatePath: statePath,
		TempRoot:  root,
		Now: func() time.Time {
			return time.Date(2026, time.August, 14, 12, 30, 0, 0, time.UTC)
		},
		PID: func() int { return 4242 },
	}
	for _, apply := range configure {
		apply(&config)
	}
	store, err := updatestate.New(config)
	require.NoError(t, err)
	return store, root, statePath
}

func TestNewRejectsUnownedOrAmbiguousPaths(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "owned-temp")
	require.NoError(t, os.Mkdir(root, 0o700))
	statePath := filepath.Join(base, "application-update.json")

	_, err := updatestate.New(updatestate.Config{StatePath: "relative.json", TempRoot: root})
	require.ErrorContains(t, err, "state path must be absolute")
	_, err = updatestate.New(updatestate.Config{StatePath: statePath, TempRoot: "relative"})
	require.ErrorContains(t, err, "temp root must be absolute")
	_, err = updatestate.New(updatestate.Config{
		StatePath: statePath, TempRoot: filepath.Join(base, "missing"),
	})
	require.ErrorContains(t, err, "inspect application update temp root")

	external := t.TempDir()
	symlink := filepath.Join(base, "linked-temp")
	require.NoError(t, os.Symlink(external, symlink))
	_, err = updatestate.New(updatestate.Config{StatePath: statePath, TempRoot: symlink})
	require.ErrorContains(t, err, "non-symlink directory")
}

func createStagedPayload(t *testing.T, root, name string) (string, string) {
	t.Helper()
	staging := filepath.Join(root, name)
	payload := filepath.Join(staging, "Luxury Yacht.app")
	require.NoError(t, os.MkdirAll(payload, 0o700))
	return staging, payload
}

func preparedRecord(staging string) updatestate.PreparedUpdate {
	return updatestate.PreparedUpdate{
		TargetVersion:  "2.0.0",
		StagingDir:     staging,
		RecoveryTarget: updateidentity.RecoveryMacDownload,
	}
}

func attemptMetadata() updatestate.AttemptMetadata {
	return updatestate.AttemptMetadata{
		SourceVersion: "1.9.0",
		Platform:      "darwin",
		Architecture:  "arm64",
		Distribution:  updateidentity.DistributionMacBundle,
	}
}

func TestResolveStagingDirectoryAcceptsOnlyPayloadInsideDirectUpdaterChild(t *testing.T) {
	store, root, _ := newStore(t)
	_, payload := createStagedPayload(t, root, "wails-update-123")

	staging, err := store.ResolveStagingDirectory(payload)
	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "wails-update-123"), staging)

	for name, path := range map[string]string{
		"root itself":       root,
		"outside root":      filepath.Join(filepath.Dir(root), "wails-update-outside", "payload"),
		"non updater child": filepath.Join(root, "child-process-data", "payload"),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := store.ResolveStagingDirectory(path)
			require.Error(t, err)
		})
	}

	external := t.TempDir()
	symlink := filepath.Join(root, "wails-update-link")
	require.NoError(t, os.Symlink(external, symlink))
	_, err = store.ResolveStagingDirectory(filepath.Join(symlink, "payload"))
	require.ErrorContains(t, err, "symlink")
}

func TestRecordPreparedPersistsCanonicalExactOwnership(t *testing.T) {
	store, root, _ := newStore(t)
	staging, _ := createStagedPayload(t, root, "wails-update-prepared")

	require.NoError(t, store.RecordPrepared(preparedRecord(staging)))
	document, err := store.Load()
	require.NoError(t, err)
	require.Equal(t, &updatestate.PreparedUpdate{
		TargetVersion:  "2.0.0",
		StagingDir:     staging,
		RecoveryTarget: updateidentity.RecoveryMacDownload,
	}, document.Prepared)
	require.Nil(t, document.Attempt)
	require.Equal(t, []string{staging}, document.ProtectedPaths())

	invalid := preparedRecord(staging)
	invalid.TargetVersion = "v2.0.0"
	require.ErrorContains(t, store.RecordPrepared(invalid), "canonical")
}

func TestSkippedVersionPersistsInCanonicalReleaseForm(t *testing.T) {
	store, root, statePath := newStore(t)

	require.NoError(t, store.SetSkippedVersion("2.0.0-beta.4"))
	document, err := store.Load()
	require.NoError(t, err)
	require.Equal(t, "2.0.0-beta.4", document.SkippedVersion)
	require.ErrorContains(t, store.SetSkippedVersion("v2.0.0"), "canonical")

	reopened, err := updatestate.New(updatestate.Config{
		StatePath: statePath,
		TempRoot:  root,
	})
	require.NoError(t, err)
	document, err = reopened.Load()
	require.NoError(t, err)
	require.Equal(t, "2.0.0-beta.4", document.SkippedVersion)

	require.NoError(t, reopened.SetSkippedVersion(""))
	document, err = reopened.Load()
	require.NoError(t, err)
	require.Empty(t, document.SkippedVersion)
}

func TestLoadRejectsUnknownFieldsAndMultipleJSONValues(t *testing.T) {
	store, _, statePath := newStore(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(statePath), 0o700))

	require.NoError(t, os.WriteFile(
		statePath,
		[]byte(`{"schemaVersion":1,"unexpected":true}`),
		0o600,
	))
	_, err := store.Load()
	require.ErrorContains(t, err, "unknown field")
	require.NotNil(t, errors.Unwrap(err))

	require.NoError(t, os.WriteFile(
		statePath,
		[]byte("{\"schemaVersion\":1}\n{\"schemaVersion\":1}"),
		0o600,
	))
	_, err = store.Load()
	require.ErrorContains(t, err, "multiple JSON values")
}

func TestDiscardStagingRemovesOnlyValidatedExactUpdaterDirectory(t *testing.T) {
	store, root, _ := newStore(t)
	staging, _ := createStagedPayload(t, root, "wails-update-discard")
	outside := t.TempDir()

	require.NoError(t, store.DiscardStaging(staging))
	require.NoDirExists(t, staging)
	require.Error(t, store.DiscardStaging(outside))
	require.DirExists(t, outside)
}

func TestBeginAttemptAtomicallyTransfersPreparedOwnership(t *testing.T) {
	store, root, _ := newStore(t)
	staging, _ := createStagedPayload(t, root, "wails-update-attempt")
	require.NoError(t, store.RecordPrepared(preparedRecord(staging)))

	attempt, err := store.BeginAttempt(attemptMetadata())
	require.NoError(t, err)
	require.Equal(t, updatestate.UpdateAttempt{
		SourceVersion:  "1.9.0",
		TargetVersion:  "2.0.0",
		StartedAt:      time.Date(2026, time.August, 14, 12, 30, 0, 0, time.UTC),
		Platform:       "darwin",
		Architecture:   "arm64",
		Distribution:   updateidentity.DistributionMacBundle,
		ProcessID:      4242,
		StagingDir:     staging,
		RecoveryTarget: updateidentity.RecoveryMacDownload,
	}, attempt)
	document, err := store.Load()
	require.NoError(t, err)
	require.Nil(t, document.Prepared)
	require.Equal(t, &attempt, document.Attempt)

	require.NoError(t, store.RestorePrepared())
	document, err = store.Load()
	require.NoError(t, err)
	require.NotNil(t, document.Prepared)
	require.Nil(t, document.Attempt)
}

func TestBeginAttemptAcceptsEverySelfUpdatingDistributionWithMatchingRecovery(t *testing.T) {
	for _, test := range []struct {
		name         string
		platform     string
		distribution updateidentity.Distribution
		recovery     updateidentity.RecoveryTarget
	}{
		{name: "macOS", platform: "darwin", distribution: updateidentity.DistributionMacBundle, recovery: updateidentity.RecoveryMacDownload},
		{name: "Windows", platform: "windows", distribution: updateidentity.DistributionWindowsNSIS, recovery: updateidentity.RecoveryWindowsDownload},
		{name: "portable Linux", platform: "linux", distribution: updateidentity.DistributionLinuxPortable, recovery: updateidentity.RecoveryLinuxPortableDownload},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, root, _ := newStore(t)
			staging, _ := createStagedPayload(t, root, "wails-update-platform")
			prepared := preparedRecord(staging)
			prepared.RecoveryTarget = test.recovery
			require.NoError(t, store.RecordPrepared(prepared))

			attempt, err := store.BeginAttempt(updatestate.AttemptMetadata{
				SourceVersion: "1.9.0", Platform: test.platform, Architecture: "arm64",
				Distribution: test.distribution,
			})

			require.NoError(t, err)
			require.Equal(t, test.distribution, attempt.Distribution)
			require.Equal(t, test.recovery, attempt.RecoveryTarget)
		})
	}
}

func TestBeginAttemptRejectsRecoveryTargetFromAnotherDistribution(t *testing.T) {
	store, root, _ := newStore(t)
	staging, _ := createStagedPayload(t, root, "wails-update-wrong-recovery")
	prepared := preparedRecord(staging)
	prepared.RecoveryTarget = updateidentity.RecoveryWindowsDownload
	require.NoError(t, store.RecordPrepared(prepared))

	_, err := store.BeginAttempt(attemptMetadata())

	require.ErrorContains(t, err, "recovery target")
}

func TestBeginAttemptDoesNotLosePreparedOwnershipWhenPersistenceFails(t *testing.T) {
	failReplacement := false
	store, root, _ := newStore(t, func(config *updatestate.Config) {
		config.ReplaceFile = func(source, target string) error {
			if failReplacement {
				return errors.New("disk unavailable")
			}
			return os.Rename(source, target)
		}
	})
	staging, _ := createStagedPayload(t, root, "wails-update-persist-failure")
	require.NoError(t, store.RecordPrepared(preparedRecord(staging)))
	failReplacement = true

	_, err := store.BeginAttempt(attemptMetadata())
	require.ErrorContains(t, err, "disk unavailable")
	failReplacement = false
	document, err := store.Load()
	require.NoError(t, err)
	require.NotNil(t, document.Prepared)
	require.Nil(t, document.Attempt)
	require.DirExists(t, staging)
}

func TestReconcileAttemptClassifiesVersionAndCleansExactOwnedArtifacts(t *testing.T) {
	for _, test := range []struct {
		name           string
		currentVersion string
		wantOutcome    updatestate.Outcome
	}{
		{name: "success", currentVersion: "2.0.0", wantOutcome: updatestate.OutcomeSucceeded},
		{name: "restored source", currentVersion: "1.9.0", wantOutcome: updatestate.OutcomeFailed},
		{name: "superseded", currentVersion: "2.1.0", wantOutcome: updatestate.OutcomeSuperseded},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, root, _ := newStore(t)
			staging, _ := createStagedPayload(t, root, "wails-update-reconcile")
			require.NoError(t, store.RecordPrepared(preparedRecord(staging)))
			_, err := store.BeginAttempt(attemptMetadata())
			require.NoError(t, err)
			helperLog := filepath.Join(root, "wails-update-4242.log")
			require.NoError(t, os.WriteFile(helperLog, []byte("\x1b[31mhelper failed\x1b[0m\x00\n"), 0o600))

			result, err := store.Reconcile(test.currentVersion)
			require.NoError(t, err)
			require.Equal(t, test.wantOutcome, result.Outcome)
			require.Equal(t, "1.9.0", result.SourceVersion)
			require.Equal(t, "2.0.0", result.TargetVersion)
			require.Equal(t, updateidentity.RecoveryMacDownload, result.RecoveryTarget)
			if test.wantOutcome == updatestate.OutcomeFailed {
				require.Equal(t, "helper failed\n", result.HelperDiagnostic)
			} else {
				require.Empty(t, result.HelperDiagnostic)
			}
			require.NoDirExists(t, staging)
			require.NoFileExists(t, helperLog)
			document, loadErr := store.Load()
			require.NoError(t, loadErr)
			require.Nil(t, document.Attempt)
			require.Empty(t, document.Cleanup)
		})
	}
}

func TestReconcileDiscardsProcessLocalPreparedStateAndPreservesSkippedVersion(t *testing.T) {
	store, root, _ := newStore(t)
	staging, _ := createStagedPayload(t, root, "wails-update-abandoned-ready")
	require.NoError(t, store.SetSkippedVersion("1.8.0"))
	require.NoError(t, store.RecordPrepared(preparedRecord(staging)))

	result, err := store.Reconcile("1.9.0")

	require.NoError(t, err)
	require.Equal(t, updatestate.OutcomeNone, result.Outcome)
	require.NoDirExists(t, staging)
	document, err := store.Load()
	require.NoError(t, err)
	require.Nil(t, document.Prepared)
	require.Equal(t, "1.8.0", document.SkippedVersion)
	require.NoError(t, store.CleanupPrepared())
	require.ErrorContains(t, store.RestorePrepared(), "requires an attempted update")
	_, err = store.Reconcile("v1.9.0")
	require.ErrorContains(t, err, "canonical")
}

func TestReconcileReportsFailureWhenExpectedHelperLogIsMissing(t *testing.T) {
	store, root, _ := newStore(t)
	staging, _ := createStagedPayload(t, root, "wails-update-missing-log")
	require.NoError(t, store.RecordPrepared(preparedRecord(staging)))
	_, err := store.BeginAttempt(attemptMetadata())
	require.NoError(t, err)

	result, err := store.Reconcile("1.9.0")
	require.NoError(t, err)
	require.Equal(t, updatestate.OutcomeFailed, result.Outcome)
	require.Empty(t, result.HelperDiagnostic)
}

func TestReconcileBoundsAndSanitizesHelperDiagnostic(t *testing.T) {
	store, root, _ := newStore(t)
	staging, _ := createStagedPayload(t, root, "wails-update-large-log")
	require.NoError(t, store.RecordPrepared(preparedRecord(staging)))
	_, err := store.BeginAttempt(attemptMetadata())
	require.NoError(t, err)
	logPath := filepath.Join(root, "wails-update-4242.log")
	require.NoError(t, os.WriteFile(
		logPath,
		[]byte("\x1b[31m\x7f\u009b"+strings.Repeat("x", 100_000)+"\x1b[0m"),
		0o600,
	))

	result, err := store.Reconcile("1.9.0")
	require.NoError(t, err)
	require.LessOrEqual(t, len(result.HelperDiagnostic), updatestate.MaxHelperDiagnosticBytes)
	require.NotContains(t, result.HelperDiagnostic, "\x1b")
	require.NotContains(t, result.HelperDiagnostic, "\x7f")
	require.NotContains(t, result.HelperDiagnostic, "\u009b")
}

func TestFailedCleanupRemainsBoundedAndRetryable(t *testing.T) {
	failRemoval := true
	store, root, statePath := newStore(t, func(config *updatestate.Config) {
		config.RemoveAll = func(path string) error {
			if failRemoval {
				return errors.New("file busy")
			}
			return os.RemoveAll(path)
		}
	})
	staging, _ := createStagedPayload(t, root, "wails-update-cleanup")
	require.NoError(t, store.RecordPrepared(preparedRecord(staging)))

	err := store.CleanupPrepared()
	require.ErrorContains(t, err, "file busy")
	document, loadErr := store.Load()
	require.NoError(t, loadErr)
	require.Nil(t, document.Prepared)
	require.Equal(t, []string{staging}, document.Cleanup)
	require.DirExists(t, staging)

	failRemoval = false
	reopened, err := updatestate.New(updatestate.Config{
		StatePath: statePath, TempRoot: root,
	})
	require.NoError(t, err)
	require.NoError(t, reopened.RetryCleanup())
	require.NoDirExists(t, staging)
	document, err = reopened.Load()
	require.NoError(t, err)
	require.Empty(t, document.Cleanup)
}

func TestMalformedOrEscapingRecordsNeverDeletePaths(t *testing.T) {
	store, root, statePath := newStore(t)
	external := t.TempDir()
	sentinel := filepath.Join(external, "sentinel")
	require.NoError(t, os.WriteFile(sentinel, []byte("keep"), 0o600))
	require.NoError(t, os.MkdirAll(filepath.Dir(statePath), 0o700))
	require.NoError(t, os.WriteFile(statePath, []byte(`{
  "schemaVersion": 1,
  "prepared": {"targetVersion":"2.0.0","stagingDir":"`+external+`","recoveryTarget":"mac-download"}
}`), 0o600))

	_, err := store.Reconcile("1.9.0")
	require.ErrorContains(t, err, "direct child")
	require.FileExists(t, sentinel)
	document, loadErr := store.Load()
	require.NoError(t, loadErr)
	require.Empty(t, document.ProtectedPaths())

	symlink := filepath.Join(root, "wails-update-link")
	require.NoError(t, os.Symlink(external, symlink))
	require.NoError(t, os.WriteFile(statePath, []byte(`{
  "schemaVersion": 1,
  "cleanup": ["`+symlink+`"]
}`), 0o600))
	require.Error(t, store.RetryCleanup())
	require.FileExists(t, sentinel)
}
