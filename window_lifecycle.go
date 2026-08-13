package main

import (
	"fmt"
	"sync"
)

// workspaceWindowLifecycle tracks peer windows independently of Wails' native
// window map so the last-close decision is explicit and unit-testable.
type workspaceWindowLifecycle struct {
	mu      sync.Mutex
	next    uint64
	windows map[string]bool
	recent  []string
}

func newWorkspaceWindowLifecycle() *workspaceWindowLifecycle {
	return &workspaceWindowLifecycle{windows: make(map[string]bool)}
}

func (l *workspaceWindowLifecycle) Add() string {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.next++
	name := fmt.Sprintf("workspace-%d", l.next)
	l.windows[name] = true
	l.touchLocked(name)
	return name
}

func (l *workspaceWindowLifecycle) Focus(name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows[name] {
		l.touchLocked(name)
	}
}

func (l *workspaceWindowLifecycle) BeginClose(name string) (int, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.windows[name] {
		return len(l.windows), false
	}
	delete(l.windows, name)
	return len(l.windows), true
}

func (l *workspaceWindowLifecycle) CancelClose(name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows[name] {
		return
	}
	l.windows[name] = true
	l.touchLocked(name)
}

func (l *workspaceWindowLifecycle) Count() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.windows)
}

func (l *workspaceWindowLifecycle) MostRecent() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	for i := len(l.recent) - 1; i >= 0; i-- {
		if l.windows[l.recent[i]] {
			return l.recent[i]
		}
	}
	return ""
}

func (l *workspaceWindowLifecycle) touchLocked(name string) {
	for index, recentName := range l.recent {
		if recentName == name {
			l.recent = append(l.recent[:index], l.recent[index+1:]...)
			break
		}
	}
	l.recent = append(l.recent, name)
}
