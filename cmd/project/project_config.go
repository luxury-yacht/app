package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"gopkg.in/yaml.v3"
)

const (
	projectAppShortName = "luxury-yacht"
	projectArtifactsDir = "artifacts"
	projectBuildDir     = "build"
	projectConfigPath   = "build/config.yml"
	projectEnvPath      = ".env"
	projectFrontendDir  = "frontend"
	projectManifestPath = "backend/buildinfo/generated.json"
	projectPackagePath  = "github.com/luxury-yacht/app"
	projectReleaseRepo  = "luxury-yacht/app"
)

var projectReleaseAssets = []string{".deb", ".rpm", ".dmg", ".exe", ".zip"}

type projectMetadata struct {
	Info struct {
		CompanyName       string `yaml:"companyName"`
		ProductName       string `yaml:"productName"`
		ProductIdentifier string `yaml:"productIdentifier"`
		Description       string `yaml:"description"`
		Copyright         string `yaml:"copyright"`
		Comments          string `yaml:"comments"`
		Version           string `yaml:"version"`
	} `yaml:"info"`
	LuxuryYacht struct {
		BetaExpiryDays int    `yaml:"betaExpiryDays"`
		Maintainer     string `yaml:"maintainer"`
	} `yaml:"luxuryYacht"`
}

type projectFacts struct {
	betaExpiry string
	commit     string
	isBeta     bool
	version    string
}

type projectConfigOutput struct {
	AppShortName  string
	ArtifactsDir  string
	BetaExpiry    string
	BuildDir      string
	FrontendDir   string
	Commit        string
	IsBeta        bool
	ManifestPath  string
	PackagePath   string
	ReleaseAssets []string
	ReleaseRepo   string
	Version       string
}

func loadDotEnv(path string) error {
	if err := godotenv.Load(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("load environment from %s: %w", path, err)
	}
	return nil
}

func readProjectMetadata(path string) (projectMetadata, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return projectMetadata{}, fmt.Errorf("read Wails config %s: %w", path, err)
	}
	var metadata projectMetadata
	if err := yaml.Unmarshal(data, &metadata); err != nil {
		return projectMetadata{}, fmt.Errorf("parse Wails config %s: %w", path, err)
	}
	if strings.TrimSpace(metadata.Info.Version) == "" {
		return projectMetadata{}, fmt.Errorf("wails config %s has no info.version", path)
	}
	return metadata, nil
}

func loadProjectFacts() (projectFacts, error) {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return projectFacts{}, err
	}
	return deriveProjectFacts(metadata, time.Now().UTC(), gitRevParse()), nil
}

func deriveProjectFacts(metadata projectMetadata, now time.Time, commit string) projectFacts {
	version := strings.TrimSpace(metadata.Info.Version)
	beta := isBetaVersion(version)
	betaExpiryDays := 0
	if beta {
		betaExpiryDays = metadata.LuxuryYacht.BetaExpiryDays
	}
	return projectFacts{
		betaExpiry: now.AddDate(0, 0, betaExpiryDays).Format(time.RFC3339),
		commit:     strings.TrimSpace(commit),
		isBeta:     beta,
		version:    version,
	}
}

func isBetaVersion(version string) bool {
	return strings.Contains(strings.ToLower(version), "beta")
}

func writeProjectConfig(output io.Writer) error {
	facts, err := loadProjectFacts()
	if err != nil {
		return fmt.Errorf("read app version: %w", err)
	}
	config := projectConfigOutput{
		AppShortName:  projectAppShortName,
		ArtifactsDir:  projectArtifactsDir,
		BetaExpiry:    facts.betaExpiry,
		BuildDir:      projectBuildDir,
		FrontendDir:   projectFrontendDir,
		Commit:        facts.commit,
		IsBeta:        facts.isBeta,
		ManifestPath:  projectManifestPath,
		PackagePath:   projectPackagePath,
		ReleaseAssets: projectReleaseAssets,
		ReleaseRepo:   projectReleaseRepo,
		Version:       facts.version,
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(config)
}

func projectBinaryName(metadata projectMetadata) (string, error) {
	productName := strings.TrimSpace(metadata.Info.ProductName)
	if productName == "" {
		return "", fmt.Errorf("wails config has no info.productName")
	}
	return strings.ToLower(strings.ReplaceAll(productName, " ", "-")), nil
}
