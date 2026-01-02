package mage

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/magefile/mage/sh"
)

const (
	// Git user config for committing to the tap repo.
	gitUserName  = "luxury-yacht-automation"
	gitUserEmail = "automation@luxury-yacht.app"
	// Homebrew tap repo info.
	tapRepo   = "luxury-yacht/homebrew-tap"
	tapBranch = "main"
	// Homebrew template to be updated.
	caskTemplate = "mage/homebrew/luxury-yacht.rb"
)

// Get the SHA256 checksum for a specific release asset via the GitHub API.
// This is a public repo so no authentication is needed.
func getShaForAsset(cfg BuildConfig, assetName string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/tags/%s", cfg.ReleaseRepo, cfg.Version)

	// Create the HTTP request.
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("could not create an http request: %w", err)
	}

	// Set required headers.
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	// Perform the HTTP request.
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not perform http request: %w", err)
	}
	defer resp.Body.Close()

	// Check for non-200 status codes.
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github api error: %d", resp.StatusCode)
	}

	// Parse the JSON response to find the asset with the specified name.
	var result struct {
		Assets []struct {
			Name   string `json:"name"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}

	// Read the response body.
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("could not decode http response body: %w", err)
	}

	// Search for the asset by name and return its checksum.
	for _, asset := range result.Assets {
		if asset.Name == assetName {
			// The digest field is in the format "sha256:actualchecksum"
			parts := strings.SplitN(asset.Digest, ":", 2)
			if len(parts) == 2 && parts[0] == "sha256" {
				return parts[1], nil
			}
		}
	}

	// Asset not found so return an error.
	return "", fmt.Errorf("checksum for asset %s not found in release %s", assetName, cfg.Version)
}

// Return the updated Homebrew cask template.
func updateHomebrewTemplate(version, arm64Sha, amd64Sha string) ([]byte, error) {
	template, err := os.ReadFile(caskTemplate)
	if err != nil {
		return nil, fmt.Errorf("failed to read Homebrew cask template at %s: %w", caskTemplate, err)
	}

	// Replace placeholders in the template.
	r := strings.NewReplacer(
		"${VERSION}", version,
		"${ARM64_SHA256}", arm64Sha,
		"${AMD64_SHA256}", amd64Sha,
	)
	cask := r.Replace(string(template))

	// Make sure all placeholders were replaced.
	// TODO: Change this to a simple regex that looks for ${*} patterns instead of hardcoding each
	if strings.Contains(cask, "${VERSION}") ||
		strings.Contains(cask, "${ARM64_SHA256}") ||
		strings.Contains(cask, "${AMD64_SHA256}") {
		return nil, fmt.Errorf("homebrew cask template still contains placeholders after replacement")
	}
	return []byte(cask), nil
}

// buildTapCloneURL builds a clone URL, using GH_TOKEN when available.
func buildTapCloneURL(repo string) string {
	// Prefer GH_TOKEN so CI can authenticate without relying on local credentials.
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		return fmt.Sprintf("https://github.com/%s.git", repo)
	}
	// Use x-access-token to avoid exposing the token in GitHub logs.
	return fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repo)
}

// Clone the homebrew tap repo
func cloneTapRepo() (string, error) {
	tmpDir, err := os.MkdirTemp("", "luxury-yacht-homebrew-tap-*")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	cloneURL := buildTapCloneURL(tapRepo)
	if err := sh.Run("git", "clone", "--depth", "1", "--branch", tapBranch, cloneURL, tmpDir); err != nil {
		return "", fmt.Errorf("failed to clone tap repo: %w", err)
	}

	return tmpDir, nil
}

// Make sure the git user.name and user.email are set in the tap repo
func ensureGitUserConfig(repoDir string) error {
	// Check if user.name is set.
	userName, err := sh.Output("git", "-C", repoDir, "config", "user.name")
	if err != nil || strings.TrimSpace(userName) == "" {
		if err := sh.Run("git", "-C", repoDir, "config", "user.name", gitUserName); err != nil {
			return fmt.Errorf("failed to set git user.name: %w", err)
		}
	}
	fmt.Printf("git user.name: %s\n", userName)

	// Check if user.email is set.
	userEmail, err := sh.Output("git", "-C", repoDir, "config", "user.email")
	if err != nil || strings.TrimSpace(userEmail) == "" {
		if err := sh.Run("git", "-C", repoDir, "config", "user.email", gitUserEmail); err != nil {
			return fmt.Errorf("failed to set git user.email: %w", err)
		}
	}
	fmt.Printf("git user.email: %s\n", userEmail)

	return nil
}

// Publish the Homebrew formula.
func PublishHomebrew(cfg BuildConfig) error {
	fmt.Printf("\n⚙️ Publishing the Homebrew formula for version %s...\n", cfg.Version)

	// Get the checksum for the arm64 DMG.
	arm64Dmg := fmt.Sprintf("luxury-yacht-%s-macos-arm64.dmg", cfg.Version)
	arm64Sha, err := getShaForAsset(cfg, arm64Dmg)
	if err != nil {
		return err
	}

	// Get the checksum for the amd64 DMG.
	amd64Dmg := fmt.Sprintf("luxury-yacht-%s-macos-amd64.dmg", cfg.Version)
	amd64Sha, err := getShaForAsset(cfg, amd64Dmg)
	if err != nil {
		return err
	}

	// Update the cask template with the new version and checksums.
	cask, err := updateHomebrewTemplate(cfg.Version, arm64Sha, amd64Sha)
	if err != nil {
		return err
	}

	// Clone the tap repo.
	fmt.Printf("\n⚙️ Cloning %s...\n", tapRepo)
	tmpDir, err := cloneTapRepo()
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	// Write the updated cask file.
	caskPath := filepath.Join(tmpDir, "casks", "luxury-yacht.rb")
	if err := os.WriteFile(caskPath, cask, 0o644); err != nil {
		return fmt.Errorf("failed to update cask at %s: %w", caskPath, err)
	}

	// Check if there are any changes to commit.
	status, err := sh.Output("git", "-C", tmpDir, "status", "--porcelain")
	if err != nil {
		return fmt.Errorf("failed to check tap repo status: %w", err)
	}
	if strings.TrimSpace(status) == "" {
		fmt.Println("\n✅ Homebrew cask already up to date.")
		return nil
	} else {
		fmt.Println("\n⚙️ Homebrew cask needs to be updated.")
	}

	// Ensure git user config is set.
	if err := ensureGitUserConfig(tmpDir); err != nil {
		return err
	}

	// Stage and commit the changes.
	if err := sh.Run("git", "-C", tmpDir, "add", "casks/luxury-yacht.rb"); err != nil {
		return fmt.Errorf("failed to stage cask update: %w", err)
	}
	if err := sh.Run("git", "-C", tmpDir, "commit", "-m", fmt.Sprintf("Update luxury-yacht cask to %s", cfg.Version)); err != nil {
		return fmt.Errorf("failed to commit cask update: %w", err)
	}

	// Push the changes.
	if err := sh.Run("git", "-C", tmpDir, "push", "origin", tapBranch); err != nil {
		return fmt.Errorf("failed to push tap repo updates: %w", err)
	}

	return nil
}
