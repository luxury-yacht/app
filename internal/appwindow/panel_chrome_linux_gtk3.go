//go:build linux && cgo && gtk3 && !android && !server

package appwindow

/*
#cgo linux pkg-config: gtk+-3.0

#include <gtk/gtk.h>

static void hide_panel_window_menu(void *native_window) {
	GtkWindow *window = GTK_WINDOW(native_window);
	GtkWidget *content = gtk_bin_get_child(GTK_BIN(window));
	if (content == NULL || !GTK_IS_BOX(content)) {
		return;
	}

	GList *children = gtk_container_get_children(GTK_CONTAINER(content));
	if (children != NULL && GTK_IS_MENU_BAR(children->data)) {
		gtk_widget_hide(GTK_WIDGET(children->data));
	}
	g_list_free(children);
}
*/
import (
	"C"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func hideNativePanelWindowMenu(window *application.WebviewWindow) {
	nativeWindow := window.NativeWindow()
	if nativeWindow == nil {
		return
	}
	application.InvokeSync(func() {
		C.hide_panel_window_menu(nativeWindow)
	})
}
