package mage

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// checkNodeVersion reads .nvmrc and verifies the active Node version matches.
// Since nvm is a shell function (not a binary), we can't call "nvm use" from Go,
// so we report a clear error telling the developer to switch manually.
func CheckNodeVersion() error {
	data, err := os.ReadFile(".nvmrc")
	if err != nil {
		return fmt.Errorf("failed to read .nvmrc: %w", err)
	}
	expected := strings.TrimSpace(string(data))
	expected = strings.TrimPrefix(expected, "v")

	nodeCmd := exec.Command("node", "--version")
	out, err := nodeCmd.Output()
	if err != nil {
		return fmt.Errorf("node is not installed or not in PATH: %w", err)
	}
	actual := strings.TrimSpace(string(out))
	actual = strings.TrimPrefix(actual, "v")

	if actual != expected {
		return fmt.Errorf("node version mismatch: .nvmrc requires v%s but current node is v%s. Run 'nvm use' to switch", expected, actual)
	}
	return nil
}

type wailsConfig struct {
	Info struct {
		ProductVersion string `json:"productVersion"`
		BetaExpiryDays int    `json:"betaExpiryDays"`
	} `json:"info"`
}

// Gets product version from wails.json
func getProductVersion() (string, error) {
	data, err := os.ReadFile("wails.json")
	if err != nil {
		return "", err
	}
	var wailsCfg wailsConfig
	if err := json.Unmarshal(data, &wailsCfg); err != nil {
		return "", err
	}
	return wailsCfg.Info.ProductVersion, nil
}

// If the version string contains "beta", consider it a beta version.
func isBeta(version string) bool {
	return strings.Contains(strings.ToLower(version), "beta")
}

// Gets beta expiry days from wails.json
func getBetaExpiryDays() (int, error) {
	data, err := os.ReadFile("wails.json")
	if err != nil {
		return 0, err
	}
	var wailsCfg wailsConfig
	if err := json.Unmarshal(data, &wailsCfg); err != nil {
		return 0, err
	}
	return wailsCfg.Info.BetaExpiryDays, nil
}

// GitRevParse returns the short git commit hash of the current HEAD.
func gitRevParse() string {
	cmd := exec.Command("git", "rev-parse", "--short=9", "HEAD")
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
