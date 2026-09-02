//go:build linux && cgo && !gtk3 && !android && !server

package appwindow

/*
#cgo linux pkg-config: gtk4

#include <gtk/gtk.h>

static void hide_panel_window_menu(void *native_window) {
	GtkWindow *window = GTK_WINDOW(native_window);
	GtkWidget *content = gtk_window_get_child(window);
	if (content == NULL || !GTK_IS_BOX(content)) {
		return;
	}

	GtkWidget *first_child = gtk_widget_get_first_child(content);
	if (first_child != NULL && GTK_IS_POPOVER_MENU_BAR(first_child)) {
		gtk_widget_set_visible(first_child, FALSE);
	}
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

func hideNativePanelWindowMenu(window *application.WebviewWindow) {
	nativeWindow := window.NativeWindow()
	if nativeWindow == nil {
		return
	}
	application.InvokeSync(func() {
		C.hide_panel_window_menu(nativeWindow)
	})
}
