package buildmeta

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"gopkg.in/yaml.v3"
)

const sentryBackendDSN = "SENTRY_BACKEND_DSN"

var semanticVersionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$`)
var trailingNumberPattern = regexp.MustCompile(`(\d+)$`)

type Manifest struct {
	BetaExpiry string `json:"betaExpiry,omitempty"`
	BuildTime  string `json:"buildTime"`
	IsBeta     bool   `json:"isBeta"`
	GitCommit  string `json:"gitCommit"`
	SentryDSN  string `json:"sentryDsn,omitempty"`
	Version    string `json:"version"`
}

type Options struct {
	ConfigPath string
	EnvPath    string
	OutputPath string
	Now        func() time.Time
	GitCommit  func() string
	Summary    io.Writer
}

type projectConfig struct {
	Info struct {
		Version string `yaml:"version"`
	} `yaml:"info"`
	LuxuryYacht struct {
		BetaExpiryDays int `yaml:"betaExpiryDays"`
	} `yaml:"luxuryYacht"`
}

func Generate(options Options) (Manifest, error) {
	config, err := readConfig(options.ConfigPath)
	if err != nil {
		return Manifest{}, err
	}

	env, err := readOptionalEnv(options.EnvPath)
	if err != nil {
		return Manifest{}, err
	}

	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	gitCommit := DefaultGitCommit
	if options.GitCommit != nil {
		gitCommit = options.GitCommit
	}

	buildTime := now().UTC()
	version := strings.TrimSpace(config.Info.Version)
	isBeta := strings.Contains(strings.ToLower(version), "beta")
	manifest := Manifest{
		BuildTime: buildTime.Format(time.RFC3339),
		IsBeta:    isBeta,
		GitCommit: strings.TrimSpace(gitCommit()),
		SentryDSN: environmentValue(sentryBackendDSN, env),
		Version:   version,
	}
	if isBeta {
		manifest.BetaExpiry = buildTime.AddDate(0, 0, config.LuxuryYacht.BetaExpiryDays).Format(time.RFC3339)
	}

	if err := writeManifest(options.OutputPath, manifest); err != nil {
		return Manifest{}, err
	}
	if options.Summary != nil {
		if err := writeSummary(options.Summary, manifest); err != nil {
			return Manifest{}, err
		}
	}

	return manifest, nil
}

func DefaultGitCommit() string {
	output, err := exec.Command("git", "rev-parse", "--short=9", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func WindowsNumericVersion(version string) (string, error) {
	parts := semanticVersionPattern.FindStringSubmatch(strings.TrimSpace(version))
	if parts == nil {
		return "", fmt.Errorf("invalid semantic version %q", version)
	}
	build := 1000
	if parts[4] != "" {
		build = 0
		if match := trailingNumberPattern.FindStringSubmatch(parts[4]); match != nil {
			build, _ = strconv.Atoi(match[1])
		}
	}
	return fmt.Sprintf("%s.%s.%s.%d", parts[1], parts[2], parts[3], build), nil
}

func readConfig(path string) (projectConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return projectConfig{}, fmt.Errorf("read Wails config %s: %w", path, err)
	}
	var config projectConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return projectConfig{}, fmt.Errorf("parse Wails config %s: %w", path, err)
	}
	if strings.TrimSpace(config.Info.Version) == "" {
		return projectConfig{}, fmt.Errorf("wails config %s has no info.version", path)
	}
	return config, nil
}

func readOptionalEnv(path string) (map[string]string, error) {
	if path == "" {
		return nil, nil
	}
	values, err := godotenv.Read(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read environment %s: %w", path, err)
	}
	return values, nil
}

func environmentValue(name string, fileValues map[string]string) string {
	if value, exists := os.LookupEnv(name); exists {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(fileValues[name])
}

func writeManifest(path string, manifest Manifest) error {
	if path == "" {
		return errors.New("build manifest output path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create build manifest directory: %w", err)
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encode build manifest: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write build manifest %s: %w", path, err)
	}
	return nil
}

func writeSummary(writer io.Writer, manifest Manifest) error {
	if manifest.SentryDSN != "" {
		manifest.SentryDSN = "<configured>"
	}
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(manifest); err != nil {
		return fmt.Errorf("encode build manifest summary: %w", err)
	}
	return nil
}
