package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/internal/updateidentity"
)

func windowsDisplayVersion(version string) (string, error) {
	release, err := updateidentity.ParseReleaseVersion(version)
	if err != nil {
		return "", fmt.Errorf("validate Windows Installed Apps version: %w", err)
	}
	return release.Tag(), nil
}
