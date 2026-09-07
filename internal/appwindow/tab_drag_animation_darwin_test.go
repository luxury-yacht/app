//go:build darwin && cgo && !ios && !server

package appwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNativeTabDragPolicySuppressesOnlyTabReturnAnimation(t *testing.T) {
	for _, encoding := range []struct {
		name             string
		webKitCustomData bool
	}{
		{name: "pasteboard type"},
		{name: "WebKit custom data", webKitCustomData: true},
	} {
		t.Run(encoding.name, func(t *testing.T) {
			for _, drag := range []struct {
				name       string
				mimeType   string
				suppressed bool
			}{
				{name: "panel tab", mimeType: "application/x-luxury-yacht-tab-dockable-tab", suppressed: true},
				{name: "cluster tab", mimeType: "application/x-luxury-yacht-tab-cluster-tab", suppressed: true},
				{name: "unrelated drag", mimeType: "application/x-luxury-yacht-unrelated-drag"},
				{name: "untyped tab drag", mimeType: "application/x-luxury-yacht-tab"},
			} {
				t.Run(drag.name, func(t *testing.T) {
					require.Equal(t, drag.suppressed,
						nativeTabDragSnapBackPolicyProbe(drag.mimeType, encoding.webKitCustomData),
						"native drag callback must suppress snap-back for panel and cluster tabs only")
				})
			}
		})
	}
}

func TestNativeTabDragPolicyIsInstalled(t *testing.T) {
	configureNativeTabDragAnimation()
	require.True(t, nativeTabDragSnapBackPolicyInstalled())
}
