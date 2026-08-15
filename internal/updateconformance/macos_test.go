package updateconformance

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestValidateMacOSArchiveReturnsOnlyTheWailsExtractedApp(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	writeArchive(t, artifact, false)
	var extracted string

	err := ValidateMacOSArchive(
		context.Background(), artifact, "2.0.0", "arm64",
		func(path string) error {
			extracted = path
			require.Equal(t, "Luxury Yacht.app", filepath.Base(path))
			require.FileExists(t, filepath.Join(path, "Contents", "MacOS", "luxury-yacht"))
			return nil
		},
	)

	require.NoError(t, err)
	require.NotEmpty(t, extracted)
	require.NoDirExists(t, filepath.Dir(extracted))
}

func TestValidateMacOSArchiveRejectsSiblingEntryThroughWails(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	writeArchive(t, artifact, true)

	err := ValidateMacOSArchive(
		context.Background(), artifact, "2.0.0", "arm64",
		func(string) error {
			t.Fatal("invalid payload reached bundle validator")
			return nil
		},
	)

	require.Error(t, err)
}

func TestValidateMacOSArchiveRejectsInvalidBoundaryInput(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "artifact.zip")
	require.NoError(t, os.WriteFile(artifact, []byte("invalid"), 0o600))

	err := ValidateMacOSArchive(context.Background(), artifact, "v2.0.0", "arm64", func(string) error { return nil })
	require.ErrorContains(t, err, "canonical")
	err = ValidateMacOSArchive(context.Background(), artifact, "2.0.0", "386", func(string) error { return nil })
	require.ErrorContains(t, err, "architecture")
	err = ValidateMacOSArchive(context.Background(), filepath.Join(t.TempDir(), "missing.zip"), "2.0.0", "arm64", func(string) error { return nil })
	require.ErrorContains(t, err, "inspect macOS updater artifact")
}

func TestValidateMacOSArchiveRejectsSymlinkAndValidatorFailure(t *testing.T) {
	archive := filepath.Join(t.TempDir(), "archive.zip")
	writeArchive(t, archive, false)
	symlink := filepath.Join(t.TempDir(), "linked.zip")
	require.NoError(t, os.Symlink(archive, symlink))

	err := ValidateMacOSArchive(context.Background(), symlink, "2.0.0", "arm64", func(string) error { return nil })
	require.ErrorContains(t, err, "non-symlink")
	err = ValidateMacOSArchive(context.Background(), archive, "2.0.0", "arm64", nil)
	require.ErrorContains(t, err, "validator is required")
	err = ValidateMacOSArchive(context.Background(), archive, "2.0.0", "arm64", func(string) error {
		return errors.New("codesign rejected bundle")
	})
	require.ErrorContains(t, err, "codesign rejected bundle")
}

func TestLocalUpdaterHostAndCanceledReaderAreSafeHeadlessAdapters(t *testing.T) {
	host := localUpdaterHost{}
	require.False(t, host.Emit("event"))
	host.OnEvent("event", func(any) {})()
	window := host.OpenWindow(updater.WindowOptions{})
	require.False(t, window.EmitEvent("event"))
	window.Show()
	window.Close()
	host.Quit()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	artifact := filepath.Join(t.TempDir(), "artifact")
	require.NoError(t, os.WriteFile(artifact, []byte("artifact"), 0o600))
	err := (localArtifactProvider{path: artifact}).Download(ctx, nil, io.Discard, func(int64, int64) {})
	require.ErrorIs(t, err, context.Canceled)
}

func writeArchive(t *testing.T, path string, sibling bool) {
	t.Helper()
	file, err := os.Create(path)
	require.NoError(t, err)
	archive := zip.NewWriter(file)
	entries := []struct {
		name string
		body string
		mode os.FileMode
	}{
		{name: "Luxury Yacht.app/", mode: os.ModeDir | 0o755},
		{name: "Luxury Yacht.app/Contents/", mode: os.ModeDir | 0o755},
		{name: "Luxury Yacht.app/Contents/Info.plist", body: "<plist/>", mode: 0o644},
		{name: "Luxury Yacht.app/Contents/MacOS/", mode: os.ModeDir | 0o755},
		{name: "Luxury Yacht.app/Contents/MacOS/luxury-yacht", body: "binary", mode: 0o755},
	}
	if sibling {
		entries = append(entries, struct {
			name string
			body string
			mode os.FileMode
		}{name: "__MACOSX/metadata", body: "metadata", mode: 0o644})
	}
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		header.SetMode(entry.mode)
		writer, createErr := archive.CreateHeader(header)
		require.NoError(t, createErr)
		if entry.body != "" {
			_, createErr = writer.Write([]byte(entry.body))
			require.NoError(t, createErr)
		}
	}
	require.NoError(t, archive.Close())
	require.NoError(t, file.Close())
}
