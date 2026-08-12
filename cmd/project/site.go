package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	// Website repo info.
	siteRepo   = "luxury-yacht/site"
	siteBranch = "main"
	// Path to site.json within the site repo.
	siteDataFile = "src/_data/site.json"
	gitUserName  = "luxury-yacht-automation"
	gitUserEmail = "automation@luxury-yacht.app"
)

// publishSiteVersion updates the version in the website's site.json.
func publishSiteVersion(version string) error {
	fmt.Printf("\n⚙️ Updating website version to %s...\n", version)

	// Clone the site repo.
	fmt.Printf("\n⚙️ Cloning %s...\n", siteRepo)
	tmpDir, err := cloneSiteRepo()
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	// Read and update site.json.
	dataPath := filepath.Join(tmpDir, siteDataFile)
	if err := updateSiteVersion(dataPath, version); err != nil {
		return err
	}

	// Check if there are any changes to commit.
	status, err := commandOutput("git", "-C", tmpDir, "status", "--porcelain")
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
	if err := runCommand("git", "-C", tmpDir, "add", siteDataFile); err != nil {
		return fmt.Errorf("failed to stage site version update: %w", err)
	}
	if err := runCommand("git", "-C", tmpDir, "commit", "-m", fmt.Sprintf("Update version to %s", version)); err != nil {
		return fmt.Errorf("failed to commit site version update: %w", err)
	}

	// Push the changes.
	if err := runCommand("git", "-C", tmpDir, "push", "origin", siteBranch); err != nil {
		return fmt.Errorf("failed to push site repo updates: %w", err)
	}

	fmt.Printf("\n✅ Website version updated to %s.\n", version)
	return nil
}

// cloneSiteRepo clones the site repository into a temporary directory.
func cloneSiteRepo() (string, error) {
	tmpDir, err := os.MkdirTemp("", "luxury-yacht-site-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	cloneURL := buildCloneURL(siteRepo)
	if err := runCommand("git", "clone", "--depth", "1", "--branch", siteBranch, cloneURL, tmpDir); err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("failed to clone site repo: %w", err)
	}

	return tmpDir, nil
}

// buildCloneURL builds a clone URL, using GH_TOKEN when available.
func buildCloneURL(repo string) string {
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		return fmt.Sprintf("https://github.com/%s.git", repo)
	}
	return fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repo)
}

func ensureGitUserConfig(repoDir string) error {
	userName, err := commandOutput("git", "-C", repoDir, "config", "user.name")
	if err != nil || strings.TrimSpace(userName) == "" {
		if err := runCommand("git", "-C", repoDir, "config", "user.name", gitUserName); err != nil {
			return fmt.Errorf("failed to set git user.name: %w", err)
		}
		userName = gitUserName
	}
	fmt.Printf("git user.name: %s\n", userName)

	userEmail, err := commandOutput("git", "-C", repoDir, "config", "user.email")
	if err != nil || strings.TrimSpace(userEmail) == "" {
		if err := runCommand("git", "-C", repoDir, "config", "user.email", gitUserEmail); err != nil {
			return fmt.Errorf("failed to set git user.email: %w", err)
		}
		userEmail = gitUserEmail
	}
	fmt.Printf("git user.email: %s\n", userEmail)
	return nil
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
