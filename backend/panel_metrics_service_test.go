package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/panelmetrics"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
)

func panelMetricsTab(name string) panelwindow.TabSnapshot {
	return panelwindow.TabSnapshot{
		Kind: panelwindow.TabKindObject, PanelID: "obj:dev:/v1/pod:podinfo:" + name, ActiveView: "details",
		ObjectRef: panelwindow.ObjectReference{ClusterID: "dev", Version: "v1", Kind: "Pod", Namespace: "podinfo", Name: name},
	}
}

func panelMetricsSample(t int64) panelmetrics.Sample {
	usage := float64(t)
	return panelmetrics.Sample{T: t, CPU: panelmetrics.Values{Usage: &usage}}
}

func TestPanelMetricsFollowThePanelAcrossWindowsUntilItCloses(t *testing.T) {
	directory := panelwindow.NewWorkspaceDirectory()
	service := NewPanelMetricsService(directory)
	tab := panelMetricsTab("api")
	docked := panelwindow.PanelLocation{Kind: panelwindow.PanelLocationDocked, WindowName: "app-a", GroupID: "right"}
	native := panelwindow.PanelLocation{Kind: panelwindow.PanelLocationWindow, WindowName: "panel-1", GroupID: "group-1"}
	_, _, err := directory.Open(tab, docked)
	require.NoError(t, err)
	require.NoError(t, service.AppendPanelMetricSample("dev", tab.PanelID, panelMetricsSample(1_000)))

	// Popping the panel out keeps its samples; the new window adds to them.
	require.NoError(t, directory.Move(tab, docked, native))
	require.NoError(t, service.AppendPanelMetricSample("dev", tab.PanelID, panelMetricsSample(6_000)))
	series, err := service.GetPanelMetricSeries("dev", tab.PanelID, 0)
	require.NoError(t, err)
	require.Len(t, series.Samples, 2)

	// Closing the window that holds it closes the panel and frees its samples.
	directory.RemoveWindow("panel-1")
	series, err = service.GetPanelMetricSeries("dev", tab.PanelID, 0)
	require.NoError(t, err)
	require.Empty(t, series.Samples)
}

func TestPanelMetricsIgnoreSamplesForAPanelThatIsNotOpen(t *testing.T) {
	service := NewPanelMetricsService(panelwindow.NewWorkspaceDirectory())
	tab := panelMetricsTab("api")

	require.NoError(t, service.AppendPanelMetricSample("dev", tab.PanelID, panelMetricsSample(1_000)))

	series, err := service.GetPanelMetricSeries("dev", tab.PanelID, 0)
	require.NoError(t, err)
	require.Empty(t, series.Samples)
}
