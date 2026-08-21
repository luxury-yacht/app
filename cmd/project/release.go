package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"text/template"
)

const gitHubRepositoryFlag = "--repo"

const releaseDryRunEnv = "RELEASE_DRY_RUN"

type releaseNotesData struct {
	Version          string
	BuildLabel       string
	Commit           string
	IsBeta           bool
	BetaExpiry       string
	RepoURL          string
	PendingNotesBody string
}

type releaseConfig struct {
	artifactsDir  string
	betaExpiry    string
	commit        string
	isBeta        bool
	packagePath   string
	releaseAssets []string
	releaseRepo   string
	version       string
}

type releaseCommandRunner func(string, ...string) error

func newReleaseConfig(facts projectFacts) releaseConfig {
	return releaseConfig{
		artifactsDir:  projectArtifactsDir,
		betaExpiry:    facts.betaExpiry,
		commit:        facts.commit,
		isBeta:        facts.isBeta,
		packagePath:   projectPackagePath,
		releaseAssets: projectReleaseAssets,
		releaseRepo:   projectReleaseRepo,
		version:       facts.version,
	}
}

func validateReleaseTag(configuredVersion, tag string) error {
	if tag == "" {
		return errors.New("release tag is required")
	}
	if tag != configuredVersion {
		return fmt.Errorf("release tag %q does not exactly match configured version %q", tag, configuredVersion)
	}
	return nil
}

func validateConfiguredReleaseTag() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read app version: %w", err)
	}
	return validateReleaseTag(metadata.Info.Version, os.Getenv("RELEASE_TAG"))
}

// Make sure the GitHub CLI is installed.
func checkGhCli() error {
	if _, err := exec.LookPath("gh"); err != nil {
		return fmt.Errorf("gh CLI is required to publish releases: %w", err)
	}
	return nil
}

// Check if the release already exists.
func releaseExists(repo, tag string) (bool, error) {
	fmt.Printf("\n🔎 Checking if release %s exists in repo %s\n", tag, repo)
	owner, name, valid := strings.Cut(repo, "/")
	if !valid || owner == "" || name == "" || strings.Contains(name, "/") {
		return false, fmt.Errorf("invalid GitHub repository %q", repo)
	}
	result, err := commandOutput(
		"gh", "api", "graphql",
		"-f", "query=query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){id}}}",
		"-F", "owner="+owner,
		"-F", "name="+name,
		"-F", "tag="+tag,
		"--jq", ".data.repository.release != null",
	)
	if err != nil {
		return false, fmt.Errorf("check whether release %s exists in repo %s: %w", tag, repo, err)
	}
	switch result {
	case "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, fmt.Errorf("unexpected GitHub release lookup result %q", result)
	}
}

func validateReleaseDoesNotAlreadyExist(exists bool, version string) error {
	if !exists {
		return nil
	}
	return fmt.Errorf(
		"release %s already exists; inspect it and remove any failed draft before retrying",
		version,
	)
}

// Scans for releaseable assets in the artifacts directory.
func findReleaseAssets(cfg releaseConfig) ([]string, error) {
	var assets []string
	assetPathsByName := make(map[string]string)

	err := filepath.WalkDir(cfg.artifactsDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		releaseable := d.Name() == updateManifestAssetName
		for _, extension := range cfg.releaseAssets {
			if strings.HasSuffix(d.Name(), extension) {
				releaseable = true
				break
			}
		}
		if releaseable {
			if previousPath, exists := assetPathsByName[d.Name()]; exists {
				return fmt.Errorf("duplicate release asset name %q: %s and %s", d.Name(), previousPath, path)
			}
			assetPathsByName[d.Name()] = path
			assets = append(assets, path)
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to collect release assets: %w", err)
	}

	sort.Strings(assets)
	fmt.Println("\n🗳️ Discovered releaseable assets:")
	for _, asset := range assets {
		fmt.Printf("- %s\n", asset)
	}

	return assets, nil
}

func selectUpdaterArtifact(inputs []string) (string, error) {
	if len(inputs) != 1 {
		return "", fmt.Errorf("expected exactly one updater artifact, got %d", len(inputs))
	}
	path := strings.TrimSpace(inputs[0])
	if strings.ContainsAny(path, "*?[") {
		return "", fmt.Errorf("updater artifact path must not contain glob syntax: %s", path)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", fmt.Errorf("stat updater artifact %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("updater artifact must be a regular file: %s", path)
	}
	return path, nil
}

func readPendingReleaseNotes(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read release notes %s: %w", path, err)
	}
	if strings.TrimSpace(string(raw)) == "" {
		return "", nil
	}
	return strings.TrimRight(string(raw), "\n"), nil
}

// Create the release notes and write them to a temporary file.
func writeReleaseNotes(cfg releaseConfig, runNumber string) (string, error) {
	notesTemplate := filepath.Join("docs", "release", "template.md")
	tmpl, err := template.ParseFiles(notesTemplate)
	if err != nil {
		return "", fmt.Errorf("failed to parse release notes template: %w", err)
	}

	tmpFile, err := os.CreateTemp("", "release-notes-*.md")
	if err != nil {
		return "", fmt.Errorf("failed to create notes file: %w", err)
	}
	defer tmpFile.Close()

	buildLabel := "Local Run"
	if runNumber != "local" {
		buildLabel = fmt.Sprintf("#%s", runNumber)
	}

	repoURL := cfg.packagePath
	if !strings.HasPrefix(repoURL, "http") {
		repoURL = "https://" + repoURL
	}

	pendingNotesBody, err := readPendingReleaseNotes(filepath.Join("docs", "release", "pending.md"))
	if err != nil {
		return "", err
	}

	data := releaseNotesData{
		Version:          cfg.version,
		BuildLabel:       buildLabel,
		Commit:           cfg.commit,
		IsBeta:           cfg.isBeta,
		BetaExpiry:       cfg.betaExpiry,
		RepoURL:          repoURL,
		PendingNotesBody: pendingNotesBody,
	}

	if err := tmpl.Execute(tmpFile, data); err != nil {
		return "", fmt.Errorf("failed to render release notes: %w", err)
	}

	return tmpFile.Name(), nil
}

// Create the release as a draft so none of its assets are discoverable by the
// updater until every upload has succeeded, then publish it in one final edit.
func createRelease(
	cfg releaseConfig,
	notesFile string,
	assets []string,
	dryRun bool,
	run releaseCommandRunner,
) error {
	args := []string{
		"release", "create", cfg.version,
		"--title", cfg.version,
		"--notes-file", notesFile,
		gitHubRepositoryFlag, cfg.releaseRepo,
		"--draft",
	}
	if cfg.isBeta {
		args = append(args, "--prerelease")
	}
	args = append(args, assets...)
	if dryRun {
		fmt.Printf(
			"\n🧪 Dry run validated release %s with %d assets; skipping GitHub release creation.\n",
			cfg.version,
			len(assets),
		)
		return nil
	}

	fmt.Printf("\n🎯 Creating release %s\n", cfg.version)

	if err := run("gh", args...); err != nil {
		return fmt.Errorf("failed to create draft release %s: %w", cfg.version, err)
	}

	fmt.Printf("\n🚀 Publishing release %s\n", cfg.version)
	if err := run(
		"gh",
		"release", "edit", cfg.version,
		"--draft=false",
		gitHubRepositoryFlag, cfg.releaseRepo,
	); err != nil {
		return fmt.Errorf("failed to publish draft release %s: %w", cfg.version, err)
	}

	return nil
}

func parseReleaseDryRun(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, fmt.Errorf("%s must be true or false, got %q", releaseDryRunEnv, value)
	}
}

// publishRelease validates the complete release input and optionally publishes it.
func publishRelease(cfg releaseConfig, dryRun bool) error {
	// Find release assets.
	assets, err := findReleaseAssets(cfg)
	if err != nil {
		return err
	}
	if len(assets) == 0 {
		return fmt.Errorf("no release assets found in %s", cfg.artifactsDir)
	}

	// Get the GitHub Actions run number, or use "local" if not set.
	runNumber, _ := os.LookupEnv("GITHUB_RUN_NUMBER")
	if runNumber == "" {
		runNumber = "local"
	}

	// Write release notes to a temporary file.
	notesFile, err := writeReleaseNotes(cfg, runNumber)
	if err != nil {
		return err
	}
	defer os.Remove(notesFile)
	if dryRun {
		return createRelease(cfg, notesFile, assets, true, runCommand)
	}

	if err := checkGhCli(); err != nil {
		return err
	}
	// Never overwrite or publish an existing release. A previous failed run may
	// have left a partial draft that requires explicit operator inspection.
	release, err := releaseExists(cfg.releaseRepo, cfg.version)
	if err != nil {
		return err
	}
	if err := validateReleaseDoesNotAlreadyExist(release, cfg.version); err != nil {
		return err
	}
	fmt.Println("- Release does not exist. Proceeding.")

	// Create the release.
	if err := createRelease(cfg, notesFile, assets, false, runCommand); err != nil {
		return err
	}

	return nil
}
