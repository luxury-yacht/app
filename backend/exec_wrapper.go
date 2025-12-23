package backend

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"k8s.io/client-go/rest"
)

const execWrapperFlag = "--ly-exec-wrapper"

// MaybeRunExecWrapper runs the requested exec helper and exits when invoked in wrapper mode.
func MaybeRunExecWrapper() {
	command, args, ok := parseExecWrapperArgs(os.Args)
	if !ok {
		return
	}

	os.Exit(runExecWrapper(command, args))
}

// parseExecWrapperArgs extracts the helper command and args from the wrapper invocation.
func parseExecWrapperArgs(args []string) (string, []string, bool) {
	if len(args) < 3 {
		return "", nil, false
	}
	if args[1] != execWrapperFlag {
		return "", nil, false
	}
	command := strings.TrimSpace(args[2])
	if command == "" {
		return "", nil, false
	}
	return command, args[3:], true
}

// runExecWrapper executes the helper command while preserving stdio.
func runExecWrapper(command string, args []string) int {
	cmd := exec.Command(command, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	applyHiddenWindowAttr(cmd)

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode()
		}
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	return 0
}

// wrapExecProviderForWindows routes exec helpers through this binary on Windows.
func wrapExecProviderForWindows(config *rest.Config) {
	if runtime.GOOS != "windows" || config == nil || config.ExecProvider == nil {
		return
	}

	originalCommand := strings.TrimSpace(config.ExecProvider.Command)
	if originalCommand == "" {
		return
	}
	if isExecWrapperConfigured(config.ExecProvider.Args) {
		return
	}

	exePath, err := os.Executable()
	if err != nil || exePath == "" {
		return
	}
	if sameExecutablePath(exePath, originalCommand) {
		return
	}

	originalArgs := append([]string{}, config.ExecProvider.Args...)
	config.ExecProvider.Command = exePath
	config.ExecProvider.Args = append([]string{execWrapperFlag, originalCommand}, originalArgs...)
}

// isExecWrapperConfigured reports whether the wrapper args are already present.
func isExecWrapperConfigured(args []string) bool {
	return len(args) > 0 && args[0] == execWrapperFlag
}

// sameExecutablePath compares executable paths with Windows casing rules.
func sameExecutablePath(left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}
