package mage

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

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

// CheckNodeVersion reads mise.toml and ensures the canonical Node version is active.
func CheckNodeVersion() error {
	versions, err := readToolVersions("mise.toml")
	if err != nil {
		return err
	}
	expected := versions.Node

	nodeCmd, err := ToolCommand("node", "--version")
	if err != nil {
		return fmt.Errorf("node v%s is not active: %v; activate Mise in your shell or prefix the command with 'mise exec --'", expected, err)
	}
	out, err := nodeCmd.Output()
	if err != nil {
		return fmt.Errorf("check active Node version: %w; activate Mise in your shell or prefix the command with 'mise exec --'", err)
	}
	actual := strings.TrimPrefix(strings.TrimSpace(string(out)), "v")
	if actual != expected {
		return fmt.Errorf("node v%s is active, but mise.toml requires v%s; activate Mise in your shell or prefix the command with 'mise exec --'", actual, expected)
	}
	return nil
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

// Credit to https://github.com/sfate
// https://gist.github.com/sfate/9d45f6c5405dc4c9bf63bf95fe6d1a7c
func PrettyPrint(args ...interface{}) {
	var caller string

	timeNow := time.Now().Format("01-02-2006 15:04:05")
	prefix := fmt.Sprintf("[%s] %s -- ", "PrettyPrint", timeNow)
	_, fileName, fileLine, ok := runtime.Caller(1)

	if ok {
		caller = fmt.Sprintf("%s:%d", fileName, fileLine)
	} else {
		caller = ""
	}

	fmt.Printf("\n%s%s\n", prefix, caller)

	if len(args) == 2 {
		label := args[0]
		value := args[1]

		s, _ := json.MarshalIndent(value, "", "\t")
		fmt.Printf("%s%s: %s\n", prefix, label, string(s))
	} else {
		s, _ := json.MarshalIndent(args, "", "\t")
		fmt.Printf("%s%s\n", prefix, string(s))
	}
}
