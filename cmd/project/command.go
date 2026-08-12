package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// toolCommand builds an exec.Cmd for a build tool, resolving it to an absolute
// path first. Passing a bare name would leave the binary chosen by whatever
// PATH happens to be set when the build runs; resolving up front pins the
// choice and turns a missing tool into a named error instead of an opaque
// "executable file not found" from the eventual Run.
func toolCommand(name string, args ...string) (*exec.Cmd, error) {
	resolved, err := exec.LookPath(name)
	if err != nil {
		return nil, fmt.Errorf("%s not found in PATH: %w", name, err)
	}
	return exec.Command(resolved, args...), nil
}

// runCommand executes a project tool with terminal streams attached.
func runCommand(name string, args ...string) error {
	cmd, err := toolCommand(name, args...)
	if err != nil {
		return err
	}
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("run %s: %w", name, err)
	}
	return nil
}

// commandOutput executes a project tool and returns trimmed standard output.
func commandOutput(name string, args ...string) (string, error) {
	cmd, err := toolCommand(name, args...)
	if err != nil {
		return "", err
	}
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("run %s: %w", name, err)
	}
	return strings.TrimSpace(string(output)), nil
}

// gitRevParse returns the short git commit hash of the current HEAD.
func gitRevParse() string {
	cmd, err := toolCommand("git", "rev-parse", "--short=9", "HEAD")
	if err != nil {
		return ""
	}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
