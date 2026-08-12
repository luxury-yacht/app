package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/luxury-yacht/app/internal/projecttools"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: project <backend-coverage|bindings|clean-all|clean-build|clean-frontend|config|fmt|go-mod-update|go-mod-update-check|release-app|release-site|reset>")
	}

	config, err := projecttools.NewBuildConfigFromDotEnv(".env")
	if err != nil {
		return err
	}

	switch args[0] {
	case "backend-coverage":
		return projecttools.RunBackendCoverage()
	case "bindings":
		return projecttools.CheckWailsBindings(config)
	case "clean-all":
		return projecttools.CleanAllOutputs(config)
	case "clean-build":
		return projecttools.CleanBuildOutputs(config)
	case "clean-frontend":
		return projecttools.CleanFrontendOutputs(config)
	case "config":
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(config)
	case "fmt":
		return projecttools.CheckGoFormatting()
	case "go-mod-update":
		return projecttools.UpdateDirectGoModules(projecttools.CommandOutput, projecttools.RunCommand)
	case "go-mod-update-check":
		return projecttools.CheckDirectGoModuleUpdates()
	case "release-app":
		return projecttools.PublishRelease(config)
	case "release-site":
		return projecttools.PublishSiteVersion(config)
	case "reset":
		directories, resetErr := projecttools.ResetAppState(config.AppShortName)
		for _, directory := range directories {
			fmt.Println(directory)
		}
		return resetErr
	default:
		return fmt.Errorf("unknown project command %q", args[0])
	}
}
