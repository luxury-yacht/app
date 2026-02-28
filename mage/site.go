package mage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/magefile/mage/sh"
)

const (
	// Website repo info.
	siteRepo   = "luxury-yacht/site"
	siteBranch = "main"
	// Path to site.json within the site repo.
	siteDataFile = "src/_data/site.json"
)

// PublishSiteVersion updates the version in the website's site.json.
func PublishSiteVersion(cfg BuildConfig) error {
	fmt.Printf("\n⚙️ Updating website version to %s...\n", cfg.Version)

	// Clone the site repo.
	fmt.Printf("\n⚙️ Cloning %s...\n", siteRepo)
	tmpDir, err := cloneSiteRepo()
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	// Read and update site.json.
	dataPath := filepath.Join(tmpDir, siteDataFile)
	if err := updateSiteVersion(dataPath, cfg.Version); err != nil {
		return err
	}

	// Check if there are any changes to commit.
	status, err := sh.Output("git", "-C", tmpDir, "status", "--porcelain")
	if err != nil {
		return fmt.Errorf("failed to check site repo status: %w", err)
	}
	if status == "" {
		fmt.Println("\n✅ Website version already up to date.")
		return nil
	}

	fmt.Println("\n⚙️ Website version needs to be updated.")

	// Ensure git user config is set.
	if err := ensureGitUserConfig(tmpDir); err != nil {
		return err
	}

	// Stage and commit the changes.
	if err := sh.Run("git", "-C", tmpDir, "add", siteDataFile); err != nil {
		return fmt.Errorf("failed to stage site version update: %w", err)
	}
	if err := sh.Run("git", "-C", tmpDir, "commit", "-m", fmt.Sprintf("Update version to %s", cfg.Version)); err != nil {
		return fmt.Errorf("failed to commit site version update: %w", err)
	}

	// Push the changes.
	if err := sh.Run("git", "-C", tmpDir, "push", "origin", siteBranch); err != nil {
		return fmt.Errorf("failed to push site repo updates: %w", err)
	}

	fmt.Printf("\n✅ Website version updated to %s.\n", cfg.Version)
	return nil
}

// cloneSiteRepo clones the site repository into a temporary directory.
func cloneSiteRepo() (string, error) {
	tmpDir, err := os.MkdirTemp("", "luxury-yacht-site-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	cloneURL := buildCloneURL(siteRepo)
	if err := sh.Run("git", "clone", "--depth", "1", "--branch", siteBranch, cloneURL, tmpDir); err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("failed to clone site repo: %w", err)
	}

	return tmpDir, nil
}

// updateSiteVersion reads site.json, updates the version field, and writes it back.
func updateSiteVersion(path, version string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", path, err)
	}

	// Decode into an ordered map to preserve existing fields.
	var siteData map[string]interface{}
	if err := json.Unmarshal(data, &siteData); err != nil {
		return fmt.Errorf("failed to parse %s: %w", path, err)
	}

	siteData["version"] = version

	updated, err := json.MarshalIndent(siteData, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal updated site data: %w", err)
	}

	// Append a trailing newline to match the original file format.
	updated = append(updated, '\n')

	if err := os.WriteFile(path, updated, 0o644); err != nil {
		return fmt.Errorf("failed to write %s: %w", path, err)
	}

	return nil
}
