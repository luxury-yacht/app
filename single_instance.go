package main

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const applicationProductIdentifier = "app.luxury-yacht.desktop"

// secondLaunchCoordinator holds a focus request until the named main window is
// runtime-ready. Stop is serialized with focus so shutdown cannot be followed
// by a late request that resurrects the window.
type secondLaunchCoordinator struct {
	mu       sync.Mutex
	dispatch func(func())
	focus    func()
	pending  bool
	stopped  bool
}

func newSecondLaunchCoordinator(dispatch func(func())) *secondLaunchCoordinator {
	return &secondLaunchCoordinator{dispatch: dispatch}
}

func (c *secondLaunchCoordinator) Request() {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return
	}
	if c.focus == nil {
		c.pending = true
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	c.scheduleFocus()
}

func (c *secondLaunchCoordinator) Bind(focus func()) {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return
	}
	c.focus = focus
	pending := c.pending && c.focus != nil
	c.pending = false
	c.mu.Unlock()
	if pending {
		c.scheduleFocus()
	}
}

func (c *secondLaunchCoordinator) scheduleFocus() {
	run := func() {
		c.mu.Lock()
		if c.stopped || c.focus == nil {
			c.mu.Unlock()
			return
		}
		focus := c.focus
		c.mu.Unlock()
		focus()
	}
	if c.dispatch == nil {
		run()
		return
	}
	c.dispatch(run)
}

func (c *secondLaunchCoordinator) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stopped = true
	c.pending = false
	c.focus = nil
}

func newSingleInstanceOptions(coordinator *secondLaunchCoordinator) *application.SingleInstanceOptions {
	return &application.SingleInstanceOptions{
		UniqueID: applicationProductIdentifier,
		ExitCode: 0,
		OnSecondInstanceLaunch: func(application.SecondInstanceData) {
			// Arguments, working directory, and additional data cross a local IPC
			// trust boundary. This product contract uses none of them; a subsequent
			// launch can only request that the existing window be focused.
			coordinator.Request()
		},
	}
}
