package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

const sentryBackendDSN = "SENTRY_BACKEND_DSN"

var semanticVersionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$`)
var trailingNumberPattern = regexp.MustCompile(`(\d+)$`)

type buildManifest struct {
	BetaExpiry string `json:"betaExpiry,omitempty"`
	BuildTime  string `json:"buildTime"`
	IsBeta     bool   `json:"isBeta"`
	GitCommit  string `json:"gitCommit"`
	SentryDSN  string `json:"sentryDsn,omitempty"`
	Version    string `json:"version"`
}

type buildMetadataOptions struct {
	ConfigPath string
	EnvPath    string
	OutputPath string
	Now        func() time.Time
	GitCommit  func() string
	Summary    io.Writer
}

func generateBuildMetadata(options buildMetadataOptions) (buildManifest, error) {
	config, err := readProjectMetadata(options.ConfigPath)
	if err != nil {
		return buildManifest{}, err
	}

	env, err := readOptionalBuildEnvironment(options.EnvPath)
	if err != nil {
		return buildManifest{}, err
	}

	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	gitCommit := gitRevParse
	if options.GitCommit != nil {
		gitCommit = options.GitCommit
	}

	buildTime := now().UTC()
	version := strings.TrimSpace(config.Info.Version)
	beta := isBeta(version)
	manifest := buildManifest{
		BuildTime: buildTime.Format(time.RFC3339),
		IsBeta:    beta,
		GitCommit: strings.TrimSpace(gitCommit()),
		SentryDSN: buildMetadataEnvironmentValue(sentryBackendDSN, env),
		Version:   version,
	}
	if beta {
		manifest.BetaExpiry = buildTime.AddDate(0, 0, config.LuxuryYacht.BetaExpiryDays).Format(time.RFC3339)
	}

	if err := writeBuildManifest(options.OutputPath, manifest); err != nil {
		return buildManifest{}, err
	}
	if options.Summary != nil {
		if err := writeBuildMetadataSummary(options.Summary, manifest); err != nil {
			return buildManifest{}, err
		}
	}

	return manifest, nil
}

func windowsNumericVersion(version string) (string, error) {
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

func readOptionalBuildEnvironment(path string) (map[string]string, error) {
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

func buildMetadataEnvironmentValue(name string, fileValues map[string]string) string {
	if value, exists := os.LookupEnv(name); exists {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(fileValues[name])
}

func writeBuildManifest(path string, manifest buildManifest) error {
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

func writeBuildMetadataSummary(writer io.Writer, manifest buildManifest) error {
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
