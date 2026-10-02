package backend

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/metrichistory"
	"github.com/luxury-yacht/app/backend/metrichistory/prometheus"
)

const (
	// metricHistoryTimeout bounds one history read or connection test; its queries share it.
	metricHistoryTimeout = 20 * time.Second
	// metricQueryConcurrency bounds the queries one history read has in flight.
	metricQueryConcurrency = 4
)

// GetObjectMetricHistory returns an object's history from its cluster's source over the span
// ending now. Without a usable source the response is live mode with the reason; only an invalid
// request is a command error. Pods only until Phase 4 adds the other kinds.
func (s *MetricHistoryService) GetObjectMetricHistory(request MetricHistoryRequest) (*MetricHistoryResponse, error) {
	if err := validateMetricHistoryRequest(request); err != nil {
		return nil, err
	}
	grid, err := metrichistory.GridEndingAt(s.now(), time.Duration(request.SpanMs)*time.Millisecond)
	if err != nil {
		return nil, err
	}
	settings, err := s.repository.readMetricSourceSettings()
	if err != nil {
		return nil, err
	}
	source := resolveMetricSource(settings, request.ClusterID)
	// Live responses still name the graphs; the frontend fills the ones live metrics can supply.
	liveGraphs := metrichistory.LiveGraphs(metrichistory.PodGraphSpecs())
	if source == nil {
		return &MetricHistoryResponse{Mode: MetricHistoryModeLive, LiveReason: MetricHistoryLiveNoSource, Graphs: liveGraphs}, nil
	}
	summary := &MetricSourceSummary{ID: source.ID, Name: source.Name}
	ctx, cancel := context.WithTimeout(s.context(), metricHistoryTimeout)
	defer cancel()
	graphs, err := s.queryPodGraphs(ctx, *source, request, grid)
	if err != nil {
		return &MetricHistoryResponse{
			Mode: MetricHistoryModeLive, LiveReason: MetricHistoryLiveSourceError, Source: summary, Error: err.Error(),
			Graphs: liveGraphs,
		}, nil
	}
	return &MetricHistoryResponse{Mode: MetricHistoryModeSource, Source: summary, Grid: grid, Graphs: graphs}, nil
}

// TestMetricSource checks that a source, saved or not, answers as Prometheus. A failure is a
// result, not a command error, so Settings can show why.
func (s *MetricHistoryService) TestMetricSource(source MetricSource) (*MetricSourceTestResult, error) {
	candidate, err := normalizeMetricConnection(source)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(s.context(), metricHistoryTimeout)
	defer cancel()
	version, err := s.sourceVersion(ctx, candidate)
	if err != nil {
		return &MetricSourceTestResult{Error: err.Error()}, nil
	}
	return &MetricSourceTestResult{OK: true, Version: version}, nil
}

// resolveMetricSource is the one place that decides a cluster's effective source, or nil for
// live metrics only. An in-cluster source serves only its own cluster.
func resolveMetricSource(settings MetricSourceSettings, clusterID string) *MetricSource {
	assignment, ok := settings.Assignments[clusterID]
	if !ok || assignment.Kind != MetricAssignmentSource {
		return nil
	}
	index := metricSourceIndex(settings.Sources, assignment.SourceID)
	if index < 0 {
		return nil
	}
	source := settings.Sources[index]
	if source.InCluster == nil || source.InCluster.ClusterID != clusterID {
		return nil
	}
	return &source
}

func validateMetricHistoryRequest(request MetricHistoryRequest) error {
	if strings.TrimSpace(request.ClusterID) == "" {
		return errors.New("cluster id is required")
	}
	if request.Group != "" || request.Version != "v1" || request.Kind != "Pod" {
		return fmt.Errorf("metrics history is not available for %s", request.Kind)
	}
	if strings.TrimSpace(request.Namespace) == "" || strings.TrimSpace(request.Name) == "" {
		return errors.New("a pod namespace and name are required")
	}
	return nil
}

func (s *MetricHistoryService) queryPodGraphs(
	ctx context.Context, source MetricSource, request MetricHistoryRequest, grid metrichistory.Grid,
) ([]metrichistory.Graph, error) {
	querier, err := s.sourceQuerier(ctx, source)
	if err != nil {
		return nil, err
	}
	queries := prometheus.PodQueries(request.Namespace, request.Name, nil, metrichistory.RateWindow(grid.Step()))
	results, err := runMetricQueries(ctx, querier, queries, grid)
	if err != nil {
		return nil, err
	}
	return prometheus.PodGraphs(grid, results), nil
}

func (s *MetricHistoryService) sourceVersion(ctx context.Context, source MetricSource) (string, error) {
	querier, err := s.sourceQuerier(ctx, source)
	if err != nil {
		return "", err
	}
	body, err := querier.BuildInfo(ctx)
	if err != nil {
		return "", err
	}
	return prometheus.DecodeBuildInfo(body)
}

// sourceQuerier reaches an in-cluster source after checking the user may proxy to its Service;
// a denial stops before any query.
func (s *MetricHistoryService) sourceQuerier(ctx context.Context, source MetricSource) (metricQuerier, error) {
	target := *source.InCluster
	deps, _, err := s.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return nil, err
	}
	if err := s.permissionCheck(ctx, deps, resourcePermissionCheck{
		Version: "v1", Kind: "Service", Namespace: target.Namespace, Name: target.Service, Verb: "get", Subresource: "proxy",
	}); err != nil {
		return nil, err
	}
	return s.newQuerier(deps, target), nil
}

// runMetricQueries runs every query and decodes it onto grid; the first failure cancels the rest.
func runMetricQueries(
	ctx context.Context, querier metricQuerier, queries []prometheus.Query, grid metrichistory.Grid,
) (map[prometheus.QueryID][]prometheus.Stream, error) {
	streams := make([][]prometheus.Stream, len(queries))
	tasks := make([]func(context.Context) error, len(queries))
	for index, query := range queries {
		tasks[index] = func(ctx context.Context) error {
			body, err := querier.QueryRange(ctx, query.PromQL, grid)
			if err != nil {
				return err
			}
			streams[index], err = prometheus.DecodeMatrix(body, grid)
			return err
		}
	}
	if err := parallel.RunLimited(ctx, metricQueryConcurrency, tasks...); err != nil {
		return nil, err
	}
	results := make(map[prometheus.QueryID][]prometheus.Stream, len(queries))
	for index, query := range queries {
		results[query.ID] = streams[index]
	}
	return results, nil
}
