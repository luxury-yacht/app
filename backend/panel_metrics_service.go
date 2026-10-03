package backend

import (
	"github.com/luxury-yacht/app/backend/panelmetrics"
	"github.com/luxury-yacht/app/internal/panelwindow"
)

// panelLifetime is the panel workspace directory's view of which panels are open: it outlives
// every window, so a panel's samples survive moves between windows and end when it closes.
type panelLifetime interface {
	HasPanel(clusterID, panelID string) bool
	SetPanelRemovalHandler(func([]panelwindow.PanelKey))
}

// PanelMetricsService keeps object panels' live metric samples in memory while the panels are
// open in any window. The window showing a panel appends; the Metrics tab reads.
type PanelMetricsService struct {
	buffer *panelmetrics.Buffer
	panels panelLifetime
}

func NewPanelMetricsService(panels panelLifetime) *PanelMetricsService {
	service := &PanelMetricsService{buffer: panelmetrics.NewBuffer(panelmetrics.DefaultMaxSamples), panels: panels}
	panels.SetPanelRemovalHandler(service.panelsClosed)
	return service
}

// AppendPanelMetricSample records one collection for an open panel; a closed panel's sample is
// dropped so no series outlives its panel.
func (s *PanelMetricsService) AppendPanelMetricSample(clusterID, panelID string, sample panelmetrics.Sample) error {
	return s.buffer.Append(panelmetrics.Key{ClusterID: clusterID, PanelID: panelID}, sample, func() bool {
		return s.panels.HasPanel(clusterID, panelID)
	})
}

// GetPanelMetricSeries returns the panel's samples collected after afterT (unix milliseconds).
func (s *PanelMetricsService) GetPanelMetricSeries(clusterID, panelID string, afterT int64) (*panelmetrics.Series, error) {
	series := s.buffer.Since(panelmetrics.Key{ClusterID: clusterID, PanelID: panelID}, afterT)
	return &series, nil
}

func (s *PanelMetricsService) panelsClosed(closed []panelwindow.PanelKey) {
	keys := make([]panelmetrics.Key, 0, len(closed))
	for _, key := range closed {
		keys = append(keys, panelmetrics.Key{ClusterID: key.ClusterID, PanelID: key.PanelID})
	}
	s.buffer.Remove(keys...)
}
