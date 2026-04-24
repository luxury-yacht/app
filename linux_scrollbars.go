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
	"embed"
	"fmt"
	"os"
	"strconv"
	"strings"
	"unsafe"
)

//go:embed frontend/styles/themes/light.css frontend/styles/themes/dark.css
var themeCSS embed.FS

const (
	scrollbarWidthToken        = "--scrollbar-width"
	scrollbarHeightToken       = "--scrollbar-height"
	scrollbarRadiusToken       = "--scrollbar-radius"
	scrollbarMinThumbSizeToken = "--scrollbar-min-thumb-size"
	scrollbarThumbInsetToken   = "--scrollbar-thumb-inset"
	scrollbarTrackBgToken      = "--scrollbar-track-bg"
	scrollbarThumbBgToken      = "--scrollbar-thumb-bg"
	scrollbarThumbHoverBgToken = "--scrollbar-thumb-hover-bg"
)

func buildLinuxScrollbarCSS() (string, error) {
	tokens, err := readScrollbarTokens()
	if err != nil {
		return "", err
	}

	verticalSliderWidth, err := subtractPxTokens(tokens[scrollbarWidthToken], tokens[scrollbarThumbInsetToken], 2)
	if err != nil {
		return "", err
	}
	horizontalSliderHeight, err := subtractPxTokens(tokens[scrollbarHeightToken], tokens[scrollbarThumbInsetToken], 2)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf(`
scrollbar {
  background: %s;
  border: none;
  box-shadow: none;
  margin: 0;
  padding: 0;
  -GtkScrollbar-has-backward-stepper: false;
  -GtkScrollbar-has-forward-stepper: false;
}

scrollbar.vertical {
  min-width: %s;
}

scrollbar.horizontal {
  min-height: %s;
}

scrollbar trough {
  background: %s;
  border: none;
  box-shadow: none;
  min-width: %s;
  min-height: %s;
  padding: 0;
}

scrollbar slider {
  background-color: %s;
  border: none;
  border-radius: %s;
  box-shadow: none;
  margin: %s;
}

scrollbar slider:hover,
scrollbar slider:active {
  background-color: %s;
}

scrollbar.vertical slider {
  min-width: %s;
  min-height: %s;
}

scrollbar.horizontal slider {
  min-width: %s;
  min-height: %s;
}

scrollbar button {
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: none;
  background: %s;
  color: %s;
  opacity: 0;
}

scrollbar.overlay-indicator trough {
  background: %s;
}

scrollbar.overlay-indicator slider {
  background-color: %s;
  border-radius: %s;
  margin: %s;
}
`,
		tokens[scrollbarTrackBgToken],
		tokens[scrollbarWidthToken],
		tokens[scrollbarHeightToken],
		tokens[scrollbarTrackBgToken],
		tokens[scrollbarWidthToken],
		tokens[scrollbarHeightToken],
		tokens[scrollbarThumbBgToken],
		tokens[scrollbarRadiusToken],
		tokens[scrollbarThumbInsetToken],
		tokens[scrollbarThumbHoverBgToken],
		verticalSliderWidth,
		tokens[scrollbarMinThumbSizeToken],
		tokens[scrollbarMinThumbSizeToken],
		horizontalSliderHeight,
		tokens[scrollbarTrackBgToken],
		tokens[scrollbarTrackBgToken],
		tokens[scrollbarTrackBgToken],
		tokens[scrollbarThumbBgToken],
		tokens[scrollbarRadiusToken],
		tokens[scrollbarThumbInsetToken],
	), nil
}

func readScrollbarTokens() (map[string]string, error) {
	lightCSS, err := themeCSS.ReadFile("frontend/styles/themes/light.css")
	if err != nil {
		return nil, err
	}
	darkCSS, err := themeCSS.ReadFile("frontend/styles/themes/dark.css")
	if err != nil {
		return nil, err
	}

	tokenNames := []string{
		scrollbarWidthToken,
		scrollbarHeightToken,
		scrollbarRadiusToken,
		scrollbarMinThumbSizeToken,
		scrollbarThumbInsetToken,
		scrollbarTrackBgToken,
		scrollbarThumbBgToken,
		scrollbarThumbHoverBgToken,
	}
	tokenValues := make(map[string]string, len(tokenNames))
	for _, name := range tokenNames {
		value := findCSSCustomProperty(string(lightCSS), name)
		if value == "" {
			value = findCSSCustomProperty(string(darkCSS), name)
		}
		if value == "" {
			return nil, fmt.Errorf("missing CSS token %s", name)
		}
		tokenValues[name] = value
	}
	return tokenValues, nil
}

func findCSSCustomProperty(css, name string) string {
	start := strings.Index(css, name+":")
	if start < 0 {
		return ""
	}
	valueStart := start + len(name) + 1
	valueEnd := strings.Index(css[valueStart:], ";")
	if valueEnd < 0 {
		return ""
	}
	return strings.TrimSpace(css[valueStart : valueStart+valueEnd])
}

func subtractPxTokens(base, inset string, multiplier float64) (string, error) {
	baseValue, err := parsePxToken(base)
	if err != nil {
		return "", err
	}
	insetValue, err := parsePxToken(inset)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%gpx", baseValue-(insetValue*multiplier)), nil
}

func parsePxToken(value string) (float64, error) {
	trimmed := strings.TrimSpace(value)
	raw, ok := strings.CutSuffix(trimmed, "px")
	if !ok {
		return 0, fmt.Errorf("expected px token, got %q", value)
	}
	return strconv.ParseFloat(strings.TrimSpace(raw), 64)
}

func prepareLinuxScrollbarRuntime() {
	os.Setenv("GTK_OVERLAY_SCROLLING", "1")
}

func installLinuxScrollbarStyle() {
	linuxScrollbarCSS, err := buildLinuxScrollbarCSS()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to build Linux scrollbar CSS from tokens: %v\n", err)
		return
	}
	css := C.CString(linuxScrollbarCSS)
	defer C.free(unsafe.Pointer(css))
	C.luxury_yacht_install_scrollbar_css(css)
}
