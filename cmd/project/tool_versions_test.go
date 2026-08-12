package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadToolVersionsRequiresEveryCanonicalVersion(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "mise.toml")
	config := `[tools]
go = "1.26.0"
node = "26.5.0"
npm = "12.0.1"
"go:github.com/wailsapp/wails/v3/cmd/wails3" = "3.0.0-beta.8"
"go:honnef.co/go/tools/cmd/staticcheck" = "0.7.0"
trivy = "0.72.0"

[vars]
nsis_version = "3.10"
wails_runtime_version = "3.0.0-beta.7"
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatalf("write mise config: %v", err)
	}

	versions, err := readToolVersions(configPath)
	if err != nil {
		t.Fatalf("readToolVersions: %v", err)
	}

	want := toolVersions{
		Go:           "1.26.0",
		Node:         "26.5.0",
		NPM:          "12.0.1",
		Wails:        "3.0.0-beta.8",
		WailsRuntime: "3.0.0-beta.7",
		Staticcheck:  "0.7.0",
		Trivy:        "0.72.0",
		NSIS:         "3.10",
	}
	if versions != want {
		t.Fatalf("readToolVersions() = %#v, want %#v", versions, want)
	}
}

func TestReadToolVersionsRejectsMissingCanonicalVersion(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "mise.toml")
	config := `[tools]
go = "1.26.0"
node = "26.5.0"
npm = "12.0.1"
"go:github.com/wailsapp/wails/v3/cmd/wails3" = "3.0.0-beta.8"
"go:honnef.co/go/tools/cmd/staticcheck" = "0.7.0"
trivy = "0.72.0"

[vars]
wails_runtime_version = "3.0.0-beta.7"
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatalf("write mise config: %v", err)
	}

	_, err := readToolVersions(configPath)
	if err == nil {
		t.Fatal("readToolVersions returned no error without vars.nsis_version")
	}
	if !strings.Contains(err.Error(), "vars.nsis_version is required") {
		t.Fatalf("readToolVersions error = %q, want missing NSIS version", err)
	}
}

func TestCanonicalToolVersionsMatchCompatibilityMetadata(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	versions, err := readToolVersions(filepath.Join(repoRoot, "mise.toml"))
	if err != nil {
		t.Fatalf("read canonical tool versions: %v", err)
	}

	goMod := readTestFile(t, filepath.Join(repoRoot, "go.mod"))
	assertContains(t, goMod, "\ngo "+versions.Go+"\n", "Go directive")
	assertContains(t, goMod, "\tgithub.com/wailsapp/wails/v3 v"+versions.Wails+"\n", "Wails module")

	var frontendConfig struct {
		PackageManager string            `json:"packageManager"`
		Engines        map[string]string `json:"engines"`
		Dependencies   map[string]string `json:"dependencies"`
	}
	packageJSON := readTestFile(t, filepath.Join(repoRoot, "frontend", "package.json"))
	if err := json.Unmarshal([]byte(packageJSON), &frontendConfig); err != nil {
		t.Fatalf("parse frontend/package.json: %v", err)
	}
	if want := "npm@" + versions.NPM; frontendConfig.PackageManager != want {
		t.Errorf("frontend packageManager = %q, want %q from mise.toml", frontendConfig.PackageManager, want)
	}
	if want := ">=" + versions.Node; frontendConfig.Engines["node"] != want {
		t.Errorf("frontend Node engine = %q, want %q from mise.toml", frontendConfig.Engines["node"], want)
	}
	if want := ">=" + versions.NPM; frontendConfig.Engines["npm"] != want {
		t.Errorf("frontend npm engine = %q, want %q from mise.toml", frontendConfig.Engines["npm"], want)
	}
	if got := frontendConfig.Dependencies["@wailsio/runtime"]; got != versions.WailsRuntime {
		t.Errorf("frontend @wailsio/runtime = %q, want %q from mise.toml", got, versions.WailsRuntime)
	}
}

func TestPinnedWailsRuntimeMatchesBeta8FrameworkRelease(t *testing.T) {
	var frontendConfig struct {
		Dependencies map[string]string `json:"dependencies"`
	}
	packageJSON := readTestFile(t, filepath.Join("..", "..", "frontend", "package.json"))
	if err := json.Unmarshal([]byte(packageJSON), &frontendConfig); err != nil {
		t.Fatalf("parse frontend/package.json: %v", err)
	}
	if got, want := frontendConfig.Dependencies["@wailsio/runtime"], "3.0.0-beta.7"; got != want {
		t.Errorf("@wailsio/runtime = %q, want %q paired with Wails v3.0.0-beta.8", got, want)
	}
}

func readTestFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func assertContains(t *testing.T, contents, want, label string) {
	t.Helper()
	if !strings.Contains(contents, want) {
		t.Errorf("%s does not contain %q", label, want)
	}
}
