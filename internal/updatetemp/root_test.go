package updatetemp_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/internal/updatetemp"
	"github.com/stretchr/testify/require"
)

type memoryEnvironment struct {
	values  map[string]string
	failKey string
}

func newMemoryEnvironment() *memoryEnvironment {
	return &memoryEnvironment{values: make(map[string]string)}
}

func (environment *memoryEnvironment) LookupEnv(name string) (string, bool) {
	value, ok := environment.values[name]
	return value, ok
}

func (environment *memoryEnvironment) Setenv(name, value string) error {
	if name == environment.failKey {
		return errors.New("setenv failed")
	}
	environment.values[name] = value
	return nil
}

func (environment *memoryEnvironment) Unsetenv(name string) error {
	delete(environment.values, name)
	return nil
}

func TestSetupCreatesAndReusesStableOwnedRootWithoutNesting(t *testing.T) {
	base := t.TempDir()
	environment := newMemoryEnvironment()
	config := updatetemp.Config{
		Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: environment,
	}

	root, err := updatetemp.Setup(config)

	require.NoError(t, err)
	require.Equal(t, updatetemp.ExpectedRoot(base, "501"), root)
	require.Equal(t, root, environment.values["TMPDIR"])
	require.Equal(t, root, environment.values[updatetemp.RootEnvironmentName])
	info, err := os.Lstat(root)
	require.NoError(t, err)
	require.True(t, info.IsDir())
	require.Equal(t, os.FileMode(0o700), info.Mode().Perm())
	markerInfo, err := os.Lstat(filepath.Join(root, updatetemp.OwnershipMarkerName))
	require.NoError(t, err)
	require.True(t, markerInfo.Mode().IsRegular())
	require.Equal(t, os.FileMode(0o600), markerInfo.Mode().Perm())

	reused, err := updatetemp.Setup(config)
	require.NoError(t, err)
	require.Equal(t, root, reused)

	// Some launchers may preserve TMPDIR but drop the application-owned marker.
	// Feeding that inherited temp directory back into setup must reuse it rather
	// than creating root/root.
	require.NoError(t, environment.Unsetenv(updatetemp.RootEnvironmentName))
	config.BaseTempDir = root
	reusedWithoutMarker, err := updatetemp.Setup(config)
	require.NoError(t, err)
	require.Equal(t, root, reusedWithoutMarker)
}

func TestSetupSetsWindowsTempVariablesForChildProcesses(t *testing.T) {
	base := t.TempDir()
	environment := newMemoryEnvironment()

	root, err := updatetemp.Setup(updatetemp.Config{
		Platform: "windows", BaseTempDir: base, UserID: "S-1-5-21-123", Environment: environment,
	})

	require.NoError(t, err)
	require.Equal(t, root, environment.values["TMP"])
	require.Equal(t, root, environment.values["TEMP"])
	require.NotContains(t, environment.values, "TMPDIR")
}

func TestSetupRejectsSymlinkedRootAndInvalidOwnershipMarker(t *testing.T) {
	t.Run("symlinked root", func(t *testing.T) {
		base := t.TempDir()
		root := updatetemp.ExpectedRoot(base, "501")
		require.NoError(t, os.Symlink(t.TempDir(), root))

		_, err := updatetemp.Setup(updatetemp.Config{
			Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: newMemoryEnvironment(),
		})

		require.ErrorContains(t, err, "must not be a symlink")
	})

	t.Run("invalid marker", func(t *testing.T) {
		base := t.TempDir()
		root := updatetemp.ExpectedRoot(base, "501")
		require.NoError(t, os.Mkdir(root, 0o700))
		require.NoError(t, os.WriteFile(filepath.Join(root, updatetemp.OwnershipMarkerName), []byte(`{}`), 0o600))

		_, err := updatetemp.Setup(updatetemp.Config{
			Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: newMemoryEnvironment(),
		})

		require.ErrorContains(t, err, "invalid ownership marker")
	})
}

func TestSetupReturnsEnvironmentFailureWithoutSelectingFallback(t *testing.T) {
	base := t.TempDir()
	environment := newMemoryEnvironment()
	environment.failKey = "TMPDIR"

	root, err := updatetemp.Setup(updatetemp.Config{
		Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: environment,
	})

	require.Empty(t, root)
	require.ErrorContains(t, err, "set TMPDIR")
	require.NotContains(t, environment.values, updatetemp.RootEnvironmentName)
}

func TestSetupRejectsInvalidRootInputsBeforeChangingEnvironment(t *testing.T) {
	for _, test := range []struct {
		name   string
		base   string
		userID string
		want   string
	}{
		{name: "relative base", base: "relative", userID: "501", want: "must be absolute"},
		{name: "missing user", base: t.TempDir(), userID: "", want: "user identity is required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			environment := newMemoryEnvironment()

			_, err := updatetemp.Setup(updatetemp.Config{
				Platform: "darwin", BaseTempDir: test.base, UserID: test.userID, Environment: environment,
			})

			require.ErrorContains(t, err, test.want)
			require.Empty(t, environment.values)
		})
	}
}

func TestSetupRejectsUnexpectedInheritedRoot(t *testing.T) {
	base := t.TempDir()
	environment := newMemoryEnvironment()
	environment.values[updatetemp.RootEnvironmentName] = filepath.Join(t.TempDir(), "unexpected")

	_, err := updatetemp.Setup(updatetemp.Config{
		Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: environment,
	})

	require.ErrorContains(t, err, "unexpected path")
}

func TestSetupRejectsRegularFileRootAndUnsafeMarker(t *testing.T) {
	t.Run("root is file", func(t *testing.T) {
		base := t.TempDir()
		root := updatetemp.ExpectedRoot(base, "501")
		require.NoError(t, os.WriteFile(root, []byte("not a directory"), 0o600))

		_, err := updatetemp.Setup(updatetemp.Config{
			Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: newMemoryEnvironment(),
		})

		require.ErrorContains(t, err, "must be a directory")
	})

	t.Run("marker is symlink", func(t *testing.T) {
		base := t.TempDir()
		root := updatetemp.ExpectedRoot(base, "501")
		require.NoError(t, os.Mkdir(root, 0o700))
		require.NoError(t, os.Symlink(filepath.Join(base, "outside"), filepath.Join(root, updatetemp.OwnershipMarkerName)))

		_, err := updatetemp.Setup(updatetemp.Config{
			Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: newMemoryEnvironment(),
		})

		require.ErrorContains(t, err, "must be a regular file")
	})
}

func TestSetupRollsBackPartiallyAppliedEnvironment(t *testing.T) {
	base := t.TempDir()
	environment := newMemoryEnvironment()
	environment.values["TMPDIR"] = "/previous/temp"
	environment.failKey = updatetemp.RootEnvironmentName

	_, err := updatetemp.Setup(updatetemp.Config{
		Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: environment,
	})

	require.ErrorContains(t, err, "set "+updatetemp.RootEnvironmentName)
	require.Equal(t, "/previous/temp", environment.values["TMPDIR"])
	require.NotContains(t, environment.values, updatetemp.RootEnvironmentName)
}

func TestSweepOrphansRemovesOnlyUnreferencedUpdaterArtifactsInsideOwnedRoot(t *testing.T) {
	base := t.TempDir()
	root, err := updatetemp.Setup(updatetemp.Config{
		Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: newMemoryEnvironment(),
	})
	require.NoError(t, err)

	orphanDirectory := filepath.Join(root, "wails-update-orphan")
	protectedDirectory := filepath.Join(root, "wails-update-prepared")
	unrelatedDirectory := filepath.Join(root, "child-process-data")
	require.NoError(t, os.Mkdir(orphanDirectory, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(orphanDirectory, ".artifact"), []byte("orphan"), 0o600))
	require.NoError(t, os.Mkdir(protectedDirectory, 0o700))
	require.NoError(t, os.Mkdir(unrelatedDirectory, 0o700))
	logPath := filepath.Join(root, "wails-update-123.log")
	nonLogPath := filepath.Join(root, "wails-update-not-a-log.txt")
	require.NoError(t, os.WriteFile(logPath, []byte("helper"), 0o600))
	require.NoError(t, os.WriteFile(nonLogPath, []byte("keep"), 0o600))

	externalDirectory := t.TempDir()
	externalSentinel := filepath.Join(externalDirectory, "sentinel")
	require.NoError(t, os.WriteFile(externalSentinel, []byte("keep"), 0o600))
	require.NoError(t, os.Symlink(externalDirectory, filepath.Join(root, "wails-update-symlink")))

	removed, err := updatetemp.SweepOrphans(root, []string{protectedDirectory})

	require.NoError(t, err)
	require.ElementsMatch(t, []string{orphanDirectory, logPath}, removed)
	require.NoDirExists(t, orphanDirectory)
	require.NoFileExists(t, logPath)
	require.DirExists(t, protectedDirectory)
	require.DirExists(t, unrelatedDirectory)
	require.FileExists(t, nonLogPath)
	require.FileExists(t, externalSentinel)
	require.FileExists(t, filepath.Join(root, "wails-update-symlink"))
}

func TestSweepOrphansRejectsInvalidProtectionBeforeRemovingAnything(t *testing.T) {
	base := t.TempDir()
	root, err := updatetemp.Setup(updatetemp.Config{
		Platform: "darwin", BaseTempDir: base, UserID: "501", Environment: newMemoryEnvironment(),
	})
	require.NoError(t, err)
	orphanDirectory := filepath.Join(root, "wails-update-orphan")
	require.NoError(t, os.Mkdir(orphanDirectory, 0o700))

	removed, err := updatetemp.SweepOrphans(root, []string{filepath.Join(base, "outside")})

	require.ErrorContains(t, err, "direct child")
	require.Empty(t, removed)
	require.DirExists(t, orphanDirectory)
}

func TestSweepOrphansRejectsMissingRoot(t *testing.T) {
	removed, err := updatetemp.SweepOrphans(filepath.Join(t.TempDir(), "missing"), nil)

	require.ErrorContains(t, err, "inspect updater temp root")
	require.Empty(t, removed)
}
