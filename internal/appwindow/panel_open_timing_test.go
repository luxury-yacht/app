package appwindow

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestPanelOpenTimingKeepsStageDurationsAndIdentity(t *testing.T) {
	var message, cluster string
	trace := newPanelOpenTiming("transfer-a", "cluster-a", "backend-create", func(m, c string) { message, cluster = m, c })
	start := trace.started
	trace.now = func() time.Time { return start.Add(125 * time.Millisecond) }
	trace.mark("cluster-retained")
	trace.now = func() time.Time { return start.Add(200 * time.Millisecond) }
	trace.report()
	var sample struct {
		TransferID string  `json:"transferId"`
		Phase      string  `json:"phase"`
		TotalMS    float64 `json:"totalMs"`
		Stages     []struct {
			Stage     string  `json:"stage"`
			ElapsedMS float64 `json:"elapsedMs"`
		} `json:"stages"`
	}
	require.NoError(t, json.Unmarshal([]byte(strings.TrimPrefix(message, "[DEBUG-panel-open] ")), &sample))
	require.Equal(t, "cluster-a", cluster)
	require.Equal(t, "transfer-a", sample.TransferID)
	require.Equal(t, "backend-create", sample.Phase)
	require.Equal(t, float64(200), sample.TotalMS)
	require.Equal(t, "cluster-retained", sample.Stages[0].Stage)
	require.Equal(t, float64(125), sample.Stages[0].ElapsedMS)
}

func TestPanelOpenTimingDisabledDoesNotAllocateARecorder(t *testing.T) {
	trace := newPanelOpenTiming("transfer-a", "cluster-a", "backend-create", nil)
	require.Nil(t, trace)
	trace.mark("native-created")
	trace.report()
}

func TestPanelOpenTimingOptInPreservesTheReadyGate(t *testing.T) {
	for _, enabled := range []string{"", "1"} {
		t.Run("enabled="+enabled, func(t *testing.T) {
			t.Setenv("VITE_PANEL_OPEN_TIMING", enabled)
			registry := NewRegistry(application.New(application.Options{}), &recordingLifecycleBackend{})
			registry.panelOpenTimeout = 0
			var messages []string
			registry.ConfigurePanelOpenTiming(func(message, clusterID string) {
				require.Equal(t, "cluster-1", clusterID)
				messages = append(messages, message)
			})
			owner := registry.Create(true)
			snapshot := validPanelGroupSnapshot()
			snapshot.SourceWindowName = owner.Name()
			shown := false
			registry.showWindow = func(string) bool { shown = true; return true }
			descriptor, err := beginTestPanelWindow(t, registry, snapshot)
			require.NoError(t, err)
			require.False(t, shown)
			_, err = registry.AcknowledgePanelWindowReady(descriptor.WindowName, snapshot.TransferID)
			require.NoError(t, err)
			require.True(t, shown)
			if enabled == "" {
				require.Empty(t, messages)
				return
			}
			require.Len(t, messages, 2)
			var phases []string
			for _, message := range messages {
				var sample map[string]any
				require.NoError(t, json.Unmarshal([]byte(strings.TrimPrefix(message, "[DEBUG-panel-open] ")), &sample))
				require.Equal(t, snapshot.TransferID, sample["transferId"])
				phases = append(phases, sample["phase"].(string))
			}
			require.Equal(t, []string{"backend-create", "backend-ready"}, phases)
		})
	}
}
