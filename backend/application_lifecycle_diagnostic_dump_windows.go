//go:build windows

package backend

import "context"

// startDiagnosticDumpHandler is a no-op on Windows: the goroutine-dump diagnostic is
// driven by SIGUSR1, which does not exist there.
func (a *ApplicationLifecycle) startDiagnosticDumpHandler(context.Context) {
	// Windows has no SIGUSR1 diagnostic signal to register.
}
