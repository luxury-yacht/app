package updateconformance

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateLinuxArchiveStagesOneExecutableThroughWails(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-linux-amd64-updater.tar.gz")
	writeLinuxArchive(t, artifact, []linuxTestArchiveEntry{{
		name: "luxury-yacht", contents: "linux binary", mode: 0o755,
	}})

	require.NoError(t, ValidateLinuxArchive(context.Background(), artifact, "2.0.0", "amd64", "luxury-yacht"))
}

func TestValidateLinuxArchiveRejectsPayloadWailsCannotReplace(t *testing.T) {
	for _, test := range []struct {
		name    string
		entries []linuxTestArchiveEntry
		want    string
	}{
		{
			name: "sibling", want: "exactly one top-level entry",
			entries: []linuxTestArchiveEntry{
				{name: "luxury-yacht", contents: "binary", mode: 0o755},
				{name: "README.txt", contents: "not replaceable", mode: 0o644},
			},
		},
		{
			name: "directory", want: "one executable regular file",
			entries: []linuxTestArchiveEntry{
				{name: "bundle/luxury-yacht", contents: "binary", mode: 0o755},
			},
		},
		{
			name: "not executable", want: "one executable regular file",
			entries: []linuxTestArchiveEntry{
				{name: "luxury-yacht", contents: "binary", mode: 0o644},
			},
		},
		{
			name: "wrong name", want: "one executable regular file",
			entries: []linuxTestArchiveEntry{
				{name: "other-app", contents: "binary", mode: 0o755},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-linux-amd64-updater.tar.gz")
			writeLinuxArchive(t, artifact, test.entries)

			err := ValidateLinuxArchive(context.Background(), artifact, "2.0.0", "amd64", "luxury-yacht")

			require.ErrorContains(t, err, test.want)
		})
	}
}

func TestValidateLinuxArchiveRejectsInvalidBoundaryInput(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "artifact.tar.gz")
	writeLinuxArchive(t, artifact, []linuxTestArchiveEntry{{name: "luxury-yacht", contents: "binary", mode: 0o755}})

	err := ValidateLinuxArchive(context.Background(), artifact, "v2.0.0", "amd64", "luxury-yacht")
	require.ErrorContains(t, err, "canonical")
	err = ValidateLinuxArchive(context.Background(), artifact, "2.0.0", "386", "luxury-yacht")
	require.ErrorContains(t, err, "architecture")
	err = ValidateLinuxArchive(context.Background(), artifact, "2.0.0", "amd64", "../yacht")
	require.ErrorContains(t, err, "binary name")
}

func TestLocalUpdaterArtifactRejectsInvalidVersionForUnknownPlatform(t *testing.T) {
	_, err := stageLocalUpdaterArtifact(
		context.Background(),
		filepath.Join(t.TempDir(), "artifact"),
		"not-a-version",
		"freebsd",
		"amd64",
	)
	require.ErrorContains(t, err, "parse freebsd updater version")
}

type linuxTestArchiveEntry struct {
	contents string
	mode     int64
	name     string
}

func writeLinuxArchive(t *testing.T, path string, entries []linuxTestArchiveEntry) {
	t.Helper()
	file, err := os.Create(path)
	require.NoError(t, err)
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	for _, entry := range entries {
		require.NoError(t, tarWriter.WriteHeader(&tar.Header{
			Name: entry.name, Mode: entry.mode, Size: int64(len(entry.contents)), Typeflag: tar.TypeReg,
		}))
		_, err = tarWriter.Write([]byte(entry.contents))
		require.NoError(t, err)
	}
	require.NoError(t, tarWriter.Close())
	require.NoError(t, gzipWriter.Close())
	require.NoError(t, file.Close())
}
