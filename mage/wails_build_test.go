package mage

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestWailsTaskArgsTargetPlatformAndArchitecture(t *testing.T) {
	got := wailsTaskArgs("package", "windows", "arm64", "WINDOWS_VERSION=1.2.3.4")
	want := []string{
		"package",
		"GOOS=windows",
		"ARCH=arm64",
		"WINDOWS_VERSION=1.2.3.4",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("wailsTaskArgs() = %#v, want %#v", got, want)
	}
}

func TestCompareDirectoryTrees(t *testing.T) {
	t.Run("matching trees", func(t *testing.T) {
		expected := t.TempDir()
		actual := t.TempDir()
		writeTestFile(t, expected, "app/models.ts", "export type App = {}\n")
		writeTestFile(t, actual, "app/models.ts", "export type App = {}\n")

		if err := CompareDirectoryTrees(expected, actual); err != nil {
			t.Fatalf("CompareDirectoryTrees() error = %v", err)
		}
	})

	tests := []struct {
		name          string
		expectedFiles map[string]string
		actualFiles   map[string]string
		wantError     string
	}{
		{
			name:          "changed generated file",
			expectedFiles: map[string]string{"app/models.ts": "old"},
			actualFiles:   map[string]string{"app/models.ts": "new"},
			wantError:     "content differs: app/models.ts",
		},
		{
			name:          "missing generated file",
			expectedFiles: map[string]string{"app/models.ts": "model"},
			actualFiles:   map[string]string{},
			wantError:     "missing generated file: app/models.ts",
		},
		{
			name:          "unexpected generated file",
			expectedFiles: map[string]string{},
			actualFiles:   map[string]string{"app/models.ts": "model"},
			wantError:     "unexpected generated file: app/models.ts",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			expected := t.TempDir()
			actual := t.TempDir()
			for path, contents := range test.expectedFiles {
				writeTestFile(t, expected, path, contents)
			}
			for path, contents := range test.actualFiles {
				writeTestFile(t, actual, path, contents)
			}

			err := CompareDirectoryTrees(expected, actual)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("CompareDirectoryTrees() error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func writeTestFile(t *testing.T, root, path, contents string) {
	t.Helper()
	fullPath := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizeWailsBuildAssetsEnforcesDesktopContract(t *testing.T) {
	buildDir := filepath.Join(t.TempDir(), "build")
	iosFile := filepath.Join(buildDir, "ios", "Info.plist")
	msixFile := filepath.Join(buildDir, "windows", "msix", "project.wapproj")
	wailsTools := filepath.Join(buildDir, "windows", "nsis", "wails_tools.nsh")
	project := filepath.Join(buildDir, "windows", "nsis", "project.nsi")
	nfpmConfig := filepath.Join(buildDir, "linux", "nfpm", "nfpm.yaml")
	crossDockerfile := filepath.Join(buildDir, "docker", "Dockerfile.cross")

	for path, contents := range map[string]string{
		iosFile:    "ios",
		msixFile:   "msix",
		wailsTools: "# DO NOT EDIT - Generated automatically by `wails build`\n\n!include \"x64.nsh\"\n",
		project:    "repository-owned installer",
		nfpmConfig: `contents:
  - src: "./bin/luxury-yacht"
# If you build your app with -tags gtk3 (legacy stack)
# replace the depends/overrides above with these:
#   - libgtk-3-0
# replaces:
`,
		crossDockerfile: "# Wails cross-build image\n\nFROM golang:1.26-bookworm\nRUN apt-get install libwebkitgtk-6.0-dev\n",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if err := NormalizeWailsBuildAssets(buildDir); err != nil {
		t.Fatalf("NormalizeWailsBuildAssets() error = %v", err)
	}
	for _, path := range []string{iosFile, msixFile} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("unsupported generated asset still exists at %s; stat error = %v", path, err)
		}
	}
	toolsContents, err := os.ReadFile(wailsTools)
	if err != nil {
		t.Fatal(err)
	}
	if want := "# DO NOT EDIT - Generated automatically by Wails v3 build assets"; !strings.HasPrefix(string(toolsContents), want) {
		t.Fatalf("generated header = %q, want prefix %q", toolsContents, want)
	}
	projectContents, err := os.ReadFile(project)
	if err != nil {
		t.Fatal(err)
	}
	if string(projectContents) != "repository-owned installer" {
		t.Fatalf("repository-owned NSIS project changed: %q", projectContents)
	}
	nfpmContents, err := os.ReadFile(nfpmConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(nfpmContents), `src: "./build/bin/luxury-yacht"`) {
		t.Fatalf("nFPM binary source was not rooted at the repository: %s", nfpmContents)
	}
	if strings.Contains(string(nfpmContents), "gtk3") || strings.Contains(string(nfpmContents), "libgtk-3") {
		t.Fatalf("nFPM config retained GTK3 guidance: %s", nfpmContents)
	}
	dockerContents, err := os.ReadFile(crossDockerfile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(dockerContents), "FROM golang:1.26-trixie") {
		t.Fatalf("cross-build image does not use the GTK4/WebKitGTK 6-capable Debian floor: %s", dockerContents)
	}
}
