package backend

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const kubeconfigWatcherDebounceInterval = 500 * time.Millisecond

// watchedPath describes a watched directory and an optional filename filter.
type watchedPath struct {
	dir         string
	filterFiles map[string]struct{}
}

type kubeconfigWatcher struct {
	app       *App
	watcher   *fsnotify.Watcher
	onChange  func([]string)
	stopCh    chan struct{}
	stoppedCh chan struct{}

	mu          sync.Mutex
	watched     []watchedPath
	fileFilters map[string]map[string]struct{}
}

func newKubeconfigWatcher(app *App, onChange func([]string)) (*kubeconfigWatcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &kubeconfigWatcher{
		app:         app,
		watcher:     fsWatcher,
		onChange:    onChange,
		stopCh:      make(chan struct{}),
		stoppedCh:   make(chan struct{}),
		fileFilters: make(map[string]map[string]struct{}),
	}

	go w.eventLoop()
	return w, nil
}

func (w *kubeconfigWatcher) eventLoop() {
	defer close(w.stoppedCh)

	var debounceTimer *time.Timer
	var debounceCh <-chan time.Time
	changedPaths := make(map[string]struct{})

	flush := func() {
		if len(changedPaths) == 0 || w.onChange == nil {
			return
		}
		paths := make([]string, 0, len(changedPaths))
		for p := range changedPaths {
			paths = append(paths, p)
		}
		changedPaths = make(map[string]struct{})
		w.onChange(paths)
	}

	for {
		select {
		case <-w.stopCh:
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			return

		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if !isRelevantFSEvent(event) {
				continue
			}

			filename := filepath.Base(event.Name)
			dir := filepath.Dir(event.Name)

			w.mu.Lock()
			if filters, hasFilters := w.fileFilters[dir]; hasFilters {
				if _, accepted := filters[filename]; !accepted {
					w.mu.Unlock()
					continue
				}
			} else if shouldSkipKubeconfigName(filename) {
				w.mu.Unlock()
				continue
			}
			w.mu.Unlock()

			changedPaths[filepath.Clean(event.Name)] = struct{}{}
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.NewTimer(kubeconfigWatcherDebounceInterval)
			debounceCh = debounceTimer.C

		case _, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			if w.app != nil && w.app.logger != nil {
				w.app.logger.Warn("kubeconfig watcher error", "KubeconfigWatcher")
			}

		case <-debounceCh:
			debounceCh = nil
			flush()
		}
	}
}

func isRelevantFSEvent(event fsnotify.Event) bool {
	return event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Rename|fsnotify.Remove) != 0
}

func (w *kubeconfigWatcher) updateWatchedPaths(paths []watchedPath) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	currentDirs := make(map[string]struct{}, len(w.watched))
	for _, wp := range w.watched {
		currentDirs[wp.dir] = struct{}{}
	}

	type mergedEntry struct {
		dir         string
		filterFiles map[string]struct{}
		unfiltered  bool
	}
	merged := make(map[string]*mergedEntry, len(paths))
	for _, wp := range paths {
		info, err := os.Stat(wp.dir)
		if err != nil || !info.IsDir() {
			continue
		}

		entry, ok := merged[wp.dir]
		if !ok {
			entry = &mergedEntry{dir: wp.dir}
			merged[wp.dir] = entry
		}

		if len(wp.filterFiles) == 0 {
			entry.unfiltered = true
			entry.filterFiles = nil
			continue
		}
		if entry.unfiltered {
			continue
		}
		if entry.filterFiles == nil {
			entry.filterFiles = make(map[string]struct{})
		}
		for name := range wp.filterFiles {
			entry.filterFiles[name] = struct{}{}
		}
	}

	desiredDirs := make(map[string]struct{}, len(merged))
	for dir := range merged {
		desiredDirs[dir] = struct{}{}
	}

	for dir := range currentDirs {
		if _, ok := desiredDirs[dir]; ok {
			continue
		}
		_ = w.watcher.Remove(dir)
	}
	for dir := range desiredDirs {
		if _, ok := currentDirs[dir]; ok {
			continue
		}
		if err := w.watcher.Add(dir); err != nil && w.app != nil && w.app.logger != nil {
			w.app.logger.Warn("Failed to watch directory: "+dir, "KubeconfigWatcher")
		}
	}

	w.watched = make([]watchedPath, 0, len(merged))
	w.fileFilters = make(map[string]map[string]struct{})
	for _, entry := range merged {
		wp := watchedPath{dir: entry.dir}
		if !entry.unfiltered && entry.filterFiles != nil {
			wp.filterFiles = entry.filterFiles
			w.fileFilters[entry.dir] = entry.filterFiles
		}
		w.watched = append(w.watched, wp)
	}

	return nil
}

func (w *kubeconfigWatcher) stop() {
	select {
	case <-w.stopCh:
		return
	default:
		close(w.stopCh)
	}
	_ = w.watcher.Close()
	<-w.stoppedCh
}
