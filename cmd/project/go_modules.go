package main

import (
	"fmt"
	"strings"
)

const directGoModuleUpdatesTemplate = `{{if and (not .Main) (not .Indirect) .Update}}{{.Path}}@{{.Update.Version}}{{end}}`

// updateDirectGoModules updates every outdated direct requirement in the main
// module, including requirements used only by non-root packages and generators.
func updateDirectGoModules() error {
	availableUpdates, err := commandOutput(
		"go",
		"list",
		"-u",
		"-m",
		"-f",
		directGoModuleUpdatesTemplate,
		"all",
	)
	if err != nil {
		return fmt.Errorf("list direct Go module updates: %w", err)
	}

	modules := strings.Fields(availableUpdates)
	if len(modules) > 0 {
		args := append([]string{"get"}, modules...)
		if err := runCommand("go", args...); err != nil {
			return fmt.Errorf("update direct Go modules: %w", err)
		}
	}

	if err := runCommand("go", "mod", "tidy"); err != nil {
		return fmt.Errorf("tidy Go modules: %w", err)
	}
	return nil
}

// checkDirectGoModuleUpdates prints available updates for direct requirements.
func checkDirectGoModuleUpdates() error {
	output, err := commandOutput(
		"go",
		"list",
		"-u",
		"-m",
		"-f",
		`{{if and (not .Indirect) .Update}}{{.Path}} {{.Version}} → {{.Update.Version}}{{end}}`,
		"all",
	)
	if err != nil {
		return err
	}
	if strings.TrimSpace(output) != "" {
		fmt.Println(output)
	}
	return nil
}
