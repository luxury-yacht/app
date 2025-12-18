//go:build linux

package sigstack

/*
#include <signal.h>
#include <errno.h>

// ensure_sigsegv_onstack re-applies the current SIGSEGV handler with SA_ONSTACK
// if it was installed without that flag. Go requires SA_ONSTACK when a C
// library (WebKitGTK) installs its own SIGSEGV handler; otherwise the runtime
// aborts with "handler not on signal stack".
static int ensure_sigsegv_onstack() {
	struct sigaction current;
	if (sigaction(SIGSEGV, NULL, &current) != 0) {
		return errno;
	}

	if ((current.sa_flags & SA_ONSTACK) != 0) {
		return 0; // already safe
	}

	struct sigaction patched = current;
	patched.sa_flags |= SA_ONSTACK;
	if (sigaction(SIGSEGV, &patched, NULL) != 0) {
		return errno;
	}

	return 0;
}
*/
import "C"

import (
	"fmt"
	"syscall"
	"time"
)

// ReapplySigsegvOnstack nudges the current SIGSEGV handler to opt into SA_ONSTACK.
// We repeat a few times to catch libraries that install their handler later in
// startup (for example WebKitGTK inside Wails).
func ReapplySigsegvOnstack() error {
	if errno := C.ensure_sigsegv_onstack(); errno != 0 {
		return fmt.Errorf("sigaction(SIGSEGV) SA_ONSTACK patch failed: %w", syscall.Errno(errno))
	}
	return nil
}

// StartPatchLoop runs a short-lived loop that repeatedly reapplies SA_ONSTACK to
// the current SIGSEGV handler. Intended for Linux dev runs to avoid WebKitGTK
// installing a handler without SA_ONSTACK and crashing the Go runtime.
func StartPatchLoop() {
	go func() {
		const attempts = 5
		for i := 0; i < attempts; i++ {
			_ = ReapplySigsegvOnstack()
			time.Sleep(500 * time.Millisecond)
		}
	}()
}
