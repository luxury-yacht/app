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

// Check for releases repo token.
func getReleasesRepoToken() (string, error) {
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		return "", fmt.Errorf("GH_TOKEN is required to create releases")
	}
	return token, nil
}

// Push the tag to the releases repository.
func pushTagToReleaseRepo(cfg BuildConfig, runNumber string) error {
	token, err := getReleasesRepoToken()
	if err != nil {
		return err
	}

	// Create a temporary directory for cloning the releases repo.
	tempDir, err := os.MkdirTemp("", "luxury-yacht-releases-*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	fmt.Printf("\n📥 Cloning %s\n", cfg.ReleaseRepo)
	cloneURL := fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, cfg.ReleaseRepo)
	sh.RunV("git", "clone", "--depth", "1", cloneURL, tempDir)

	// Configure git user
	fmt.Printf("\n⚙️ Configuring git user\n")
	sh.RunV("git", "--git-dir="+tempDir+"/.git", "config", "user.name", "Luxury Yacht Automation")
	sh.RunV("git", "--git-dir="+tempDir+"/.git", "config", "user.email", "donotreply@luxury-yacht.app")

	runString := ""
	if runNumber == "" {
		runString = "(Local Run)"
	} else {
		runString = fmt.Sprintf("(Build #%s)", runNumber)
	}
	tagMessage := fmt.Sprintf("%s %s %s", cfg.AppLongName, cfg.Version, runString)

	fmt.Printf("\n🏷️ Updating tag %s in %s\n", cfg.Version, cfg.ReleaseRepo)
	sh.RunV("git", "--git-dir="+tempDir+"/.git", "tag", "-fa", cfg.Version, "-m", tagMessage)

	// Push the tag to the remote repository.
	fmt.Printf("\n📤 Pushing tag %s to %s\n", cfg.Version, cfg.ReleaseRepo)
	sh.RunV("git", "--git-dir="+tempDir+"/.git", "push", "origin", cfg.Version, "--force")

	return nil
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

	runNumber, _ := os.LookupEnv("GITHUB_RUN_NUMBER")
	if runNumber == "" {
		runNumber = "local"
	}

	if err := pushTagToReleaseRepo(cfg, runNumber); err != nil {
		return err
	}

	notesFile, err := writeReleaseNotes(cfg, runNumber)
	if err != nil {
		return err
	}
	defer os.Remove(notesFile)

	if err := createRelease(cfg, notesFile, assets); err != nil {
		return err
	}

	return nil
}
