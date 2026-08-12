package main

import (
	"encoding/json"
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
		return fmt.Errorf("usage: project <backend-coverage|bindings|build-metadata|clean-all|clean-build|clean-frontend|config|fmt|go-mod-update|go-mod-update-check|release-app|release-site|reset|windows-version>")
	}

	config, err := NewBuildConfigFromDotEnv(".env")
	if err != nil {
		return err
	}

	switch args[0] {
	case "backend-coverage":
		return RunBackendCoverage()
	case "bindings":
		return CheckWailsBindings(config)
	case "build-metadata":
		_, err := generateBuildMetadata(buildMetadataOptions{
			ConfigPath: "build/config.yml",
			EnvPath:    ".env",
			OutputPath: "backend/buildinfo/generated.json",
			Summary:    os.Stdout,
		})
		return err
	case "clean-all":
		return CleanAllOutputs(config)
	case "clean-build":
		return CleanBuildOutputs(config)
	case "clean-frontend":
		return CleanFrontendOutputs(config)
	case "config":
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(config)
	case "fmt":
		return CheckGoFormatting()
	case "go-mod-update":
		return UpdateDirectGoModules(CommandOutput, RunCommand)
	case "go-mod-update-check":
		return CheckDirectGoModuleUpdates()
	case "release-app":
		return PublishRelease(config)
	case "release-site":
		return PublishSiteVersion(config)
	case "reset":
		directories, resetErr := ResetAppState(config.AppShortName)
		for _, directory := range directories {
			fmt.Println(directory)
		}
		return resetErr
	case "windows-version":
		return WriteWindowsVersion(os.Stdout, config.Version)
	default:
		return fmt.Errorf("unknown project command %q", args[0])
	}
}
