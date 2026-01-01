//go:build mage
// +build mage

package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/magefile/mage/mg"
	"github.com/magefile/mage/sh"

	"github.com/luxury-yacht/app/mage"
)

var cfg = mage.NewBuildConfig()

// ===============================
// Debugging Stuff
// ===============================

// Displays the current build configuration
func ShowConfig() {
	mage.PrettyPrint(cfg)

}

// ===============================
// Mage Aliases
// ===============================

var Aliases = map[string]interface{}{
	"clean-all":           Clean.All,
	"nuke":                Clean.All,
	"clean":               Clean.Build,
	"clean-build":         Clean.Build,
	"clean-frontend":      Clean.Frontend,
	"clean-go-cache":      Clean.GoCache,
	"deps":                Deps.All,
	"deps-all":            Deps.All,
	"deps-go":             Deps.Go,
	"deps-npm":            Deps.Npm,
	"install-signed":      Install.Signed,
	"install-unsigned":    Install.Unsigned,
	"package-signed":      Package.Signed,
	"package-unsigned":    Package.Unsigned,
	"lint":                QC.Lint,
	"lint-fix":            QC.LintFix,
	"typecheck":           QC.Typecheck,
	"npm-update-check":    QC.NpmUpdateCheck,
	"npm-update-fix":      QC.NpmUpdate,
	"go-mod-update-check": QC.GoModUpdateCheck,
	"go-mod-update":       QC.GoModUpdate,
	"knip":                QC.Knip,
	"vet":                 QC.Vet,
	"trivy":               QC.Trivy,
	"reset":               QC.Reset,
	"test":                Test.All,
	"test-be":             Test.Backend,
	"test-be-cov":         Test.BackendCoverage,
	"test-fe":             Test.Frontend,
	"test-fe-cov":         Test.FrontendCoverage,
}

// ===============================
// Ensure Dependencies
// ===============================

func isNpmInstalled() error {
	if _, err := exec.LookPath("npm"); err != nil {
		return fmt.Errorf("npm is not installed.")
	}
	return nil
}

func isNpxInstalled() error {
	if _, err := exec.LookPath("npx"); err != nil {
		return fmt.Errorf("npx is not installed.")
	}
	return nil
}

func isStaticcheckInstalled() error {
	if _, err := exec.LookPath("staticcheck"); err != nil {
		return fmt.Errorf("staticcheck is not installed.")
	}
	return nil
}

func isTrivyInstalled() error {
	if _, err := exec.LookPath("trivy"); err != nil {
		return fmt.Errorf("trivy is not installed.")
	}
	return nil
}

// ===============================
// Dependency Management Tasks
// ===============================

type Deps mg.Namespace

// Installs all dependencies
func (Deps) All() {
	mg.SerialDeps(Deps.Go, Deps.Npm)
}

// Installs Go dependencies
func (Deps) Go() error {
	fmt.Println("Installing go dependencies...")
	return sh.RunV("go", "mod", "tidy")
}

// Installs npm dependencies
func (Deps) Npm() error {
	if err := isNpmInstalled(); err != nil {
		return err
	}
	fmt.Println("Installing npm dependencies...")
	return sh.RunV("npm", "install", "--prefix", cfg.FrontendDir)
}

// ===============================
// Cleanup Tasks
// ===============================

type Clean mg.Namespace

// Cleans all build artifacts and caches
func (Clean) All() {
	mg.SerialDeps(Clean.Build, Clean.GoCache, Clean.Frontend)
}

// Cleans build artifacts
func (Clean) Build() error {
	fmt.Println("\n🧹 Cleaning build directory...")
	os.RemoveAll(cfg.BuildDir)
	return nil
}

// Cleans the Go cache
func (Clean) GoCache() error {
	goCacheDir, _ := exec.Command("go", "env", "GOCACHE").Output()
	fmt.Println("\n🧹 Cleaning Go cache...")
	os.RemoveAll(string(goCacheDir))
	return nil
}

// Cleans the frontend build artifacts
func (Clean) Frontend() error {
	fmt.Println("\n🧹 Cleaning frontend...")
	os.RemoveAll(cfg.FrontendDir + "/dist")
	os.RemoveAll(cfg.FrontendDir + "/node_modules")
	return nil
}

// ===============================
// Development Tasks
// ===============================

// Runs the app in dev mode
func Dev() error {
	args := []string{"dev"}

	// If Linux, check for webkit2gtk 4.1 and set required tag.
	if cfg.OsType == "linux" {
		if webkitVersion, err := mage.WebkitVersion(); err != nil {
			return err
		} else if webkitVersion == "4.1" {
			args = append(args, "-tags", "webkit2_41")
		}
	}

	return sh.Run("wails", args...)
}

// ===============================
// Quality Checks
// ===============================

type QC mg.Namespace

// Checks for Go module updates
func (QC) GoModUpdateCheck() error {
	fmt.Println("\n🔎 Checking for outdated Go modules...")
	return sh.RunV("go", "list", "-u", "-m", "-f", `{{if and (not .Indirect) .Update}}{{.Path}} {{.Version}} → {{.Update.Version}}{{end}}`, "all")
}

// Updates Go modules
func (QC) GoModUpdate() error {
	fmt.Println("\n🔄 Updating outdated Go modules...")
	if err := sh.RunV("go", "get", "-u"); err != nil {
		return err
	}
	return sh.RunV("go", "mod", "tidy")
}

// Runs go vet and staticcheck
func (QC) Vet() error {
	if err := isStaticcheckInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔎 Running go vet...")
	if err := sh.RunV("go", "vet", "./..."); err != nil {
		return err
	}
	fmt.Println("\n🔎 Running staticcheck...")
	return sh.RunV("staticcheck", "./...")
}

// Runs the npm linter
func (QC) Lint() error {
	if err := isNpmInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔎 Running npm linter...")
	return sh.RunV("npm", "run", "lint", "--prefix", cfg.FrontendDir)
}

// Runs the npm linter with fix
func (QC) LintFix() error {
	if err := isNpmInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔧 Running npm linter with fix...")
	return sh.RunV("npm", "run", "lint:fix", "--prefix", cfg.FrontendDir)
}

// Runs the npm typechecker
func (QC) Typecheck() error {
	if err := isNpmInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔎 Running npm typecheck...")
	return sh.RunV("npm", "run", "typecheck", "--prefix", cfg.FrontendDir)
}

// Checks npm package updates
func (QC) NpmUpdateCheck() error {
	if err := isNpxInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔎 Checking for outdated npm packages...")
	os.Chdir(cfg.FrontendDir)
	return sh.RunV("npx", "npm-check-updates")
}

// Updates npm packages
func (QC) NpmUpdate() error {
	if err := isNpxInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔄 Updating outdated npm packages...")
	os.Chdir(cfg.FrontendDir)
	return sh.RunV("npx", "npm-check-updates", "-u")
}

// Runs knip to find unused files, dependencies, and exports in the frontend
func (QC) Knip() error {
	if err := isNpxInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔎 Running knip to find unused files, dependencies, and exports in the frontend...")
	os.Chdir(cfg.FrontendDir)
	return sh.RunV("npx", "knip")
}

// Runs a trivy vulnerability scan on the project's dependencies.
func (QC) Trivy() error {
	if err := isTrivyInstalled(); err != nil {
		return err
	}
	fmt.Println("\n🔎 Running trivy scan on the project...")
	return sh.RunV("trivy", "fs", "--exit-code", "1", "--severity", "CRITICAL,HIGH", ".")
}

// Resets application settings
func (QC) Reset() error {
	fmt.Println("\n🔄 Resetting application settings...")
	os.RemoveAll(os.Getenv("HOME") + "/.config/luxury-yacht")
	return nil
}

// Runs all checks that could cause a release to fail.
func (QC) PreRelease() error {
	mg.SerialDeps(QC.Vet, Test.Backend, QC.LintFix, QC.Lint, QC.Typecheck, Test.Frontend, QC.Trivy)
	return nil
}

// ===============================
// Test Tasks
// ===============================

const backendCoverageDir = "build/coverage"
const backendCoverageFile = backendCoverageDir + "/backend.coverage.out"

type Test mg.Namespace

// Runs backend tests
func (Test) Backend() error {
	fmt.Println("\n🔎 Running backend tests...")
	return sh.RunV("go", "test", "./...")
}

// Runs backend tests with coverage
func (Test) BackendCoverage() error {
	fmt.Println("\n🔎 Running backend tests...")
	os.MkdirAll(backendCoverageDir, os.ModePerm)
	return sh.RunV("go", "test", "./...", "-coverprofile="+backendCoverageFile)
}

// Runs frontend tests
func (Test) Frontend() error {
	fmt.Println("\n🔎 Running frontend tests...")
	if err := isNpmInstalled(); err != nil {
		return err
	}
	return sh.RunV("npm", "run", "test", "--prefix", cfg.FrontendDir)
}

// Runs frontend tests with coverage
func (Test) FrontendCoverage() error {
	fmt.Println("\n🔎 Running frontend tests with coverage report...")
	if err := isNpmInstalled(); err != nil {
		return err
	}
	return sh.RunV("npm", "run", "test", "--prefix", cfg.FrontendDir, "--", "--coverage")
}

// Runs all tests
func (Test) All() {
	mg.SerialDeps(Test.Backend, Test.Frontend)
}

// ===============================
// Build Tasks
// ===============================

// Builds the application.
func Build() error {
	switch cfg.OsType {
	case "darwin":
		return mage.BuildMacOS(cfg)
	case "linux":
		return mage.BuildLinux(cfg)
	case "windows":
		return mage.BuildWindows(cfg)
	default:
		return fmt.Errorf("Build is not supported on %s", cfg.OsType)
	}
}

// ===============================
// Install Tasks
// ===============================

type Install mg.Namespace

// Installs the app locally with signing and notarization.
func (Install) Signed() error {
	// mg.Deps(Build)

	switch cfg.OsType {
	case "darwin":
		return mage.InstallMacOS(cfg, true)
	case "linux":
		return mage.InstallLinux(cfg)
	case "windows":
		return mage.InstallWindows(cfg, true)
	default:
		return fmt.Errorf("Install is not supported on %s", cfg.OsType)
	}
}

// Installs the app locally without signing or notarization.
func (Install) Unsigned() error {
	mg.Deps(Build)

	switch cfg.OsType {
	case "darwin":
		return mage.InstallMacOS(cfg, false)
	case "linux":
		return mage.InstallLinux(cfg)
	case "windows":
		return mage.InstallWindows(cfg, false)
	default:
		return fmt.Errorf("Install is not supported on %s", cfg.OsType)
	}
}

// ===============================
// Packaging Tasks
// ===============================

type Package mg.Namespace

// Packages the app with signing and notarization.
func (Package) Signed() error {
	if cfg.OsType == "linux" {
		if err := mage.CheckPackageDependencies(); err != nil {
			return err
		}
	}
	// Only build if Linux because Windows and macOS packaging handle their own builds.
	if cfg.OsType == "linux" {
		mg.Deps(Build)
	}

	switch cfg.OsType {
	case "darwin":
		return mage.PackageMacOS(cfg, true)
	case "linux":
		return mage.PackageLinux(cfg)
	case "windows":
		return mage.PackageWindows(cfg, true)
	default:
		return fmt.Errorf("Package is not supported on %s", cfg.OsType)
	}
}

// Packages the app without signing and notarization.
func (Package) Unsigned() error {
	// Windows packaging runs its own NSIS build to produce the installer.
	// Only build if Linux because Windows and macOS packaging handle their own builds.
	if cfg.OsType == "linux" {
		mg.Deps(Build)
	}

	switch cfg.OsType {
	case "darwin":
		return mage.PackageMacOS(cfg, false)
	case "linux":
		return mage.PackageLinux(cfg)
	case "windows":
		return mage.PackageWindows(cfg, false)
	default:
		return fmt.Errorf("Package is not supported on %s", cfg.OsType)
	}
}

// ===============================
// GitHub Release Tasks
// ===============================

// Publishes a GitHub release using the current artifacts.
func Release() error {
	return mage.PublishRelease(cfg)
}
