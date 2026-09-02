//go:build darwin && cgo && !ios && !server

package appwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNativeDockableTabDragPolicySuppressesOnlyFailedTabReturnAnimation(t *testing.T) {
	require.True(t, nativeTabDragSnapBackPolicyProbe())
}

func TestNativeDockableTabDragPolicyIsInstalled(t *testing.T) {
	configureNativeTabDragAnimation()
	require.True(t, nativeTabDragSnapBackPolicyInstalled())
}

func TestNativeDockableTabDragSourceCallbackRecognizesWebKitCustomData(t *testing.T) {
	configureNativeTabDragAnimation()
	require.True(t, nativeTabDragWebKitCustomDataPolicyProbe())
}
