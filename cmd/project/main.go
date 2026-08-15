package main

import (
	"fmt"
	"io"
	"os"
)

const projectUsage = "usage: project <backend-coverage|binary-name|bindings|build-manifests|build-metadata|clean-all|clean-build|clean-frontend|config|fmt|go-mod-update|go-mod-update-check|install-unsigned|prepare-release-updater-manifest|product-name|release-app|release-artifact-name|release-site|reset|validate-macos-updater|validate-release-tag>"

var projectCommands = map[string]func() error{
	"backend-coverage":                 runBackendCoverage,
	"binary-name":                      writeConfiguredBinaryName,
	"bindings":                         checkWailsBindings,
	"build-manifests":                  func() error { return renderProjectPlatformManifests(projectConfigPath, projectPlatformManifestSpecs) },
	"build-metadata":                   generateConfiguredBuildMetadata,
	"clean-all":                        func() error { return cleanAllOutputs(defaultCleanConfig()) },
	"clean-build":                      func() error { return cleanBuildOutputs(defaultCleanConfig()) },
	"clean-frontend":                   func() error { return cleanFrontendOutputs(defaultCleanConfig()) },
	"config":                           func() error { return writeProjectConfig(os.Stdout) },
	"fmt":                              checkGoFormatting,
	"go-mod-update":                    updateDirectGoModules,
	"go-mod-update-check":              checkDirectGoModuleUpdates,
	"install-unsigned":                 runUnsignedInstall,
	"prepare-release-updater-manifest": runReleaseUpdaterManifestPreparation,
	"product-name":                     func() error { return writeConfiguredProductName(os.Stdout) },
	"release-app":                      publishConfiguredRelease,
	"release-artifact-name":            writeConfiguredReleaseArtifactName,
	"release-site":                     publishConfiguredSiteVersion,
	"reset":                            resetConfiguredAppState,
	"validate-macos-updater":           runMacOSUpdaterArchiveValidation,
	"validate-release-tag":             validateConfiguredReleaseTag,
}

func writeConfiguredReleaseArtifactName() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read release artifact metadata: %w", err)
	}
	name, err := releaseArtifactName(
		metadata,
		os.Getenv("GOOS"),
		os.Getenv("GOARCH"),
		os.Getenv("RELEASE_FORMAT"),
	)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(os.Stdout, name)
	return err
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("%s", projectUsage)
	}
	command, exists := projectCommands[args[0]]
	if !exists {
		return fmt.Errorf("unknown project command %q", args[0])
	}
	return command()
}

func writeConfiguredBinaryName() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read app name: %w", err)
	}
	name, err := projectBinaryName(metadata)
	if err != nil {
		return fmt.Errorf("read app name: %w", err)
	}
	_, err = fmt.Fprintln(os.Stdout, name)
	return err
}

func writeConfiguredProductName(output io.Writer) error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read product name: %w", err)
	}
	name, err := projectProductName(metadata)
	if err != nil {
		return fmt.Errorf("read product name: %w", err)
	}
	_, err = fmt.Fprintln(output, name)
	return err
}

func generateConfiguredBuildMetadata() error {
	_, err := generateBuildMetadata(buildMetadataOptions{
		ConfigPath: projectConfigPath,
		EnvPath:    projectEnvPath,
		OutputPath: projectManifestPath,
		Summary:    os.Stdout,
	})
	return err
}

func publishConfiguredRelease() error {
	if err := loadDotEnv(projectEnvPath); err != nil {
		return err
	}
	if err := validateConfiguredReleaseTag(); err != nil {
		return err
	}
	facts, err := loadProjectFacts()
	if err != nil {
		return fmt.Errorf("read app version: %w", err)
	}
	return publishRelease(newReleaseConfig(facts))
}

func publishConfiguredSiteVersion() error {
	if err := loadDotEnv(projectEnvPath); err != nil {
		return err
	}
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read app version: %w", err)
	}
	return publishSiteVersion(metadata.Info.Version)
}

func resetConfiguredAppState() error {
	directories, resetErr := resetAppState(projectAppShortName)
	for _, directory := range directories {
		fmt.Println(directory)
	}
	return resetErr
}
