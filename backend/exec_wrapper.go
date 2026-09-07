package backend

import (
	"fmt"
	"io"
	"os"
	"os/exec"
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
	diagnosticPath := os.Getenv(execDiagnosticFileEnv)
	_ = os.Unsetenv(execDiagnosticFileEnv)
	var stderr diagnosticStderr
	cmd := newExecWrapperCommand(command, args)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = io.MultiWriter(os.Stderr, &stderr)
	applyHiddenWindowAttr(cmd)

	err := cmd.Run()
	stderr.publish(diagnosticPath, err)
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode()
		}
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	return 0
}

func newExecWrapperCommand(command string, args []string) *exec.Cmd {
	return exec.Command(command, args...)
}

// execDisplayCommand returns the kubeconfig exec credential command suitable for
// display, or "" when the config declares no exec provider. The exec
// provider is rewritten to run through this binary to capture scoped diagnostics;
// in that case the original helper command is recovered from the wrapper args so
// diagnostics show the real credential helper, not the app executable.
func execDisplayCommand(config *rest.Config) string {
	if config == nil || config.ExecProvider == nil {
		return ""
	}
	args := config.ExecProvider.Args
	if isExecWrapperConfigured(args) && len(args) >= 2 {
		return strings.TrimSpace(args[1])
	}
	return strings.TrimSpace(config.ExecProvider.Command)
}

// isExecWrapperConfigured reports whether the wrapper args are already present.
func isExecWrapperConfigured(args []string) bool {
	return len(args) > 0 && args[0] == execWrapperFlag
}
