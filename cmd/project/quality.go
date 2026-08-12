package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// checkGoFormatting fails with the paths that gofmt would change.
func checkGoFormatting() error {
	output, err := commandOutput("gofmt", "-l", ".")
	if err != nil {
		return err
	}
	if output != "" {
		return fmt.Errorf("these Go files are not gofmt-formatted (run `gofmt -w .`):\n%s", output)
	}
	return nil
}

// runBackendCoverage creates the report directory before invoking go test.
func runBackendCoverage() error {
	report := filepath.Join("build", "coverage", "backend.coverage.out")
	if err := os.MkdirAll(filepath.Dir(report), 0o755); err != nil {
		return fmt.Errorf("create backend coverage directory: %w", err)
	}
	return runCommand("go", "test", "./...", "-coverprofile="+report)
}
