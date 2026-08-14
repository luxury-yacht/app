package updatetemp

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var helperLogName = regexp.MustCompile(`^wails-update-[0-9]+\.log$`)

// SweepOrphans removes unreferenced Wails staging directories and helper logs
// directly below a previously validated application-owned temp root.
func SweepOrphans(root string, protectedPaths []string) ([]string, error) {
	root = filepath.Clean(root)
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return nil, fmt.Errorf("inspect updater temp root before sweep: %w", err)
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil, fmt.Errorf("updater temp root must be a non-symlink directory: %s", root)
	}

	protected := make(map[string]struct{}, len(protectedPaths))
	for _, path := range protectedPaths {
		path = filepath.Clean(path)
		if !isDirectUpdaterChild(root, path) {
			return nil, fmt.Errorf("protected updater path must be a direct child of the owned root: %s", path)
		}
		protected[path] = struct{}{}
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read updater temp root: %w", err)
	}
	removed := make([]string, 0)
	var failures []error
	for _, entry := range entries {
		path := filepath.Join(root, entry.Name())
		if _, keep := protected[path]; keep {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			failures = append(failures, fmt.Errorf("inspect updater temp child %s: %w", path, infoErr))
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		remove := info.IsDir() && strings.HasPrefix(entry.Name(), "wails-update-")
		remove = remove || info.Mode().IsRegular() && helperLogName.MatchString(entry.Name())
		if !remove {
			continue
		}
		if removeErr := os.RemoveAll(path); removeErr != nil {
			failures = append(failures, fmt.Errorf("remove orphaned updater path %s: %w", path, removeErr))
			continue
		}
		removed = append(removed, path)
	}
	return removed, errors.Join(failures...)
}

func isDirectUpdaterChild(root, path string) bool {
	if !filepath.IsAbs(root) || !filepath.IsAbs(path) || filepath.Dir(path) != root {
		return false
	}
	return strings.HasPrefix(filepath.Base(path), "wails-update-")
}
