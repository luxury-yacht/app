//go:build !windows

/*
 * backend/app_diagnostic_dump.go
 *
 * On-demand goroutine dump for diagnosing wedged states: `pkill -USR1 luxury-yacht`
 * writes every goroutine's stack to a file without stopping the app. Exists because
 * the app logger is an in-memory ring (not stderr) and a wails-dev child's stderr is
 * not reliably capturable, so SIGQUIT dumps are effectively lost.
 */

package backend

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// goroutineDumpEnvVar opts the SIGUSR1 dump handler in for one run:
// `ENABLE_GOROUTINE_DUMP=true wails dev`. Default off — the handler is a debugging
// instrument, not a standing production feature.
const goroutineDumpEnvVar = "ENABLE_GOROUTINE_DUMP"

// goroutineDumpEnabled reports whether an env value opts the dump handler in. Only an
// explicit boolean true ("true", "1", …) enables it; unset or garbage stays off.
func goroutineDumpEnabled(value string) bool {
	enabled, err := strconv.ParseBool(value)
	return err == nil && enabled
}

// startGoroutineDumpOnSignal arms a SIGUSR1 handler that writes every goroutine's stack
// to a timestamped file in dir. It takes no application locks — runtime.Stack is
// runtime-level — so it works precisely when the app's own mutexes are wedged. The
// handler goroutine exits when ctx is cancelled. signal.Notify is called synchronously
// so the handler is armed when this returns; the channel buffers one signal so nothing
// is lost before the goroutine first receives.
func startGoroutineDumpOnSignal(ctx context.Context, dir string, logf func(string)) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGUSR1)
	// Announce the PID so the operator can target the signal exactly (`kill -USR1 <pid>`)
	// from the app log instead of guessing process names — SIGUSR1 kills any process
	// without a handler, so broad pkill patterns are dangerous.
	logf(fmt.Sprintf("goroutine dump armed: pid %d — `kill -USR1 %d` writes all goroutine stacks to %s", os.Getpid(), os.Getpid(), dir))
	go func() {
		defer signal.Stop(ch)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ch:
				path, err := writeGoroutineDump(dir)
				if err != nil {
					logf(fmt.Sprintf("goroutine dump failed: %v", err))
					continue
				}
				logf(fmt.Sprintf("goroutine dump written to %s", path))
			}
		}
	}()
}

// writeGoroutineDump writes all goroutine stacks to a timestamped file in dir, growing
// the buffer until runtime.Stack(all=true) fits — a wedged app can hold thousands of
// goroutines. Capped so a diagnostic can never allocate unboundedly; a truncated dump
// still names the lock holders.
func writeGoroutineDump(dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	buf := make([]byte, 1<<20)
	for {
		n := runtime.Stack(buf, true)
		if n < len(buf) || len(buf) >= 1<<28 {
			buf = buf[:n]
			break
		}
		buf = make([]byte, len(buf)*2)
	}
	path := filepath.Join(dir, fmt.Sprintf("goroutines-%s.txt", time.Now().Format("20060102-150405.000")))
	if err := os.WriteFile(path, buf, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// diagnosticsDumpDir is where SIGUSR1 goroutine dumps land. The user cache dir keeps
// them off the repo and readable without elevated permissions (macOS:
// ~/Library/Caches/luxury-yacht/diagnostics).
func diagnosticsDumpDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "luxury-yacht", "diagnostics")
}

// startDiagnosticDumpHandler arms the SIGUSR1 goroutine-dump diagnostic for the app's
// lifetime, logging each dump's path to the app log so it is visible in the log viewer.
// Opt-in per run: it arms only when ENABLE_GOROUTINE_DUMP is truthy (default off), so
// the `goroutine dump armed` log line doubles as confirmation the opt-in took effect.
func (a *App) startDiagnosticDumpHandler(ctx context.Context) {
	if !goroutineDumpEnabled(os.Getenv(goroutineDumpEnvVar)) {
		return
	}
	startGoroutineDumpOnSignal(ctx, diagnosticsDumpDir(), func(msg string) {
		a.logger.Info(msg, logsources.App)
	})
}
