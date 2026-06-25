package system

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh"
)

// TestCooledInformerHubAlwaysSettled proves the cooled-cluster readiness gate reports synced
// unconditionally: a cooled subsystem has shut its manager + informer factory (so the live
// hub would report NOT synced), but its data is frozen and resident in the mmap-backed stores,
// so the snapshot sync gate must let every Build through immediately. Its lifecycle methods are
// no-ops (there is nothing to start or shut down).
func TestCooledInformerHubAlwaysSettled(t *testing.T) {
	var hub refresh.InformerHub = NewCooledInformerHub()
	require.True(t, hub.HasSynced(context.Background()))
	require.True(t, hub.ResourcesSettled([]string{"core/pods", "apps/deployments"}))
	require.True(t, hub.ResourcesSettled(nil))
	require.NoError(t, hub.Start(context.Background()))
	require.NoError(t, hub.Shutdown())
}
