package mage

import (
	"fmt"
	"os"
	"strings"

	"github.com/magefile/mage/sh"
)

const (
	// Git user config for committing to external repos.
	gitUserName  = "luxury-yacht-automation"
	gitUserEmail = "automation@luxury-yacht.app"
)

// buildCloneURL builds a clone URL, using GH_TOKEN when available.
func buildCloneURL(repo string) string {
	// Prefer GH_TOKEN so CI can authenticate without relying on local credentials.
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		return fmt.Sprintf("https://github.com/%s.git", repo)
	}
	// Use x-access-token to avoid exposing the token in GitHub logs.
	return fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", token, repo)
}

// ensureGitUserConfig makes sure git user.name and user.email are set in the given repo.
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
