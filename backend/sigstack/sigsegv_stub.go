//go:build !linux

package sigstack

// StartPatchLoop is a no-op on non-Linux platforms.
func StartPatchLoop() {}
