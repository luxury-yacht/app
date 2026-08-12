package projecttools

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"gopkg.in/yaml.v3"
)

// ToolCommand builds an exec.Cmd for a build tool, resolving it to an absolute
// path first. Passing a bare name would leave the binary chosen by whatever
// PATH happens to be set when the build runs; resolving up front pins the
// choice and turns a missing tool into a named error instead of an opaque
// "executable file not found" from the eventual Run.
func ToolCommand(name string, args ...string) (*exec.Cmd, error) {
	resolved, err := exec.LookPath(name)
	if err != nil {
		return nil, fmt.Errorf("%s not found in PATH: %w", name, err)
	}
	return exec.Command(resolved, args...), nil
}

// RunCommand executes a project tool with terminal streams attached.
func RunCommand(name string, args ...string) error {
	cmd, err := ToolCommand(name, args...)
	if err != nil {
		return err
	}
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("run %s: %w", name, err)
	}
	return nil
}

// CommandOutput executes a project tool and returns trimmed standard output.
func CommandOutput(name string, args ...string) (string, error) {
	cmd, err := ToolCommand(name, args...)
	if err != nil {
		return "", err
	}
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("run %s: %w", name, err)
	}
	return strings.TrimSpace(string(output)), nil
}

type projectMetadata struct {
	Info struct {
		Version string `yaml:"version"`
	} `yaml:"info"`
	LuxuryYacht struct {
		BetaExpiryDays int `yaml:"betaExpiryDays"`
	} `yaml:"luxuryYacht"`
}

func readProjectMetadata(path string) (projectMetadata, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return projectMetadata{}, err
	}
	var metadata projectMetadata
	if err := yaml.Unmarshal(data, &metadata); err != nil {
		return projectMetadata{}, err
	}
	if strings.TrimSpace(metadata.Info.Version) == "" {
		return projectMetadata{}, fmt.Errorf("read project metadata from %s: info.version is required", path)
	}
	return metadata, nil
}

// Gets the product version from the Wails v3 build configuration.
func getProductVersion() (string, error) {
	metadata, err := readProjectMetadata("build/config.yml")
	if err != nil {
		return "", err
	}
	return metadata.Info.Version, nil
}

// If the version string contains "beta", consider it a beta version.
func isBeta(version string) bool {
	return strings.Contains(strings.ToLower(version), "beta")
}

// Gets beta expiry days from the repository-owned Wails v3 build configuration.
func getBetaExpiryDays() (int, error) {
	metadata, err := readProjectMetadata("build/config.yml")
	if err != nil {
		return 0, err
	}
	return metadata.LuxuryYacht.BetaExpiryDays, nil
}

// GitRevParse returns the short git commit hash of the current HEAD.
func gitRevParse() string {
	cmd, err := ToolCommand("git", "rev-parse", "--short=9", "HEAD")
	if err != nil {
		return ""
	}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
