package backend

type fakeDesktop struct {
	emitEvent                func(string, ...any) bool
	showErrorDialog          func(string, string)
	openFile                 func(OpenFileDialogOptions) (string, error)
	saveFile                 func(SaveFileDialogOptions) (string, error)
	openDirectory            func(OpenFileDialogOptions) (string, error)
	clipboardText            func() (string, error)
	refreshMenu              func() error
	hideApplication          func()
	quitApplication          func()
	showMainWindow           func() error
	setMainWindowSize        func(int, int) error
	setMainWindowPosition    func(int, int) error
	minimiseMainWindow       func() error
	maximiseMainWindow       func() error
	restoreMainWindow        func() error
	toggleMainWindowMaximise func() error
	bringMainWindowToFront   func() error
	mainWindowGeometry       func() (WindowGeometry, error)
	mainWindowWorkAreas      func() []WindowWorkArea
}

func (d *fakeDesktop) EmitEvent(name string, data ...any) bool {
	if d.emitEvent != nil {
		return d.emitEvent(name, data...)
	}
	return true
}

func (d *fakeDesktop) ShowErrorDialog(title, message string) {
	if d.showErrorDialog != nil {
		d.showErrorDialog(title, message)
	}
}

func (d *fakeDesktop) OpenFile(options OpenFileDialogOptions) (string, error) {
	if d.openFile != nil {
		return d.openFile(options)
	}
	return "", nil
}

func (d *fakeDesktop) SaveFile(options SaveFileDialogOptions) (string, error) {
	if d.saveFile != nil {
		return d.saveFile(options)
	}
	return "", nil
}

func (d *fakeDesktop) OpenDirectory(options OpenFileDialogOptions) (string, error) {
	if d.openDirectory != nil {
		return d.openDirectory(options)
	}
	return "", nil
}

func (d *fakeDesktop) ClipboardText() (string, error) {
	if d.clipboardText != nil {
		return d.clipboardText()
	}
	return "", nil
}

func (d *fakeDesktop) RefreshMenu() error {
	if d.refreshMenu != nil {
		return d.refreshMenu()
	}
	return nil
}

func (d *fakeDesktop) HideApplication() {
	if d.hideApplication != nil {
		d.hideApplication()
	}
}

func (d *fakeDesktop) QuitApplication() {
	if d.quitApplication != nil {
		d.quitApplication()
	}
}

func (d *fakeDesktop) ShowMainWindow() error {
	if d.showMainWindow != nil {
		return d.showMainWindow()
	}
	return nil
}

func (d *fakeDesktop) SetMainWindowSize(width, height int) error {
	if d.setMainWindowSize != nil {
		return d.setMainWindowSize(width, height)
	}
	return nil
}

func (d *fakeDesktop) SetMainWindowPosition(x, y int) error {
	if d.setMainWindowPosition != nil {
		return d.setMainWindowPosition(x, y)
	}
	return nil
}

func (d *fakeDesktop) MinimiseMainWindow() error {
	if d.minimiseMainWindow != nil {
		return d.minimiseMainWindow()
	}
	return nil
}

func (d *fakeDesktop) MaximiseMainWindow() error {
	if d.maximiseMainWindow != nil {
		return d.maximiseMainWindow()
	}
	return nil
}

func (d *fakeDesktop) RestoreMainWindow() error {
	if d.restoreMainWindow != nil {
		return d.restoreMainWindow()
	}
	return nil
}

func (d *fakeDesktop) ToggleMainWindowMaximise() error {
	if d.toggleMainWindowMaximise != nil {
		return d.toggleMainWindowMaximise()
	}
	return nil
}

func (d *fakeDesktop) BringMainWindowToFront() error {
	if d.bringMainWindowToFront != nil {
		return d.bringMainWindowToFront()
	}
	return nil
}

func (d *fakeDesktop) MainWindowGeometry() (WindowGeometry, error) {
	if d.mainWindowGeometry != nil {
		return d.mainWindowGeometry()
	}
	return WindowGeometry{}, nil
}

func (d *fakeDesktop) MainWindowWorkAreas() []WindowWorkArea {
	if d.mainWindowWorkAreas != nil {
		return d.mainWindowWorkAreas()
	}
	return []WindowWorkArea{{X: 0, Y: 0, Width: 1920, Height: 1040, Primary: true}}
}
