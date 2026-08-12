package main

import (
	"fmt"
	"os"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: project <backend-coverage|bindings|build-metadata|clean-all|clean-build|clean-frontend|config|fmt|go-mod-update|go-mod-update-check|release-app|release-site|reset|version|windows-version>")
	}

	switch args[0] {
	case "backend-coverage":
		return runBackendCoverage()
	case "bindings":
		return checkWailsBindings()
	case "build-metadata":
		_, err := generateBuildMetadata(buildMetadataOptions{
			ConfigPath: projectConfigPath,
			EnvPath:    projectEnvPath,
			OutputPath: projectManifestPath,
			Summary:    os.Stdout,
		})
		return err
	case "clean-all":
		return cleanAllOutputs(defaultCleanConfig())
	case "clean-build":
		return cleanBuildOutputs(defaultCleanConfig())
	case "clean-frontend":
		return cleanFrontendOutputs(defaultCleanConfig())
	case "config":
		return writeProjectConfig(os.Stdout)
	case "fmt":
		return checkGoFormatting()
	case "go-mod-update":
		return updateDirectGoModules()
	case "go-mod-update-check":
		return checkDirectGoModuleUpdates()
	case "release-app":
		if err := loadDotEnv(projectEnvPath); err != nil {
			return err
		}
		facts, err := loadProjectFacts()
		if err != nil {
			return fmt.Errorf("read app version: %w", err)
		}
		return publishRelease(newReleaseConfig(facts))
	case "release-site":
		if err := loadDotEnv(projectEnvPath); err != nil {
			return err
		}
		metadata, err := readProjectMetadata(projectConfigPath)
		if err != nil {
			return fmt.Errorf("read app version: %w", err)
		}
		return publishSiteVersion(metadata.Info.Version)
	case "reset":
		directories, resetErr := resetAppState(projectAppShortName)
		for _, directory := range directories {
			fmt.Println(directory)
		}
		return resetErr
	case "version":
		metadata, err := readProjectMetadata(projectConfigPath)
		if err != nil {
			return fmt.Errorf("read app version: %w", err)
		}
		return writeProjectVersion(os.Stdout, metadata.Info.Version)
	case "windows-version":
		metadata, err := readProjectMetadata(projectConfigPath)
		if err != nil {
			return fmt.Errorf("read app version: %w", err)
		}
		return writeWindowsVersion(os.Stdout, metadata.Info.Version)
	default:
		return fmt.Errorf("unknown project command %q", args[0])
	}
}
