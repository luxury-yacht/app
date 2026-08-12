package desktop

import (
	"runtime"
	"testing"

	"github.com/luxury-yacht/app/backend"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestDesktopAdapterResolvesOnlyTheNamedMainWindow(t *testing.T) {
	app := application.New(application.Options{})
	const testWindowName = "adapter-test"
	adapter := NewAdapter(app, testWindowName)

	_, err := adapter.mainWindow()
	require.ErrorContains(t, err, `window "adapter-test" is not available`)

	want := app.Window.NewWithOptions(application.WebviewWindowOptions{Name: testWindowName})
	got, err := adapter.mainWindow()
	require.NoError(t, err)
	require.Same(t, want, got)
}

func TestMaterialiseMenuPreservesLabelsSeparatorsAndAccelerators(t *testing.T) {
	model := backend.NewMenuModel()
	file := model.AddSubmenu("File")
	file.AddText("Open Cluster", "CmdOrCtrl+o", func() {})
	file.AddSeparator()
	file.AddText("Quit", "CmdOrCtrl+q", func() {})

	native := application.NewMenu()
	materialiseMenu(native, model)

	fileItem := native.ItemAt(0)
	require.Equal(t, "File", fileItem.Label())
	fileMenu := fileItem.GetSubmenu()
	require.Equal(t, "Open Cluster", fileMenu.ItemAt(0).Label())
	wantAccelerator := "Ctrl+O"
	if runtime.GOOS == "darwin" {
		wantAccelerator = "Cmd+O"
	}
	require.Equal(t, wantAccelerator, fileMenu.ItemAt(0).GetAccelerator())
	require.True(t, fileMenu.ItemAt(1).IsSeparator())
	require.Equal(t, "Quit", fileMenu.ItemAt(2).Label())
	require.Nil(t, fileMenu.ItemAt(3))
}
