package mage

import (
	"fmt"
	"strings"
)

const directGoModuleUpdatesTemplate = `{{if and (not .Main) (not .Indirect) .Update}}{{.Path}}@{{.Update.Version}}{{end}}`

// UpdateDirectGoModules updates every outdated direct requirement in the main
// module, including requirements used only by non-root packages and generators.
func UpdateDirectGoModules(
	output func(string, ...string) (string, error),
	run func(string, ...string) error,
) error {
	availableUpdates, err := output(
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
		if err := run("go", args...); err != nil {
			return fmt.Errorf("update direct Go modules: %w", err)
		}
	}

	if err := run("go", "mod", "tidy"); err != nil {
		return fmt.Errorf("tidy Go modules: %w", err)
	}
	return nil
}
