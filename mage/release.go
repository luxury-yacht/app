package mage

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"text/template"

	"github.com/magefile/mage/sh"
)

type releaseNotesData struct {
	Version    string
	BuildLabel string
	Commit     string
	IsBeta     bool
	BetaExpiry string
	RepoURL    string
}

// Make sure the GitHub CLI is installed.
func checkGhCli() error {
	if _, err := exec.LookPath("gh"); err != nil {
		return fmt.Errorf("gh CLI is required to publish releases: %w", err)
	}
	return nil
}

// Check if the release already exists.
func releaseExists(repo string, tag string) (bool, error) {
	fmt.Printf("\n🔎 Checking if release %s exists in repo %s\n", tag, repo)
	if sh.Run("gh", "release", "view", tag, "--repo", repo) != nil {
		return false, nil
	}
	return true, nil
}

// Scans for releaseable assets in the artifacts directory.
func findReleaseAssets(cfg BuildConfig) ([]string, error) {
	var assets []string

	err := filepath.WalkDir("./artifacts", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		// Check if the file has a valid release asset extension
		for _, ext := range cfg.ReleaseAssets {
			if strings.HasSuffix(d.Name(), ext) {
				assets = append(assets, path)
				break
			}
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

// Create the release notes and write them to a temporary file.
func writeReleaseNotes(cfg BuildConfig, runNumber string) (string, error) {
	notesTemplate := filepath.Join("mage", "release", "release-notes.md")
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

	repoURL := cfg.PackagePath
	if !strings.HasPrefix(repoURL, "http") {
		repoURL = "https://" + repoURL
	}

	data := releaseNotesData{
		Version:    cfg.Version,
		BuildLabel: buildLabel,
		Commit:     cfg.Commit,
		IsBeta:     cfg.IsBeta,
		BetaExpiry: cfg.BetaExpiry,
		RepoURL:    repoURL,
	}

	if err := tmpl.Execute(tmpFile, data); err != nil {
		return "", fmt.Errorf("failed to render release notes: %w", err)
	}

	return tmpFile.Name(), nil
}

// Create the release.
func createRelease(cfg BuildConfig, notesFile string, assets []string) error {
	args := []string{
		"release", "create", cfg.Version,
		"--title", cfg.Version,
		"--notes-file", notesFile,
		"--repo", cfg.ReleaseRepo,
	}
	if cfg.IsBeta {
		args = append(args, "--prerelease")
	}
	args = append(args, assets...)

	fmt.Printf("\n🎯 Creating release %s\n", cfg.Version)

	if err := sh.RunV("gh", args...); err != nil {
		return fmt.Errorf("failed to create release %s: %w", cfg.Version, err)
	}

	return nil
}

// Publish the release to GitHub.
func PublishRelease(cfg BuildConfig) error {
	if err := checkGhCli(); err != nil {
		return err
	}
	// Check if the release already exists. If it does, bail out.
	release, err := releaseExists(cfg.ReleaseRepo, cfg.Version)
	if err != nil {
		return err
	}
	if release {
		fmt.Println("- Release already exists. Exiting.")
		return nil
	}
	fmt.Println("- Release does not exist. Proceeding.")

	// Find release assets.
	assets, err := findReleaseAssets(cfg)
	if err != nil {
		return err
	}
	if len(assets) == 0 {
		return fmt.Errorf("no release assets found in %s", cfg.ArtifactsDir)
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

	// Create the release.
	if err := createRelease(cfg, notesFile, assets); err != nil {
		return err
	}

	return nil
}
