package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"testing/iotest"

	"github.com/stretchr/testify/require"
)

type closeErrorWriter struct {
	err error
}

func (*closeErrorWriter) Write(buffer []byte) (int, error) {
	return len(buffer), nil
}

func (writer *closeErrorWriter) Close() error {
	return writer.err
}

func TestCopyUpdaterArtifactPreservesCopyAndCloseFailures(t *testing.T) {
	copyErr := errors.New("copy failed")
	closeErr := errors.New("close failed")

	err := copyAndCloseUpdaterArtifact(
		iotest.ErrReader(copyErr),
		&closeErrorWriter{err: closeErr},
		"source-artifact",
		"staged-artifact",
	)

	require.ErrorIs(t, err, copyErr)
	require.ErrorIs(t, err, closeErr)
}

func TestCollectUpdaterArtifactsRequiresOneExactFilePerOrderedTarget(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0-beta.4")
	root := t.TempDir()
	arm64 := filepath.Join(root, "darwin-arm64", "luxury-yacht-v2.0.0-beta.4-darwin-arm64.zip")
	amd64 := filepath.Join(root, "darwin-amd64", "luxury-yacht-v2.0.0-beta.4-darwin-amd64.zip")
	for _, path := range []string{amd64, arm64} {
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, []byte(filepath.Base(path)), 0o600))
	}

	artifacts, err := collectUpdaterArtifactsForTargets(metadata, root, []updaterTarget{
		{Platform: "darwin", Architecture: "arm64"},
		{Platform: "darwin", Architecture: "amd64"},
	})

	require.NoError(t, err)
	require.Equal(t, []string{arm64, amd64}, artifacts)
}

func TestCollectLinuxUpdaterArtifactIgnoresManualInstallerAndPackages(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0-beta.4")
	root := t.TempDir()
	updaterArchive := filepath.Join(root, "luxury-yacht-v2.0.0-beta.4-linux-amd64.tar.gz")
	for _, name := range []string{
		filepath.Base(updaterArchive),
		"luxury-yacht-v2.0.0-beta.4-linux-amd64-portable.tar.gz",
		"luxury-yacht_2.0.0-beta.4_linux_amd64.deb",
		"luxury-yacht-v2.0.0-beta.4-linux-x86_64.rpm",
	} {
		require.NoError(t, os.WriteFile(filepath.Join(root, name), []byte(name), 0o600))
	}

	artifacts, err := collectUpdaterArtifactsForTargets(metadata, root, []updaterTarget{{
		Platform: "linux", Architecture: "amd64",
	}})

	require.NoError(t, err)
	require.Equal(t, []string{updaterArchive}, artifacts)
}

func TestCollectUpdaterArtifactsRejectsMissingDuplicateOrNonRegularTarget(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0")
	target := updaterTarget{Platform: "darwin", Architecture: "arm64"}
	name := "luxury-yacht-v2.0.0-darwin-arm64.zip"

	t.Run("missing", func(t *testing.T) {
		_, err := collectUpdaterArtifactsForTargets(metadata, t.TempDir(), []updaterTarget{target})
		require.ErrorContains(t, err, "missing updater artifact")
	})

	t.Run("duplicate", func(t *testing.T) {
		root := t.TempDir()
		for _, directory := range []string{"one", "two"} {
			path := filepath.Join(root, directory, name)
			require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
			require.NoError(t, os.WriteFile(path, []byte(directory), 0o600))
		}
		_, err := collectUpdaterArtifactsForTargets(metadata, root, []updaterTarget{target})
		require.ErrorContains(t, err, "duplicate updater artifact")
	})

	t.Run("symlink", func(t *testing.T) {
		root := t.TempDir()
		external := filepath.Join(t.TempDir(), "artifact.zip")
		require.NoError(t, os.WriteFile(external, []byte("artifact"), 0o600))
		require.NoError(t, os.Symlink(external, filepath.Join(root, name)))
		_, err := collectUpdaterArtifactsForTargets(metadata, root, []updaterTarget{target})
		require.ErrorContains(t, err, "regular non-symlink file")
	})
}

func TestParseUpdaterTargetsRejectsAmbiguousOrUnsupportedInput(t *testing.T) {
	targets, err := parseUpdaterTargets("darwin/arm64,darwin/amd64")
	require.NoError(t, err)
	require.Equal(t, []updaterTarget{
		{Platform: "darwin", Architecture: "arm64"},
		{Platform: "darwin", Architecture: "amd64"},
	}, targets)

	for _, input := range []string{"", "darwin", "darwin/386", "macos/arm64", "darwin/arm64,darwin/arm64"} {
		_, err := parseUpdaterTargets(input)
		require.Errorf(t, err, "parseUpdaterTargets(%q)", input)
	}
}

func TestPrepareUpdaterManifestUsesCanonicalVersionExplicitFilesAndPinnedVerification(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0-beta.4")
	root := t.TempDir()
	artifact := filepath.Join(root, "nested", "luxury-yacht-v2.0.0-beta.4-darwin-arm64.zip")
	require.NoError(t, os.MkdirAll(filepath.Dir(artifact), 0o755))
	require.NoError(t, os.WriteFile(artifact, []byte("artifact"), 0o600))
	privateKey := filepath.Join(t.TempDir(), "updater.key")
	publicKey := filepath.Join(t.TempDir(), "updater.key.pub")
	notes := filepath.Join(t.TempDir(), "notes.md")
	for _, path := range []string{privateKey, publicKey, notes} {
		require.NoError(t, os.WriteFile(path, []byte("test"), 0o600))
	}
	output := filepath.Join(t.TempDir(), "updater.json")
	var calls [][]string
	runner := func(name string, args ...string) error {
		calls = append(calls, append([]string{name}, args...))
		if len(args) > 1 && args[0] == "updater" && args[1] == "manifest" {
			return os.WriteFile(output, []byte("{}\n"), 0o600)
		}
		return nil
	}

	err := prepareUpdaterManifest(updaterManifestConfig{
		Metadata: metadata, ArtifactsRoot: root,
		Targets:        []updaterTarget{{Platform: "darwin", Architecture: "arm64"}},
		PrivateKeyPath: privateKey, PublicKey: publicKey,
		NotesFile: notes, OutputPath: output,
	}, runner)

	require.NoError(t, err)
	require.Len(t, calls, 2)
	stagingDirectory := filepath.Join(filepath.Dir(output), ".updater-manifest-beta")
	require.Equal(t, []string{
		"wails3", "updater", "manifest",
		"-version", "2.0.0-beta.4",
		"-channel", "beta",
		"-name", "Luxury Yacht 2.0.0-beta.4",
		"-notes-file", notes,
		"-key", privateKey,
		"-url-prefix", "https://github.com/luxury-yacht/app/releases/download/v2.0.0-beta.4",
		"-output", output,
		filepath.Join(stagingDirectory, filepath.Base(artifact)),
	}, calls[0])
	require.Equal(t, []string{
		"wails3", "updater", "verify",
		"-manifest", output,
		"-publickey", publicKey,
		"-dir", stagingDirectory,
	}, calls[1])
}

func TestPrepareUpdaterManifestRejectsIncompleteOrUnverifiableInputs(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0")
	directory := t.TempDir()
	privateKey := filepath.Join(directory, "key")
	publicKey := filepath.Join(directory, "key.pub")
	notes := filepath.Join(directory, "notes.md")
	for _, path := range []string{privateKey, publicKey, notes} {
		require.NoError(t, os.WriteFile(path, []byte("test"), 0o600))
	}
	base := updaterManifestConfig{
		Metadata:       metadata,
		PrivateKeyPath: privateKey, PublicKey: publicKey,
		NotesFile: notes, OutputPath: filepath.Join(directory, "updater.json"),
	}
	for _, test := range []struct {
		name      string
		configure func(*updaterManifestConfig)
		want      string
	}{
		{name: "private key", configure: func(config *updaterManifestConfig) { config.PrivateKeyPath = "" }, want: "private key path is required"},
		{name: "public key", configure: func(config *updaterManifestConfig) { config.PublicKey = "" }, want: "public key is required"},
		{name: "notes", configure: func(config *updaterManifestConfig) { config.NotesFile = "" }, want: "release notes file is required"},
		{name: "output", configure: func(config *updaterManifestConfig) { config.OutputPath = "" }, want: "output path is required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := base
			test.configure(&config)
			err := prepareUpdaterManifest(config, func(string, ...string) error { return nil })
			require.ErrorContains(t, err, test.want)
		})
	}

	symlink := filepath.Join(directory, "linked-key")
	require.NoError(t, os.Symlink(privateKey, symlink))
	config := base
	config.PrivateKeyPath = symlink
	err := prepareUpdaterManifest(config, func(string, ...string) error { return nil })
	require.ErrorContains(t, err, "regular non-symlink")

	artifactRoot := t.TempDir()
	artifact := filepath.Join(artifactRoot, "luxury-yacht-v2.0.0-darwin-arm64.zip")
	require.NoError(t, os.WriteFile(artifact, []byte("artifact"), 0o600))
	config = base
	config.ArtifactsRoot = artifactRoot
	config.Targets = []updaterTarget{{Platform: "darwin", Architecture: "arm64"}}
	config.Metadata.Info.ProductName = ""
	err = prepareUpdaterManifest(config, func(string, ...string) error { return nil })
	require.ErrorContains(t, err, "no info.productName")

	config.Metadata.Info.ProductName = "Luxury Yacht"
	err = prepareUpdaterManifest(config, func(string, ...string) error {
		return errors.New("manifest command failed")
	})
	require.ErrorContains(t, err, "manifest command failed")
}

func TestValidateMacOSUpdaterArchiveUsesWailsExtractedPayload(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	writeMacAppArchive(t, artifact, false)
	var validatedPath string

	err := validateMacOSUpdaterArchive(context.Background(), artifact, "2.0.0", "arm64", func(path string) error {
		validatedPath = path
		require.Equal(t, "Luxury Yacht.app", filepath.Base(path))
		require.FileExists(t, filepath.Join(path, "Contents", "MacOS", "luxury-yacht"))
		return nil
	})

	require.NoError(t, err)
	require.NotEmpty(t, validatedPath)
	require.NoDirExists(t, filepath.Dir(validatedPath))
}

func TestValidateMacOSUpdaterArchiveRejectsMultipleTopLevelEntries(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	writeMacAppArchive(t, artifact, true)

	err := validateMacOSUpdaterArchive(context.Background(), artifact, "2.0.0", "arm64", func(string) error {
		t.Fatal("invalid archive reached bundle validation")
		return nil
	})

	require.Error(t, err)
}

func TestValidateConfiguredMacOSUpdaterArchiveRunsPlatformChecksOnExtractedBundle(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0")
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	writeMacAppArchive(t, artifact, false)
	var calls [][]string

	err := validateConfiguredMacOSUpdaterArchive(
		context.Background(), metadata, artifact, "ARM64",
		func(name string, args ...string) error {
			calls = append(calls, append([]string{name}, args...))
			return nil
		},
	)

	require.NoError(t, err)
	require.Len(t, calls, 3)
	require.Equal(t, []string{"codesign", "--verify", "--deep", "--strict"}, calls[0][:4])
	require.Equal(t, []string{"spctl", "--assess", "--type", "execute"}, calls[1][:4])
	require.Equal(t, []string{"xcrun", "stapler", "validate"}, calls[2][:3])
	require.Equal(t, calls[0][4], calls[1][4])
	require.Equal(t, calls[0][4], calls[2][3])
	require.NoDirExists(t, filepath.Dir(calls[0][4]))
}

func TestValidateConfiguredMacOSUpdaterArchiveRejectsWrongNameAndPlatformFailure(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0")
	wrongName := filepath.Join(t.TempDir(), "wrong.zip")
	writeMacAppArchive(t, wrongName, false)
	err := validateConfiguredMacOSUpdaterArchive(
		context.Background(), metadata, wrongName, "arm64", func(string, ...string) error { return nil },
	)
	require.ErrorContains(t, err, "does not match expected")

	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	writeMacAppArchive(t, artifact, false)
	err = validateConfiguredMacOSUpdaterArchive(
		context.Background(), metadata, artifact, "arm64", func(name string, _ ...string) error {
			if name == "codesign" {
				return errors.New("signature invalid")
			}
			return nil
		},
	)
	require.ErrorContains(t, err, "signature invalid")
}

func TestValidateConfiguredLinuxUpdaterArchiveUsesExactWailsPayload(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0")
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-linux-arm64.tar.gz")
	writeLinuxUpdaterArchive(t, artifact, "luxury-yacht", 0o755)

	require.NoError(t, validateConfiguredLinuxUpdaterArchive(
		context.Background(), metadata, artifact, "ARM64",
	))

	wrongName := filepath.Join(t.TempDir(), "wrong.tar.gz")
	writeLinuxUpdaterArchive(t, wrongName, "luxury-yacht", 0o755)
	err := validateConfiguredLinuxUpdaterArchive(context.Background(), metadata, wrongName, "arm64")
	require.ErrorContains(t, err, "does not match expected")

	err = validateConfiguredLinuxUpdaterArchive(context.Background(), metadata, artifact, "386")
	require.ErrorContains(t, err, "unsupported updater artifact target")
}

func TestPrepareReleaseUpdaterManifestSignsOneImmutableAssetForStableRelease(t *testing.T) {
	t.Chdir(repositoryPath())
	directory := t.TempDir()
	metadata := testProjectMetadata("v2.0.0")
	for _, target := range []updaterTarget{
		{Platform: "darwin", Architecture: "arm64"},
		{Platform: "darwin", Architecture: "amd64"},
	} {
		name, err := updaterArtifactName(metadata, target.Platform, target.Architecture)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(directory, name), []byte("artifact"), 0o600))
	}
	privateKey := filepath.Join(directory, "updater.key")
	publicKey := filepath.Join(directory, "updater.key.pub")
	require.NoError(t, os.WriteFile(privateKey, []byte("private"), 0o600))
	require.NoError(t, os.WriteFile(publicKey, []byte("public"), 0o600))
	environment := map[string]string{
		"UPDATER_ARTIFACTS_DIR":    directory,
		"UPDATER_TARGETS":          "darwin/arm64,darwin/amd64",
		"UPDATER_PRIVATE_KEY_PATH": privateKey,
		"UPDATER_PUBLIC_KEY":       publicKey,
		"GITHUB_RUN_NUMBER":        "42",
	}
	var channels []string
	run := func(_ string, args ...string) error {
		if slices.Contains(args, "manifest") {
			channel := args[slices.Index(args, "-channel")+1]
			channels = append(channels, channel)
			output := args[slices.Index(args, "-output")+1]
			require.NoError(t, os.WriteFile(output, []byte("{}\n"), 0o600))
		}
		return nil
	}

	err := prepareReleaseUpdaterManifest(
		metadata,
		projectFacts{version: "v2.0.0"},
		func(name string) string { return environment[name] },
		run,
	)

	require.NoError(t, err)
	require.Equal(t, []string{"stable"}, channels)
	require.FileExists(t, filepath.Join(directory, "updater.json"))
}

func TestPrepareReleaseUpdaterManifestRejectsMismatchedOrIncompleteConfiguration(t *testing.T) {
	metadata := testProjectMetadata("v2.0.0-beta.1")
	err := prepareReleaseUpdaterManifest(
		metadata,
		projectFacts{version: "v2.0.0-beta.2"},
		func(string) string { return "" },
		func(string, ...string) error { return nil },
	)
	require.ErrorContains(t, err, "does not match metadata")

	err = prepareReleaseUpdaterManifest(
		metadata,
		projectFacts{version: "v2.0.0-beta.1"},
		func(name string) string {
			if name == "UPDATER_TARGETS" {
				return "darwin/arm64"
			}
			return ""
		},
		func(string, ...string) error { return nil },
	)
	require.ErrorContains(t, err, "artifact root")
}

func testProjectMetadata(version string) projectMetadata {
	var metadata projectMetadata
	metadata.Info.ProductName = "Luxury Yacht"
	metadata.Info.Version = version
	return metadata
}

func writeMacAppArchive(t *testing.T, path string, sibling bool) {
	t.Helper()
	file, err := os.Create(path)
	require.NoError(t, err)
	archive := zip.NewWriter(file)
	for name, body := range map[string]string{
		"Luxury Yacht.app/":                                "",
		"Luxury Yacht.app/Contents/":                       "",
		"Luxury Yacht.app/Contents/Info.plist":             "<plist/>",
		"Luxury Yacht.app/Contents/MacOS/":                 "",
		"Luxury Yacht.app/Contents/MacOS/luxury-yacht":     "binary",
		"Luxury Yacht.app/Contents/Resources/appicon.icns": "icon",
	} {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		if body == "" {
			header.SetMode(os.ModeDir | 0o755)
		} else if filepath.Base(name) == "luxury-yacht" {
			header.SetMode(0o755)
		} else {
			header.SetMode(0o644)
		}
		writer, createErr := archive.CreateHeader(header)
		require.NoError(t, createErr)
		if body != "" {
			_, createErr = writer.Write([]byte(body))
			require.NoError(t, createErr)
		}
	}
	if sibling {
		writer, createErr := archive.Create("__MACOSX/metadata")
		require.NoError(t, createErr)
		_, createErr = writer.Write([]byte("metadata"))
		require.NoError(t, createErr)
	}
	require.NoError(t, archive.Close())
	require.NoError(t, file.Close())
}

func writeLinuxUpdaterArchive(t *testing.T, path, name string, mode int64) {
	t.Helper()
	file, err := os.Create(path)
	require.NoError(t, err)
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	contents := []byte("linux binary")
	require.NoError(t, tarWriter.WriteHeader(&tar.Header{
		Name: name, Mode: mode, Size: int64(len(contents)), Typeflag: tar.TypeReg,
	}))
	_, err = tarWriter.Write(contents)
	require.NoError(t, err)
	require.NoError(t, tarWriter.Close())
	require.NoError(t, gzipWriter.Close())
	require.NoError(t, file.Close())
}
