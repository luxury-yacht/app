package backend

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/metrichistory"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
)

const metricFixtureDir = "metrichistory/prometheus/testdata/kube-prometheus-stack"

// fixtureCaptureEnd is when the Phase 0 fixtures were captured; a 10-minute span ending there
// reproduces their grid and their exact queries.
var fixtureCaptureEnd = time.Unix(1_790_895_240, 0)

// fixtureQuerier answers each verified Phase 0 query with its captured response.
type fixtureQuerier struct {
	mu        sync.Mutex
	responses map[string][]byte
	queries   []string
	failWith  error
}

func newFixtureQuerier(t *testing.T) *fixtureQuerier {
	t.Helper()
	manifest, err := os.ReadFile(filepath.Join(metricFixtureDir, "manifest.json"))
	require.NoError(t, err)
	var entries []struct{ File, Query string }
	require.NoError(t, json.Unmarshal(manifest, &entries))
	responses := map[string][]byte{}
	for _, entry := range entries {
		if entry.Query == "" {
			continue
		}
		body, err := os.ReadFile(filepath.Join(metricFixtureDir, entry.File))
		require.NoError(t, err)
		responses[entry.Query] = body
	}
	return &fixtureQuerier{responses: responses}
}

func (q *fixtureQuerier) QueryRange(_ context.Context, promql string, _ metrichistory.Grid) ([]byte, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.queries = append(q.queries, promql)
	if q.failWith != nil {
		return nil, q.failWith
	}
	body, ok := q.responses[promql]
	if !ok {
		return nil, errors.New("unexpected query: " + promql)
	}
	return body, nil
}

func (q *fixtureQuerier) BuildInfo(context.Context) ([]byte, error) {
	if q.failWith != nil {
		return nil, q.failWith
	}
	return os.ReadFile(filepath.Join(metricFixtureDir, "buildinfo.json"))
}

type metricHistoryQueryFixture struct {
	service      *MetricHistoryService
	repository   metricSourceRepository
	querier      *fixtureQuerier
	resolved     []string
	permissions  []resourcePermissionCheck
	permissionTo error
	targets      []MetricInClusterTarget
}

func newMetricHistoryQueryFixture(t *testing.T) *metricHistoryQueryFixture {
	t.Helper()
	setTestConfigEnv(t)
	base := newClusterRuntimeTestFixture(t)
	fixture := &metricHistoryQueryFixture{repository: base.Preferences, querier: newFixtureQuerier(t)}
	fixture.service = NewMetricHistoryService(MetricHistoryServiceDependencies{
		Repository: base.Preferences,
		ResolveClusterDependencies: func(clusterID string) (common.Dependencies, string, error) {
			fixture.resolved = append(fixture.resolved, clusterID)
			return common.Dependencies{ClusterID: clusterID}, clusterID, nil
		},
		Context: context.Background,
		Now:     func() time.Time { return fixtureCaptureEnd },
		PermissionCheck: func(_ context.Context, _ common.Dependencies, check resourcePermissionCheck) error {
			fixture.permissions = append(fixture.permissions, check)
			return fixture.permissionTo
		},
		NewQuerier: func(_ common.Dependencies, target MetricInClusterTarget) metricQuerier {
			fixture.targets = append(fixture.targets, target)
			return fixture.querier
		},
	})
	return fixture
}

// assignFixtureSource gives the cluster an in-cluster source pointing at the Phase 0 Prometheus.
func (f *metricHistoryQueryFixture) assignFixtureSource(t *testing.T, clusterID string) MetricSource {
	t.Helper()
	source, err := f.service.SaveMetricSource(MetricSource{
		Name: "dev prometheus",
		Mode: MetricSourceModeInCluster,
		InCluster: &MetricInClusterTarget{
			ClusterID: clusterID, Namespace: "kube-prometheus-stack", Service: "kube-prometheus-stack-prometheus", Port: "http-web",
		},
	})
	require.NoError(t, err)
	require.NoError(t, f.service.SetClusterMetricAssignment(clusterID, MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: source.ID}))
	return *source
}

// requireLiveGraphs checks a live response still names the Pod's graphs, in catalog order, with no
// source data: the frontend fills the ones live metrics can supply.
func requireLiveGraphs(t *testing.T, graphs []metrichistory.Graph) {
	t.Helper()
	require.Equal(t, []metrichistory.Graph{
		{ID: metrichistory.GraphCPU, Unit: metrichistory.UnitMillicores, Status: metrichistory.GraphStatusLive},
		{ID: metrichistory.GraphMemory, Unit: metrichistory.UnitBytes, Status: metrichistory.GraphStatusLive},
	}, graphs)
}

func fixturePodRequest(clusterID string) MetricHistoryRequest {
	return MetricHistoryRequest{
		ClusterID: clusterID, Group: "", Version: "v1", Kind: "Pod",
		Namespace: "podinfo", Name: "podinfo-66888d8d86-5lpbr",
		SpanMs: (10 * time.Minute).Milliseconds(),
	}
}

func TestPodHistoryFromTheAssignedInClusterSource(t *testing.T) {
	fixture := newMetricHistoryQueryFixture(t)
	source := fixture.assignFixtureSource(t, "dev:dev-cluster")

	response, err := fixture.service.GetObjectMetricHistory(fixturePodRequest("dev:dev-cluster"))
	require.NoError(t, err)

	require.Equal(t, MetricHistoryModeSource, response.Mode)
	require.Equal(t, &MetricSourceSummary{ID: source.ID, Name: "dev prometheus"}, response.Source)
	require.True(t, response.Grid.End().Equal(fixtureCaptureEnd), "the newest point is now")
	require.Equal(t, []string{"dev:dev-cluster"}, fixture.resolved, "queries run against the requested cluster")
	require.Equal(t, []MetricInClusterTarget{*source.InCluster}, fixture.targets)
	require.Len(t, fixture.querier.queries, 4, "the four verified Pod queries")

	// The source's Service, not the Pod, is what the user must be allowed to proxy to.
	require.Equal(t, []resourcePermissionCheck{{
		Version: "v1", Kind: "Service", Namespace: "kube-prometheus-stack",
		Name: "kube-prometheus-stack-prometheus", Verb: "get", Subresource: "proxy",
	}}, fixture.permissions)

	cpu := response.Graphs[0]
	require.Equal(t, metrichistory.GraphCPU, cpu.ID)
	require.Equal(t, metrichistory.GraphStatusOK, cpu.Status)
	latest := cpu.Series[0].Values[response.Grid.Count-1]
	require.NotNil(t, latest)
	require.InDelta(t, 2.5297544221962814, *latest, 1e-9, "millicores")
}

func TestClustersWithoutASourceGetNoSourceAndNoClusterRequests(t *testing.T) {
	fixture := newMetricHistoryQueryFixture(t)
	fixture.assignFixtureSource(t, "dev:dev-cluster")
	require.NoError(t, fixture.service.SetClusterMetricAssignment("stg:stg-cluster", MetricClusterAssignment{Kind: MetricAssignmentNone}))

	for _, clusterID := range []string{"stg:stg-cluster", "prod:prod-cluster"} {
		response, err := fixture.service.GetObjectMetricHistory(fixturePodRequest(clusterID))
		require.NoError(t, err)
		require.Equal(t, MetricHistoryModeLive, response.Mode)
		require.Equal(t, MetricHistoryLiveNoSource, response.LiveReason)
		requireLiveGraphs(t, response.Graphs)
	}
	require.Empty(t, fixture.resolved, "no cluster request is made without a source")
	require.Empty(t, fixture.querier.queries)
}

func TestAnotherClustersInClusterSourceNeverServesHistory(t *testing.T) {
	fixture := newMetricHistoryQueryFixture(t)
	source := fixture.assignFixtureSource(t, "dev:dev-cluster")
	// Settings edited outside the app can pair a cluster with another cluster's in-cluster source;
	// querying it would chart dev's Prometheus for a stg pod.
	_, err := fixture.repository.updateMetricSourceSettings(func(settings *MetricSourceSettings) error {
		settings.Assignments["stg:stg-cluster"] = MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: source.ID}
		return nil
	})
	require.NoError(t, err)

	response, err := fixture.service.GetObjectMetricHistory(fixturePodRequest("stg:stg-cluster"))
	require.NoError(t, err)
	require.Equal(t, MetricHistoryLiveNoSource, response.LiveReason)
	require.Empty(t, fixture.querier.queries)
}

func TestSourceFailuresFallBackWithTheReason(t *testing.T) {
	for name, setup := range map[string]func(*metricHistoryQueryFixture){
		"permission denied": func(f *metricHistoryQueryFixture) {
			f.permissionTo = errors.New("permission denied for services/proxy kube-prometheus-stack-prometheus")
		},
		"proxy failure": func(f *metricHistoryQueryFixture) {
			f.querier.failWith = errors.New(`no endpoints available for service "kube-prometheus-stack-prometheus"`)
		},
		"prometheus error": func(f *metricHistoryQueryFixture) {
			body, err := os.ReadFile(filepath.Join(metricFixtureDir, "error_bad_data.json"))
			require.NoError(t, err)
			for query := range f.querier.responses {
				f.querier.responses[query] = body
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			fixture := newMetricHistoryQueryFixture(t)
			fixture.assignFixtureSource(t, "dev:dev-cluster")
			setup(fixture)

			response, err := fixture.service.GetObjectMetricHistory(fixturePodRequest("dev:dev-cluster"))
			require.NoError(t, err, "a failing source is a response state, not a command error")
			require.Equal(t, MetricHistoryModeLive, response.Mode)
			require.Equal(t, MetricHistoryLiveSourceError, response.LiveReason)
			require.NotEmpty(t, response.Error)
			requireLiveGraphs(t, response.Graphs)
		})
	}
}

func TestPermissionDenialStopsBeforeAnyQuery(t *testing.T) {
	fixture := newMetricHistoryQueryFixture(t)
	fixture.assignFixtureSource(t, "dev:dev-cluster")
	fixture.permissionTo = errors.New("permission denied")

	_, err := fixture.service.GetObjectMetricHistory(fixturePodRequest("dev:dev-cluster"))
	require.NoError(t, err)
	require.Empty(t, fixture.querier.queries)
}

func TestHistoryRequestsNeedACompletePodIdentityAndSpan(t *testing.T) {
	fixture := newMetricHistoryQueryFixture(t)
	for name, mutate := range map[string]func(*MetricHistoryRequest){
		"missing cluster":   func(request *MetricHistoryRequest) { request.ClusterID = "" },
		"missing namespace": func(request *MetricHistoryRequest) { request.Namespace = "" },
		"missing name":      func(request *MetricHistoryRequest) { request.Name = "" },
		"not a pod":         func(request *MetricHistoryRequest) { request.Kind = "Deployment"; request.Group = "apps" },
		"no span":           func(request *MetricHistoryRequest) { request.SpanMs = 0 },
	} {
		request := fixturePodRequest("dev:dev-cluster")
		mutate(&request)
		_, err := fixture.service.GetObjectMetricHistory(request)
		require.Errorf(t, err, name)
	}
}

func TestTestMetricSourceReportsTheVersionOrTheFailure(t *testing.T) {
	fixture := newMetricHistoryQueryFixture(t)
	source := fixture.assignFixtureSource(t, "dev:dev-cluster")

	result, err := fixture.service.TestMetricSource(source)
	require.NoError(t, err)
	require.Equal(t, MetricSourceTestResult{OK: true, Version: "3.15.0"}, *result)

	fixture.permissionTo = errors.New("permission denied for services/proxy")
	result, err = fixture.service.TestMetricSource(source)
	require.NoError(t, err)
	require.False(t, result.OK)
	require.True(t, strings.Contains(result.Error, "permission denied"))
}
