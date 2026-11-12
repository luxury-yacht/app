package main

import (
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// npm refuses versions younger than min-release-age, so a tool that proposes
// anything newer produces a bump that `npm install` then rejects. The Wails
// runtime is exempt everywhere: Wails ships weekly and the runtime must match
// the CLI version on the day of the upgrade.
func TestFrontendDependencyToolsShareTheReleaseCooldown(t *testing.T) {
	const wailsRuntime = "@wailsio/runtime"

	var cooldownDays string
	var excluded []string
	for line := range strings.Lines(readTestFile(t, repositoryPath("frontend", ".npmrc"))) {
		key, value, found := strings.Cut(strings.TrimSpace(line), "=")
		switch {
		case !found:
		case key == "min-release-age":
			cooldownDays = value
		case key == "min-release-age-exclude[]":
			excluded = append(excluded, value)
		}
	}
	days, err := strconv.Atoi(cooldownDays)
	require.NoError(t, err, "frontend/.npmrc must set min-release-age")
	require.Positive(t, days)
	require.Contains(t, excluded, wailsRuntime)

	for _, task := range []string{"qc:npm-update-check", "qc:npm-update"} {
		commands := taskCommands(t, repositoryPath("Taskfile.yml"), task)
		require.Contains(t, strings.Join(commands, "\n"), "--cooldown "+cooldownDays, task)
	}

	var dependabot struct {
		Updates []struct {
			Ecosystem string `yaml:"package-ecosystem"`
			Cooldown  struct {
				DefaultDays int      `yaml:"default-days"`
				Exclude     []string `yaml:"exclude"`
			} `yaml:"cooldown"`
		} `yaml:"updates"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(readTestFile(t, repositoryPath(".github", "dependabot.yml"))), &dependabot))
	foundNPM := false
	for _, update := range dependabot.Updates {
		if update.Ecosystem != "npm" {
			continue
		}
		foundNPM = true
		require.Equal(t, days, update.Cooldown.DefaultDays)
		require.Contains(t, update.Cooldown.Exclude, wailsRuntime)
	}
	require.True(t, foundNPM, "dependabot must have an npm update entry")
}
