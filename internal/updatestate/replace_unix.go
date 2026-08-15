//go:build !windows

package updatestate

import "os"

func replaceFile(source, target string) error {
	return os.Rename(source, target)
}
