package desktop

import (
	"fmt"
	"runtime"

	"github.com/luxury-yacht/app/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const MainWindowName = "main"

type Adapter struct {
	app         *application.App
	windowName  string
	menu        *application.Menu
	menuFactory func() *backend.MenuModel
}

func NewAdapter(app *application.App, windowName string) *Adapter {
	return &Adapter{app: app, windowName: windowName}
}

func (d *Adapter) mainWindow() (application.Window, error) {
	if d == nil || d.app == nil {
		return nil, fmt.Errorf("desktop application is not available")
	}
	window, ok := d.app.Window.GetByName(d.windowName)
	if !ok {
		return nil, fmt.Errorf("window %q is not available", d.windowName)
	}
	return window, nil
}

func (d *Adapter) EmitEvent(name string, data ...any) bool {
	return d.app.Event.Emit(name, data...)
}

func (d *Adapter) ShowErrorDialog(title, message string) {
	dialog := d.app.Dialog.Error().SetTitle(title).SetMessage(message)
	if window, err := d.mainWindow(); err == nil {
		dialog.AttachToWindow(window)
	}
	dialog.Show()
}

func applicationFileFilters(filters []backend.FileFilter) []application.FileFilter {
	result := make([]application.FileFilter, 0, len(filters))
	for _, filter := range filters {
		result = append(result, application.FileFilter{
			DisplayName: filter.DisplayName,
			Pattern:     filter.Pattern,
		})
	}
	return result
}

func (d *Adapter) OpenFile(options backend.OpenFileDialogOptions) (string, error) {
	window, err := d.mainWindow()
	if err != nil {
		return "", err
	}
	return d.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		CanChooseFiles: true,
		Title:          options.Title,
		Directory:      options.Directory,
		Filters:        applicationFileFilters(options.Filters),
		Window:         window,
	}).PromptForSingleSelection()
}

func (d *Adapter) SaveFile(options backend.SaveFileDialogOptions) (string, error) {
	window, err := d.mainWindow()
	if err != nil {
		return "", err
	}
	return d.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		CanCreateDirectories: options.CanCreateDirectories,
		Title:                options.Title,
		Directory:            options.Directory,
		Filename:             options.Filename,
		Filters:              applicationFileFilters(options.Filters),
		Window:               window,
	}).PromptForSingleSelection()
}

func (d *Adapter) OpenDirectory(options backend.OpenFileDialogOptions) (string, error) {
	window, err := d.mainWindow()
	if err != nil {
		return "", err
	}
	return d.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		CanChooseDirectories: true,
		CanChooseFiles:       false,
		Title:                options.Title,
		Directory:            options.Directory,
		Filters:              applicationFileFilters(options.Filters),
		Window:               window,
	}).PromptForSingleSelection()
}

func (d *Adapter) ClipboardText() (string, error) {
	text, ok := d.app.Clipboard.Text()
	if !ok {
		return "", fmt.Errorf("clipboard text is not available")
	}
	return text, nil
}

func (d *Adapter) InitialiseMenu(factory func() *backend.MenuModel) *application.Menu {
	d.menuFactory = factory
	d.menu = application.NewMenu()
	materialiseMenu(d.menu, factory())
	d.app.Menu.SetApplicationMenu(d.menu)
	return d.menu
}

func (d *Adapter) RefreshMenu() error {
	if d.menu == nil || d.menuFactory == nil {
		return fmt.Errorf("application menu is not initialised")
	}
	d.menu.Clear()
	materialiseMenu(d.menu, d.menuFactory())

	switch runtime.GOOS {
	case "linux":
		d.menu.Update()
	case "darwin":
		d.app.Menu.SetApplicationMenu(d.menu)
	case "windows":
		window, err := d.mainWindow()
		if err != nil {
			return err
		}
		window.SetMenu(d.menu)
	}
	return nil
}

func materialiseMenu(target *application.Menu, model *backend.MenuModel) {
	if target == nil || model == nil {
		return
	}
	for _, sourceItem := range model.Items {
		if sourceItem == nil {
			continue
		}
		if sourceItem.Separator {
			target.AddSeparator()
			continue
		}
		if sourceItem.SubMenu != nil {
			materialiseMenu(target.AddSubmenu(sourceItem.Label), sourceItem.SubMenu)
			continue
		}
		item := target.Add(sourceItem.Label)
		if sourceItem.Accelerator != "" {
			item.SetAccelerator(sourceItem.Accelerator)
		}
		if sourceItem.Click != nil {
			click := sourceItem.Click
			item.OnClick(func(*application.Context) { click() })
		}
	}
}

func (d *Adapter) HideApplication() { d.app.Hide() }
func (d *Adapter) QuitApplication() { d.app.Quit() }

func (d *Adapter) ShowMainWindow() error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.Show()
	return nil
}

func (d *Adapter) SetMainWindowSize(width, height int) error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.SetSize(width, height)
	return nil
}

func (d *Adapter) SetMainWindowPosition(x, y int) error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.SetPosition(x, y)
	return nil
}

func (d *Adapter) MinimiseMainWindow() error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.Minimise()
	return nil
}

func (d *Adapter) MaximiseMainWindow() error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.Maximise()
	return nil
}

func (d *Adapter) RestoreMainWindow() error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.Restore()
	return nil
}

func (d *Adapter) ToggleMainWindowMaximise() error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.ToggleMaximise()
	return nil
}

func (d *Adapter) BringMainWindowToFront() error {
	window, err := d.mainWindow()
	if err != nil {
		return err
	}
	window.Show()
	if window.IsMinimised() {
		window.Restore()
	}
	window.Focus()
	return nil
}

func (d *Adapter) MainWindowGeometry() (backend.WindowGeometry, error) {
	window, err := d.mainWindow()
	if err != nil {
		return backend.WindowGeometry{}, err
	}
	x, y := window.Position()
	width, height := window.Size()
	return backend.WindowGeometry{
		X:         x,
		Y:         y,
		Width:     width,
		Height:    height,
		Maximised: window.IsMaximised(),
	}, nil
}

func (d *Adapter) MainWindowWorkAreas() []backend.WindowWorkArea {
	if d == nil || d.app == nil || d.app.Screen == nil {
		return nil
	}
	screens := d.app.Screen.GetAll()
	result := make([]backend.WindowWorkArea, 0, len(screens))
	for _, screen := range screens {
		if screen == nil {
			continue
		}
		result = append(result, backend.WindowWorkArea{
			X:       screen.WorkArea.X,
			Y:       screen.WorkArea.Y,
			Width:   screen.WorkArea.Width,
			Height:  screen.WorkArea.Height,
			Primary: screen.IsPrimary,
		})
	}
	return result
}
