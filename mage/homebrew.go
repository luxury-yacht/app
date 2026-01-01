package mage

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/magefile/mage/sh"
)

const (
	caskTemplate = "mage/homebrew/luxury-yacht.rb"
	tapRepo      = "luxury-yacht/homebrew-tap"
	tapBranch    = "main"
)

// Get the SHA256 checksum of a file.
func getFileSha256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open %s: %w", path, err)
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", fmt.Errorf("failed to read %s: %w", path, err)
	}

	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

// Return the updated Homebrew cask template.
func updateHomebrewTemplate(version, arm64Sha, amd64Sha string) ([]byte, error) {
	template, err := os.ReadFile(caskTemplate)
	if err != nil {
		return nil, fmt.Errorf("failed to read Homebrew cask template at %s: %w", caskTemplate, err)
	}

	cask := string(template)
	cask = strings.ReplaceAll(cask, "${VERSION}", version)
	cask = strings.ReplaceAll(cask, "${ARM64_SHA256}", arm64Sha)
	cask = strings.ReplaceAll(cask, "${AMD64_SHA256}", amd64Sha)

	// Make sure all placeholders were replaced.
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

// Publish the Homebrew formula.
func PublishHomebrew(cfg BuildConfig) error {
	fmt.Printf("\n⚙️ Publishing the Homebrew formula for version %s...\n", cfg.Version)

	// Calculate SHA256 checksums for the DMG files.
	arm64Dmg := fmt.Sprintf("luxury-yacht-%s-macos-arm64.dmg", cfg.Version)
	arm64Path := fmt.Sprintf("%s/%s", cfg.ArtifactsDir, arm64Dmg)
	arm64Sha, err := getFileSha256(arm64Path)
	if err != nil {
		return err
	}
	amd64Dmg := fmt.Sprintf("luxury-yacht-%s-macos-amd64.dmg", cfg.Version)
	amd64Path := fmt.Sprintf("%s/%s", cfg.ArtifactsDir, amd64Dmg)
	amd64Sha, err := getFileSha256(amd64Path)
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
	if err := os.WriteFile(caskPath, []byte(cask), 0o644); err != nil {
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

	// Make sure git user.name is set.
	userName, err := sh.Output("git", "-C", tmpDir, "config", "user.name")
	if err != nil || strings.TrimSpace(userName) == "" {
		if err := sh.Run("git", "-C", tmpDir, "config", "user.name", "luxury-yacht-automation"); err != nil {
			return fmt.Errorf("failed to set git user.name: %w", err)
		}
	}
	fmt.Printf("git user.name: %s\n", userName)

	// Make sure git user.email is set.
	userEmail, err := sh.Output("git", "-C", tmpDir, "config", "user.email")
	if err != nil || strings.TrimSpace(userEmail) == "" {
		if err := sh.Run("git", "-C", tmpDir, "config", "user.email", "automation@luxury-yacht.app"); err != nil {
			return fmt.Errorf("failed to set git user.email: %w", err)
		}
	}
	fmt.Printf("git user.email: %s\n", userEmail)

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
