//go:build windows

package backend

import (
	"os/exec"
	"syscall"
)

// applyHiddenWindowAttr hides the console window for Windows child processes.
func applyHiddenWindowAttr(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
}
