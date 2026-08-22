// Package updatetemp owns the process temp directory used by Wails updater
// staging, helper logs, and intentionally inherited child processes.
package updatetemp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/luxury-yacht/app/internal/updateidentity"
)

const (
	RootEnvironmentName = "LUXURY_YACHT_TEMP_ROOT"
	OwnershipMarkerName = ".luxury-yacht-temp-root.json"
	rootSchemaVersion   = 1
)

type Environment interface {
	LookupEnv(string) (string, bool)
	Setenv(string, string) error
	Unsetenv(string) error
}

type Config struct {
	Platform    string
	BaseTempDir string
	UserID      string
	Environment Environment
}

type processConfig struct {
	Platform       string
	Architecture   string
	SystemTempDir  string
	ExecutablePath string
	UserID         string
	Environment    Environment
}

type ownershipMarker struct {
	SchemaVersion     int    `json:"schemaVersion"`
	ProductIdentifier string `json:"productIdentifier"`
	UserIDHash        string `json:"userIdHash"`
}

type osEnvironment struct{}

func (osEnvironment) LookupEnv(name string) (string, bool) { return os.LookupEnv(name) }
func (osEnvironment) Setenv(name, value string) error      { return os.Setenv(name, value) }
func (osEnvironment) Unsetenv(name string) error           { return os.Unsetenv(name) }

// ExpectedRoot returns the stable user-specific updater temp root below base.
func ExpectedRoot(base, userID string) string {
	return filepath.Join(filepath.Clean(base), expectedRootBasename(userID))
}

// ConfigureProcess configures the current process and returns the validated
// root. It must run before any child-process or Wails application dispatch.
func ConfigureProcess() (string, error) {
	currentUser, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("resolve current user for updater temp root: %w", err)
	}
	executablePath := ""
	if runtime.GOOS == "linux" {
		executablePath, err = os.Executable()
		if err != nil {
			return "", fmt.Errorf("resolve executable for updater temp root: %w", err)
		}
	}
	return configureProcess(processConfig{
		Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		SystemTempDir: os.TempDir(), ExecutablePath: executablePath,
		UserID: currentUser.Uid, Environment: osEnvironment{},
	})
}

func configureProcess(config processConfig) (string, error) {
	base := config.SystemTempDir
	if config.Platform == "linux" {
		probe, err := updateidentity.CollectLinuxPortableInstallationProbe(
			config.Architecture,
			config.ExecutablePath,
		)
		if err != nil {
			return "", fmt.Errorf("inspect Linux portable target for updater temp root: %w", err)
		}
		eligibility := updateidentity.ResolveInstallation(probe)
		if eligibility.CanInstall && eligibility.Distribution == updateidentity.DistributionLinuxPortable {
			base = filepath.Dir(filepath.Dir(probe.TargetPath))
		}
	}
	return Setup(Config{
		Platform: config.Platform, BaseTempDir: base, UserID: config.UserID,
		Environment: config.Environment,
	})
}

// Setup creates or validates a stable root and updates the supplied process
// environment only after validation succeeds.
func Setup(config Config) (string, error) {
	environment := config.Environment
	if environment == nil {
		environment = osEnvironment{}
	}
	base := filepath.Clean(strings.TrimSpace(config.BaseTempDir))
	if base == "." || !filepath.IsAbs(base) {
		return "", fmt.Errorf("base temp directory must be absolute: %q", config.BaseTempDir)
	}
	if strings.TrimSpace(config.UserID) == "" {
		return "", fmt.Errorf("current user identity is required for updater temp root")
	}

	root, err := selectRoot(base, config.UserID, environment)
	if err != nil {
		return "", err
	}
	if err := ensureOwnedRoot(root, config.UserID); err != nil {
		return "", err
	}
	if err := applyEnvironment(environment, config.Platform, root); err != nil {
		return "", err
	}
	return root, nil
}

func selectRoot(base, userID string, environment Environment) (string, error) {
	expectedBasename := expectedRootBasename(userID)
	if inherited, ok := environment.LookupEnv(RootEnvironmentName); ok && strings.TrimSpace(inherited) != "" {
		candidate := filepath.Clean(inherited)
		if !filepath.IsAbs(candidate) || filepath.Base(candidate) != expectedBasename {
			return "", fmt.Errorf("inherited updater temp root has unexpected path: %s", inherited)
		}
		if candidate != base && filepath.Clean(filepath.Dir(candidate)) != base {
			return "", fmt.Errorf("inherited updater temp root is outside the current temp base: %s", candidate)
		}
		return candidate, nil
	}
	if filepath.Base(base) == expectedBasename {
		return base, nil
	}
	return filepath.Join(base, expectedBasename), nil
}

func ensureOwnedRoot(root, userID string) error {
	info, err := os.Lstat(root)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("inspect updater temp root %s: %w", root, err)
		}
		if err := createOwnedDirectory(root); err != nil {
			return fmt.Errorf("create updater temp root %s: %w", root, err)
		}
		info, err = os.Lstat(root)
		if err != nil {
			return fmt.Errorf("inspect created updater temp root %s: %w", root, err)
		}
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("updater temp root must not be a symlink: %s", root)
	}
	if !info.IsDir() {
		return fmt.Errorf("updater temp root must be a directory: %s", root)
	}
	if err := ensureOwnedPath(root, info, true); err != nil {
		return err
	}
	return ensureOwnershipMarker(root, userID)
}

func ensureOwnershipMarker(root, userID string) error {
	markerPath := filepath.Join(root, OwnershipMarkerName)
	expected := ownershipMarker{
		SchemaVersion:     rootSchemaVersion,
		ProductIdentifier: updateidentity.ProductIdentifier,
		UserIDHash:        hashUserID(userID),
	}
	info, err := os.Lstat(markerPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("inspect updater temp ownership marker: %w", err)
		}
		data, marshalErr := json.Marshal(expected)
		if marshalErr != nil {
			return fmt.Errorf("encode updater temp ownership marker: %w", marshalErr)
		}
		file, openErr := createOwnedFile(markerPath)
		if openErr != nil {
			return fmt.Errorf("create updater temp ownership marker: %w", openErr)
		}
		_, writeErr := file.Write(append(data, '\n'))
		closeErr := file.Close()
		if writeErr != nil {
			return fmt.Errorf("write updater temp ownership marker: %w", writeErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close updater temp ownership marker: %w", closeErr)
		}
		info, err = os.Lstat(markerPath)
		if err != nil {
			return fmt.Errorf("inspect created updater temp ownership marker: %w", err)
		}
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("updater temp ownership marker must be a regular file")
	}
	if err := ensureOwnedPath(markerPath, info, false); err != nil {
		return err
	}
	data, err := os.ReadFile(markerPath)
	if err != nil {
		return fmt.Errorf("read updater temp ownership marker: %w", err)
	}
	var actual ownershipMarker
	if err := json.Unmarshal(data, &actual); err != nil || actual != expected {
		return fmt.Errorf("invalid ownership marker for updater temp root %s", root)
	}
	return nil
}

func applyEnvironment(environment Environment, platform, root string) error {
	names := []string{"TMPDIR"}
	if platform == "windows" {
		names = []string{"TMP", "TEMP"}
	}
	names = append(names, RootEnvironmentName)
	type previousValue struct {
		value string
		set   bool
	}
	previous := make(map[string]previousValue, len(names))
	applied := make([]string, 0, len(names))
	for _, name := range names {
		value, set := environment.LookupEnv(name)
		previous[name] = previousValue{value: value, set: set}
		if err := environment.Setenv(name, root); err != nil {
			for index := len(applied) - 1; index >= 0; index-- {
				appliedName := applied[index]
				prior := previous[appliedName]
				if prior.set {
					_ = environment.Setenv(appliedName, prior.value)
				} else {
					_ = environment.Unsetenv(appliedName)
				}
			}
			return fmt.Errorf("set %s for updater temp root: %w", name, err)
		}
		applied = append(applied, name)
	}
	return nil
}

func expectedRootBasename(userID string) string {
	return "luxury-yacht-update-" + hashUserID(userID)[:12]
}

func hashUserID(userID string) string {
	digest := sha256.Sum256([]byte(userID))
	return hex.EncodeToString(digest[:])
}
