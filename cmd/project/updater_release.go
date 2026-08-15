package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/internal/updateconformance"
	"github.com/luxury-yacht/app/internal/updateidentity"
)

const updateManifestAssetName = "updater.json"

type updaterTarget struct {
	Platform     string
	Architecture string
}

var orderedUpdaterTargets = []updaterTarget{
	{Platform: "darwin", Architecture: "arm64"},
	{Platform: "darwin", Architecture: "amd64"},
	{Platform: "windows", Architecture: "amd64"},
	{Platform: "windows", Architecture: "arm64"},
	{Platform: "linux", Architecture: "amd64"},
	{Platform: "linux", Architecture: "arm64"},
}

func parseUpdaterTargets(raw string) ([]updaterTarget, error) {
	items := strings.Split(strings.TrimSpace(raw), ",")
	if len(items) == 1 && strings.TrimSpace(items[0]) == "" {
		return nil, fmt.Errorf("updater targets are required")
	}
	known := make(map[updaterTarget]int, len(orderedUpdaterTargets))
	for index, target := range orderedUpdaterTargets {
		known[target] = index
	}
	seen := make(map[updaterTarget]struct{}, len(items))
	targets := make([]updaterTarget, 0, len(items))
	for _, item := range items {
		parts := strings.Split(strings.TrimSpace(item), "/")
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid updater target %q; require platform/architecture", item)
		}
		target := updaterTarget{
			Platform:     strings.ToLower(strings.TrimSpace(parts[0])),
			Architecture: strings.ToLower(strings.TrimSpace(parts[1])),
		}
		rank, supported := known[target]
		if !supported {
			return nil, fmt.Errorf("unsupported updater target %s/%s", target.Platform, target.Architecture)
		}
		if _, duplicate := seen[target]; duplicate {
			return nil, fmt.Errorf("duplicate updater target %s/%s", target.Platform, target.Architecture)
		}
		seen[target] = struct{}{}
		targets = append(targets, target)
		_ = rank
	}
	sort.Slice(targets, func(left, right int) bool {
		return known[targets[left]] < known[targets[right]]
	})
	return targets, nil
}

func collectUpdaterArtifactsForTargets(
	metadata projectMetadata,
	root string,
	targets []updaterTarget,
) ([]string, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("updater artifact root is required")
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("at least one updater target is required")
	}
	ordered, err := orderAndValidateUpdaterTargets(targets)
	if err != nil {
		return nil, err
	}
	expected := make(map[string]updaterTarget, len(ordered))
	for _, target := range ordered {
		name, nameErr := updaterArtifactName(metadata, target.Platform, target.Architecture)
		if nameErr != nil {
			return nil, nameErr
		}
		expected[name] = target
	}
	found := make(map[string]string, len(expected))
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if _, required := expected[entry.Name()]; !required {
			return nil
		}
		info, infoErr := os.Lstat(path)
		if infoErr != nil {
			return infoErr
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return fmt.Errorf("updater artifact must be a regular non-symlink file: %s", path)
		}
		if previous, duplicate := found[entry.Name()]; duplicate {
			return fmt.Errorf("duplicate updater artifact %q: %s and %s", entry.Name(), previous, path)
		}
		found[entry.Name()] = path
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("collect updater artifacts: %w", err)
	}
	artifacts := make([]string, 0, len(ordered))
	for _, target := range ordered {
		name, _ := updaterArtifactName(metadata, target.Platform, target.Architecture)
		path := found[name]
		if path == "" {
			return nil, fmt.Errorf("missing updater artifact %q for %s/%s", name, target.Platform, target.Architecture)
		}
		artifacts = append(artifacts, path)
	}
	return artifacts, nil
}

func orderAndValidateUpdaterTargets(targets []updaterTarget) ([]updaterTarget, error) {
	known := make(map[updaterTarget]int, len(orderedUpdaterTargets))
	for index, target := range orderedUpdaterTargets {
		known[target] = index
	}
	ordered := append([]updaterTarget(nil), targets...)
	seen := make(map[updaterTarget]struct{}, len(ordered))
	for _, target := range ordered {
		if _, supported := known[target]; !supported {
			return nil, fmt.Errorf("unsupported updater target %s/%s", target.Platform, target.Architecture)
		}
		if _, duplicate := seen[target]; duplicate {
			return nil, fmt.Errorf("duplicate updater target %s/%s", target.Platform, target.Architecture)
		}
		seen[target] = struct{}{}
	}
	sort.Slice(ordered, func(left, right int) bool {
		return known[ordered[left]] < known[ordered[right]]
	})
	return ordered, nil
}

type updaterManifestConfig struct {
	Metadata       projectMetadata
	ArtifactsRoot  string
	Targets        []updaterTarget
	PrivateKeyPath string
	PublicKey      string
	NotesFile      string
	OutputPath     string
}

type updaterCommandRunner func(string, ...string) error

func prepareUpdaterManifest(config updaterManifestConfig, run updaterCommandRunner) error {
	release, err := updateidentity.ParseReleaseVersion(config.Metadata.Info.Version)
	if err != nil {
		return fmt.Errorf("parse updater release version: %w", err)
	}
	channel := string(release.Channel)
	if strings.TrimSpace(config.PrivateKeyPath) == "" {
		return fmt.Errorf("updater private key path is required")
	}
	if strings.TrimSpace(config.PublicKey) == "" {
		return fmt.Errorf("updater public key is required")
	}
	if strings.TrimSpace(config.NotesFile) == "" {
		return fmt.Errorf("updater release notes file is required")
	}
	if strings.TrimSpace(config.OutputPath) == "" {
		return fmt.Errorf("updater manifest output path is required")
	}
	for label, path := range map[string]string{
		"private key":   config.PrivateKeyPath,
		"release notes": config.NotesFile,
	} {
		info, statErr := os.Lstat(path)
		if statErr != nil {
			return fmt.Errorf("inspect updater %s: %w", label, statErr)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return fmt.Errorf("updater %s must be a regular non-symlink file: %s", label, path)
		}
	}
	artifacts, err := collectUpdaterArtifactsForTargets(config.Metadata, config.ArtifactsRoot, config.Targets)
	if err != nil {
		return err
	}
	outputDirectory := filepath.Dir(config.OutputPath)
	if err := os.MkdirAll(outputDirectory, 0o755); err != nil {
		return fmt.Errorf("create updater manifest output directory: %w", err)
	}
	stagingDirectory := filepath.Join(outputDirectory, ".updater-manifest-"+channel)
	if err := os.Mkdir(stagingDirectory, 0o700); err != nil {
		return fmt.Errorf("create updater manifest staging directory: %w", err)
	}
	defer os.RemoveAll(stagingDirectory)
	stagedArtifacts := make([]string, 0, len(artifacts))
	for _, source := range artifacts {
		target := filepath.Join(stagingDirectory, filepath.Base(source))
		if err := copyUpdaterArtifact(source, target); err != nil {
			return err
		}
		stagedArtifacts = append(stagedArtifacts, target)
	}

	name := strings.TrimSpace(config.Metadata.Info.ProductName)
	if name == "" {
		return fmt.Errorf("updater release product name is required")
	}
	urlPrefix := fmt.Sprintf(
		"https://github.com/%s/releases/download/%s",
		projectReleaseRepo,
		strings.TrimSpace(config.Metadata.Info.Version),
	)
	manifestArgs := []string{
		"updater", "manifest",
		"-version", release.Version,
		"-channel", channel,
		"-name", name + " " + release.Version,
		"-notes-file", config.NotesFile,
		"-key", config.PrivateKeyPath,
		"-url-prefix", urlPrefix,
		"-output", config.OutputPath,
	}
	manifestArgs = append(manifestArgs, stagedArtifacts...)
	if err := run("wails3", manifestArgs...); err != nil {
		return fmt.Errorf("generate updater manifest: %w", err)
	}
	manifestInfo, err := os.Lstat(config.OutputPath)
	if err != nil {
		return fmt.Errorf("inspect generated updater manifest: %w", err)
	}
	if manifestInfo.Mode()&os.ModeSymlink != 0 || !manifestInfo.Mode().IsRegular() {
		return fmt.Errorf("generated updater manifest must be a regular non-symlink file: %s", config.OutputPath)
	}
	if err := run(
		"wails3", "updater", "verify",
		"-manifest", config.OutputPath,
		"-publickey", config.PublicKey,
		"-dir", stagingDirectory,
	); err != nil {
		return fmt.Errorf("verify updater manifest: %w", err)
	}
	return nil
}

func copyUpdaterArtifact(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open updater artifact %s: %w", source, err)
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return fmt.Errorf("inspect updater artifact %s: %w", source, err)
	}
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return fmt.Errorf("create staged updater artifact %s: %w", target, err)
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return fmt.Errorf("copy updater artifact %s: %w", source, err)
	}
	if err := output.Close(); err != nil {
		return fmt.Errorf("close staged updater artifact %s: %w", target, err)
	}
	return nil
}

func validateMacOSUpdaterArchive(
	ctx context.Context,
	artifactPath, version, architecture string,
	validateBundle func(string) error,
) error {
	return updateconformance.ValidateMacOSArchive(
		ctx,
		artifactPath,
		version,
		architecture,
		validateBundle,
	)
}

func validateConfiguredMacOSUpdaterArchive(
	ctx context.Context,
	metadata projectMetadata,
	artifactPath, architecture string,
	run updaterCommandRunner,
) error {
	architecture = strings.ToLower(strings.TrimSpace(architecture))
	artifactPath = strings.TrimSpace(artifactPath)
	expected, err := updaterArtifactName(metadata, "darwin", architecture)
	if err != nil {
		return err
	}
	if filepath.Base(artifactPath) != expected {
		return fmt.Errorf("macOS updater artifact name %q does not match expected %q", filepath.Base(artifactPath), expected)
	}
	release, err := updateidentity.ParseReleaseVersion(metadata.Info.Version)
	if err != nil {
		return err
	}
	return validateMacOSUpdaterArchive(
		ctx, artifactPath, release.Version, architecture,
		func(bundle string) error {
			if err := run("codesign", "--verify", "--deep", "--strict", bundle); err != nil {
				return err
			}
			if err := run("spctl", "--assess", "--type", "execute", bundle); err != nil {
				return err
			}
			return run("xcrun", "stapler", "validate", bundle)
		},
	)
}

func prepareReleaseUpdaterManifest(
	metadata projectMetadata,
	facts projectFacts,
	getenv func(string) string,
	run updaterCommandRunner,
) error {
	if _, err := updateidentity.ParseReleaseVersion(metadata.Info.Version); err != nil {
		return fmt.Errorf("parse updater release version: %w", err)
	}
	if strings.TrimSpace(facts.version) != strings.TrimSpace(metadata.Info.Version) {
		return fmt.Errorf(
			"release facts version %q does not match metadata version %q",
			facts.version,
			metadata.Info.Version,
		)
	}
	targets, err := parseUpdaterTargets(getenv("UPDATER_TARGETS"))
	if err != nil {
		return err
	}
	artifactsRoot := strings.TrimSpace(getenv("UPDATER_ARTIFACTS_DIR"))
	if artifactsRoot == "" {
		return fmt.Errorf("updater artifact root is required")
	}
	runNumber := strings.TrimSpace(getenv("GITHUB_RUN_NUMBER"))
	if runNumber == "" {
		runNumber = "local"
	}
	notesFile, err := writeReleaseNotes(newReleaseConfig(facts), runNumber)
	if err != nil {
		return err
	}
	defer os.Remove(notesFile)
	if err := prepareUpdaterManifest(updaterManifestConfig{
		Metadata:       metadata,
		ArtifactsRoot:  artifactsRoot,
		Targets:        targets,
		PrivateKeyPath: getenv("UPDATER_PRIVATE_KEY_PATH"),
		PublicKey:      getenv("UPDATER_PUBLIC_KEY"),
		NotesFile:      notesFile,
		OutputPath:     filepath.Join(artifactsRoot, updateManifestAssetName),
	}, run); err != nil {
		return fmt.Errorf("prepare updater release manifest: %w", err)
	}
	return nil
}
