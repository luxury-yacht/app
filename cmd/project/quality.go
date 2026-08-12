package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CheckGoFormatting fails with the paths that gofmt would change.
func CheckGoFormatting() error {
	output, err := CommandOutput("gofmt", "-l", ".")
	if err != nil {
		return err
	}
	if output != "" {
		return fmt.Errorf("these Go files are not gofmt-formatted (run `gofmt -w .`):\n%s", output)
	}
	return nil
}

// CheckDirectGoModuleUpdates prints available updates for direct requirements.
func CheckDirectGoModuleUpdates() error {
	output, err := CommandOutput(
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

// RunBackendCoverage creates the report directory before invoking go test.
func RunBackendCoverage() error {
	report := filepath.Join("build", "coverage", "backend.coverage.out")
	if err := os.MkdirAll(filepath.Dir(report), 0o755); err != nil {
		return fmt.Errorf("create backend coverage directory: %w", err)
	}
	return RunCommand("go", "test", "./...", "-coverprofile="+report)
}
