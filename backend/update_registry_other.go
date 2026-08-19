//go:build !windows

package backend

func reconcileWindowsDisplayVersion(string) error {
	return nil
}
