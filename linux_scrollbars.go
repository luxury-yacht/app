//go:build linux

package main

/*
#cgo linux pkg-config: gtk+-3.0
#include <gtk/gtk.h>
#include <stdlib.h>

static void luxury_yacht_install_scrollbar_css(const char *css) {
	GtkCssProvider *provider = gtk_css_provider_new();
	gtk_css_provider_load_from_data(provider, css, -1, NULL);

	GdkScreen *screen = gdk_screen_get_default();
	if (screen != NULL) {
		gtk_style_context_add_provider_for_screen(
			screen,
			GTK_STYLE_PROVIDER(provider),
			GTK_STYLE_PROVIDER_PRIORITY_APPLICATION
		);
	}

	g_object_unref(provider);
}
*/
import "C"

import (
	"os"
	"unsafe"
)

const linuxScrollbarCSS = `
scrollbar {
  background: transparent;
  border: none;
  margin: 0;
  padding: 0;
  -GtkScrollbar-has-backward-stepper: false;
  -GtkScrollbar-has-forward-stepper: false;
}

scrollbar.vertical {
  min-width: 12px;
}

scrollbar.horizontal {
  min-height: 12px;
}

scrollbar trough {
  background: transparent;
  border: none;
  min-width: 12px;
  min-height: 12px;
}

scrollbar slider {
  background-color: rgba(100, 116, 139, 0.58);
  border: none;
  border-radius: 999px;
  margin: 3px;
}

scrollbar slider:hover,
scrollbar slider:active {
  background-color: rgba(100, 116, 139, 0.76);
}

scrollbar.vertical slider {
  min-width: 6px;
  min-height: 32px;
}

scrollbar.horizontal slider {
  min-width: 32px;
  min-height: 6px;
}

scrollbar button {
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: transparent;
}

scrollbar.overlay-indicator:not(.dragging):not(.hovering) {
  opacity: 1;
}
`

func prepareLinuxScrollbarRuntime() {
	os.Setenv("GTK_OVERLAY_SCROLLING", "0")
}

func installLinuxScrollbarStyle() {
	css := C.CString(linuxScrollbarCSS)
	defer C.free(unsafe.Pointer(css))
	C.luxury_yacht_install_scrollbar_css(css)
}
