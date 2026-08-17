package backend

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// watchedPath describes a watched directory and an optional filename filter.
type watchedPath struct {
	dir         string
	filterFiles map[string]struct{}
}

type kubeconfigWatchDebounce struct {
	timer        *time.Timer
	timerChannel <-chan time.Time
	changedPaths map[string]struct{}
}

type mergedWatchedPath struct {
	dir         string
	filterFiles map[string]struct{}
	unfiltered  bool
}

type kubeconfigWatcher struct {
	logger    *Logger
	watcher   *fsnotify.Watcher
	onChange  func([]string)
	stopCh    chan struct{}
	stoppedCh chan struct{}

	mu          sync.Mutex
	watched     []watchedPath
	fileFilters map[string]map[string]struct{}
}

func newKubeconfigWatcher(logger *Logger, onChange func([]string)) (*kubeconfigWatcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &kubeconfigWatcher{
		logger:      logger,
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
	debounce := newKubeconfigWatchDebounce()

	for {
		select {
		case <-w.stopCh:
			debounce.stop()
			return

		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if isRelevantFSEvent(event) && w.acceptsEventPath(event.Name) {
				debounce.record(event.Name)
			}

		case _, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			w.logWatcherError()

		case <-debounce.timerChannel:
			debounce.flush(w.onChange)
		}
	}
}

func (w *kubeconfigWatcher) logWatcherError() {
	if w.logger != nil {
		w.logger.Warn("kubeconfig watcher error", logsources.KubeconfigWatcher)
	}
}

func newKubeconfigWatchDebounce() *kubeconfigWatchDebounce {
	return &kubeconfigWatchDebounce{changedPaths: make(map[string]struct{})}
}

func (d *kubeconfigWatchDebounce) record(path string) {
	d.changedPaths[filepath.Clean(path)] = struct{}{}
	if d.timer != nil {
		d.timer.Stop()
	}
	d.timer = time.NewTimer(config.KubeconfigWatcherDebounceInterval)
	d.timerChannel = d.timer.C
}

func (d *kubeconfigWatchDebounce) flush(onChange func([]string)) {
	d.timerChannel = nil
	if len(d.changedPaths) == 0 || onChange == nil {
		return
	}

	paths := make([]string, 0, len(d.changedPaths))
	for path := range d.changedPaths {
		paths = append(paths, path)
	}
	d.changedPaths = make(map[string]struct{})
	onChange(paths)
}

func (d *kubeconfigWatchDebounce) stop() {
	if d.timer != nil {
		d.timer.Stop()
	}
}

func (w *kubeconfigWatcher) acceptsEventPath(path string) bool {
	filename := filepath.Base(path)
	dir := filepath.Dir(path)

	w.mu.Lock()
	defer w.mu.Unlock()
	filters, hasFilters := w.fileFilters[dir]
	if !hasFilters {
		return !shouldSkipKubeconfigName(filename)
	}
	_, accepted := filters[filename]
	return accepted
}

func isRelevantFSEvent(event fsnotify.Event) bool {
	return event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Rename|fsnotify.Remove) != 0
}

func (w *kubeconfigWatcher) updateWatchedPaths(paths []watchedPath) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	currentDirs := watchedPathDirectories(w.watched)
	merged := mergeWatchedPaths(paths)
	desiredDirs := mergedWatchedPathDirectories(merged)
	w.reconcileWatchedDirectories(currentDirs, desiredDirs)
	w.replaceWatchedPaths(merged)
	return nil
}

func mergeWatchedPaths(paths []watchedPath) map[string]*mergedWatchedPath {
	merged := make(map[string]*mergedWatchedPath, len(paths))
	for _, wp := range paths {
		info, err := os.Stat(wp.dir)
		if err != nil || !info.IsDir() {
			continue
		}

		entry, ok := merged[wp.dir]
		if !ok {
			entry = &mergedWatchedPath{dir: wp.dir}
			merged[wp.dir] = entry
		}
		mergeWatchedPathFilters(entry, wp.filterFiles)
	}
	return merged
}

func mergeWatchedPathFilters(entry *mergedWatchedPath, filters map[string]struct{}) {
	if len(filters) == 0 {
		entry.unfiltered = true
		entry.filterFiles = nil
		return
	}
	if entry.unfiltered {
		return
	}
	if entry.filterFiles == nil {
		entry.filterFiles = make(map[string]struct{})
	}
	for name := range filters {
		entry.filterFiles[name] = struct{}{}
	}
}

func watchedPathDirectories(paths []watchedPath) map[string]struct{} {
	directories := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		directories[path.dir] = struct{}{}
	}
	return directories
}

func mergedWatchedPathDirectories(paths map[string]*mergedWatchedPath) map[string]struct{} {
	directories := make(map[string]struct{}, len(paths))
	for dir := range paths {
		directories[dir] = struct{}{}
	}
	return directories
}

func (w *kubeconfigWatcher) reconcileWatchedDirectories(currentDirs, desiredDirs map[string]struct{}) {
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
		if err := w.watcher.Add(dir); err != nil && w.logger != nil {
			w.logger.Warn("Failed to watch directory: "+dir, logsources.KubeconfigWatcher)
		}
	}
}

func (w *kubeconfigWatcher) replaceWatchedPaths(merged map[string]*mergedWatchedPath) {
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
