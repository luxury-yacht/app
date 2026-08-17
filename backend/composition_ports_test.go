package backend

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type compositionSearchPathRepository struct{}

func (compositionSearchPathRepository) KubeconfigSearchPaths() ([]string, error) {
	return []string{"/clusters"}, nil
}

type compositionTelemetryRepository struct {
	acknowledged string
}

func (*compositionTelemetryRepository) prepareInstallationTelemetry() (string, bool, error) {
	return "installation-id", false, nil
}

func (r *compositionTelemetryRepository) acknowledgeInstallationTelemetry(id string) error {
	r.acknowledged = id
	return nil
}

type compositionRateLimitSink struct {
	qps   int
	burst int
}

func (s *compositionRateLimitSink) SetKubernetesClientRateLimits(qps, burst int) {
	s.qps, s.burst = qps, burst
}

type compositionRefreshSettingSink struct {
	globalLimit int
	metricsMs   int
}

func (s *compositionRefreshSettingSink) SetContainerLogsGlobalLimit(limit int) {
	s.globalLimit = limit
}

func (s *compositionRefreshSettingSink) SetMetricsRefreshInterval(intervalMs int) {
	s.metricsMs = intervalMs
}

func TestCompositionPortsRejectEarlyUseAndDuplicateBinding(t *testing.T) {
	updatePort := &updateCheckPort{}
	require.ErrorContains(t, updatePort.check(), "not available")
	updatePort.bind(func() error { return errors.New("checked") })
	require.ErrorContains(t, updatePort.check(), "checked")
	require.Panics(t, func() { updatePort.bind(func() error { return nil }) })

	searchPathPort := &kubeconfigSearchPathPort{}
	_, err := searchPathPort.read()
	require.ErrorContains(t, err, "not available")
	searchPathPort.bind(compositionSearchPathRepository{})
	paths, err := searchPathPort.read()
	require.NoError(t, err)
	require.Equal(t, []string{"/clusters"}, paths)
	require.Panics(t, func() { searchPathPort.bind(compositionSearchPathRepository{}) })

	telemetryPort := &installationTelemetryPort{}
	_, _, err = telemetryPort.prepareInstallationTelemetry()
	require.ErrorContains(t, err, "not available")
	repository := &compositionTelemetryRepository{}
	telemetryPort.bind(repository)
	id, reported, err := telemetryPort.prepareInstallationTelemetry()
	require.NoError(t, err)
	require.Equal(t, "installation-id", id)
	require.False(t, reported)
	require.NoError(t, telemetryPort.acknowledgeInstallationTelemetry(id))
	require.Equal(t, id, repository.acknowledged)
	require.Panics(t, func() { telemetryPort.bind(repository) })
}

func TestSettingsBridgesRetainEarlyValuesAndRejectDuplicateBinding(t *testing.T) {
	rateLimits := newClusterRateLimitBridge(100, 200)
	rateLimits.SetKubernetesClientRateLimits(125, 250)
	rateTarget := &compositionRateLimitSink{}
	rateLimits.bind(rateTarget)
	require.Equal(t, 125, rateTarget.qps)
	require.Equal(t, 250, rateTarget.burst)
	require.Panics(t, func() { rateLimits.bind(rateTarget) })

	refresh := newRefreshSettingBridge(10, 1_000)
	refresh.SetContainerLogsGlobalLimit(20)
	refresh.SetMetricsRefreshInterval(2_000)
	refreshTarget := &compositionRefreshSettingSink{}
	refresh.bind(refreshTarget)
	require.Equal(t, 20, refreshTarget.globalLimit)
	require.Equal(t, 2_000, refreshTarget.metricsMs)
	require.Panics(t, func() { refresh.bind(refreshTarget) })
}
