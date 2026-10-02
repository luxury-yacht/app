package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

type metricHistoryTestFixture struct {
	*clusterRuntimeTestFixture
	MetricHistory *MetricHistoryService
}

func newMetricHistoryTestFixture(t *testing.T) *metricHistoryTestFixture {
	t.Helper()
	base := newClusterRuntimeTestFixture(t)
	return &metricHistoryTestFixture{
		clusterRuntimeTestFixture: base,
		MetricHistory:             NewMetricHistoryService(MetricHistoryServiceDependencies{Repository: base.Preferences}),
	}
}

func inClusterSource(name, clusterID string) MetricSource {
	return MetricSource{
		Name: name,
		Mode: MetricSourceModeInCluster,
		InCluster: &MetricInClusterTarget{
			ClusterID: clusterID,
			Namespace: "monitoring",
			Service:   "kube-prometheus-stack-prometheus",
			Port:      "http-web",
			Scheme:    "http",
		},
	}
}

func TestMetricSourcesPersistAcrossServiceInstances(t *testing.T) {
	setTestConfigEnv(t)
	saved, err := newMetricHistoryTestFixture(t).MetricHistory.SaveMetricSource(inClusterSource("dev prometheus", "dev:dev-cluster"))
	require.NoError(t, err)
	require.NotEmpty(t, saved.ID, "a new source gets a stable identity")

	// A fresh owner over the same settings file sees the source: it is persisted, not cached.
	reloaded, err := newMetricHistoryTestFixture(t).MetricHistory.GetMetricSourceSettings()
	require.NoError(t, err)
	require.Equal(t, []MetricSource{*saved}, reloaded.Sources)
}

func TestSaveMetricSourceRejectsSourcesThatCannotBeQueried(t *testing.T) {
	setTestConfigEnv(t)
	service := newMetricHistoryTestFixture(t).MetricHistory
	_, err := service.SaveMetricSource(inClusterSource("dev prometheus", "dev:dev-cluster"))
	require.NoError(t, err)

	for name, mutate := range map[string]func(*MetricSource){
		"missing name":        func(source *MetricSource) { source.Name = "  " },
		"duplicate name":      func(source *MetricSource) { source.Name = "DEV Prometheus" },
		"unsupported mode":    func(source *MetricSource) { source.Mode = "external" },
		"missing target":      func(source *MetricSource) { source.InCluster = nil },
		"missing cluster":     func(source *MetricSource) { source.InCluster.ClusterID = "" },
		"missing namespace":   func(source *MetricSource) { source.InCluster.Namespace = "" },
		"missing service":     func(source *MetricSource) { source.InCluster.Service = "" },
		"missing port":        func(source *MetricSource) { source.InCluster.Port = "" },
		"unsupported scheme":  func(source *MetricSource) { source.InCluster.Scheme = "ftp" },
		"query in the prefix": func(source *MetricSource) { source.InCluster.PathPrefix = "/prom?x=1" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := inClusterSource("other prometheus", "dev:dev-cluster")
			mutate(&candidate)
			_, err := service.SaveMetricSource(candidate)
			require.Error(t, err)
			settings, getErr := service.GetMetricSourceSettings()
			require.NoError(t, getErr)
			require.Len(t, settings.Sources, 1, "a rejected source must not be persisted")
		})
	}
}

func TestSaveMetricSourceNormalizesTheProxyTarget(t *testing.T) {
	setTestConfigEnv(t)
	candidate := inClusterSource("  dev prometheus ", "dev:dev-cluster")
	candidate.InCluster.Scheme = ""
	candidate.InCluster.PathPrefix = "prometheus/"
	saved, err := newMetricHistoryTestFixture(t).MetricHistory.SaveMetricSource(candidate)
	require.NoError(t, err)
	require.Equal(t, "dev prometheus", saved.Name)
	require.Equal(t, "http", saved.InCluster.Scheme)
	require.Equal(t, "/prometheus", saved.InCluster.PathPrefix)
}

func TestInClusterSourcesCanOnlyServeTheirOwnCluster(t *testing.T) {
	setTestConfigEnv(t)
	service := newMetricHistoryTestFixture(t).MetricHistory
	source, err := service.SaveMetricSource(inClusterSource("dev prometheus", "dev:dev-cluster"))
	require.NoError(t, err)

	require.NoError(t, service.SetClusterMetricAssignment("dev:dev-cluster", MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: source.ID}))
	require.Error(t, service.SetClusterMetricAssignment("stg:stg-cluster", MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: source.ID}))
	require.Error(t, service.SetClusterMetricAssignment("stg:stg-cluster", MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: "missing"}))
	require.NoError(t, service.SetClusterMetricAssignment("stg:stg-cluster", MetricClusterAssignment{Kind: MetricAssignmentNone}))

	settings, err := service.GetMetricSourceSettings()
	require.NoError(t, err)
	require.Equal(t, map[string]MetricClusterAssignment{
		"dev:dev-cluster": {Kind: MetricAssignmentSource, SourceID: source.ID},
		"stg:stg-cluster": {Kind: MetricAssignmentNone},
	}, settings.Assignments)

	// Moving the source to another cluster would strand its existing assignment.
	moved := *source
	movedTarget := *source.InCluster
	movedTarget.ClusterID = "stg:stg-cluster"
	moved.InCluster = &movedTarget
	_, err = service.SaveMetricSource(moved)
	require.Error(t, err)
}

func TestUsingTheDefaultRemovesTheClusterEntry(t *testing.T) {
	setTestConfigEnv(t)
	fixture := newMetricHistoryTestFixture(t)
	service := fixture.MetricHistory
	require.NoError(t, service.SetClusterMetricAssignment("stg:stg-cluster", MetricClusterAssignment{Kind: MetricAssignmentNone}))
	require.NoError(t, service.SetClusterMetricAssignment("stg:stg-cluster", MetricClusterAssignment{Kind: MetricAssignmentDefault}))

	settings, err := service.GetMetricSourceSettings()
	require.NoError(t, err)
	require.Empty(t, settings.Assignments)
	file, err := fixture.Preferences.loadSettingsFile()
	require.NoError(t, err)
	require.NotContains(t, file.Clusters, "stg:stg-cluster", "an empty cluster section is pruned")
}

func TestDeletingASourceClearsTheAssignmentsThatNameIt(t *testing.T) {
	setTestConfigEnv(t)
	service := newMetricHistoryTestFixture(t).MetricHistory
	source, err := service.SaveMetricSource(inClusterSource("dev prometheus", "dev:dev-cluster"))
	require.NoError(t, err)
	require.NoError(t, service.SetClusterMetricAssignment("dev:dev-cluster", MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: source.ID}))
	require.NoError(t, service.SetClusterMetricAssignment("stg:stg-cluster", MetricClusterAssignment{Kind: MetricAssignmentNone}))

	require.NoError(t, service.DeleteMetricSource(source.ID))
	require.Error(t, service.DeleteMetricSource(source.ID), "deleting twice reports the missing source")

	settings, err := service.GetMetricSourceSettings()
	require.NoError(t, err)
	require.Empty(t, settings.Sources)
	require.Equal(t, map[string]MetricClusterAssignment{"stg:stg-cluster": {Kind: MetricAssignmentNone}}, settings.Assignments)
}

func TestMetricAssignmentKeepsItsClusterSectionWhenTheNamespaceScopeEmpties(t *testing.T) {
	setTestConfigEnv(t)
	fixture := newMetricHistoryTestFixture(t)
	require.NoError(t, fixture.MetricHistory.SetClusterMetricAssignment("dev:dev-cluster", MetricClusterAssignment{Kind: MetricAssignmentNone}))
	_, err := fixture.Preferences.saveClusterAllowedNamespaces("dev:dev-cluster", []string{"team-a"})
	require.NoError(t, err)

	// Clearing the namespace scope empties that field only; the metrics choice must survive.
	_, err = fixture.Preferences.saveClusterAllowedNamespaces("dev:dev-cluster", nil)
	require.NoError(t, err)
	settings, err := fixture.MetricHistory.GetMetricSourceSettings()
	require.NoError(t, err)
	require.Equal(t, MetricClusterAssignment{Kind: MetricAssignmentNone}, settings.Assignments["dev:dev-cluster"])
}

func TestEditingASourceKeepsItsIdentityAndAssignments(t *testing.T) {
	setTestConfigEnv(t)
	service := newMetricHistoryTestFixture(t).MetricHistory
	source, err := service.SaveMetricSource(inClusterSource("dev prometheus", "dev:dev-cluster"))
	require.NoError(t, err)
	require.NoError(t, service.SetClusterMetricAssignment("dev:dev-cluster", MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: source.ID}))

	edited := *source
	edited.Name = "dev thanos"
	editedTarget := *source.InCluster
	editedTarget.PathPrefix = "/thanos"
	edited.InCluster = &editedTarget
	_, err = service.SaveMetricSource(edited)
	require.NoError(t, err)

	settings, err := service.GetMetricSourceSettings()
	require.NoError(t, err)
	require.Equal(t, []MetricSource{edited}, settings.Sources, "an edit replaces the source in place")
	require.Equal(t, MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: source.ID}, settings.Assignments["dev:dev-cluster"])

	// A save for a source deleted elsewhere (e.g. another window) must not recreate it.
	require.NoError(t, service.DeleteMetricSource(source.ID))
	_, err = service.SaveMetricSource(edited)
	require.ErrorIs(t, err, errMetricSourceNotFound)
}

type fakeServiceCatalog struct {
	pages   []objectcatalog.QueryResult
	queries []objectcatalog.QueryOptions
}

func (catalog *fakeServiceCatalog) Query(options objectcatalog.QueryOptions) objectcatalog.QueryResult {
	catalog.queries = append(catalog.queries, options)
	page := catalog.pages[0]
	catalog.pages = catalog.pages[1:]
	return page
}

func serviceSummary(group, namespace, name string) objectcatalog.Summary {
	return objectcatalog.Summary{Ref: resourcemodel.ResourceRef{Group: group, Version: "v1", Kind: "Service", Namespace: namespace, Name: name}}
}

func TestServiceCandidatesListEveryCoreServiceOfTheConnectedCluster(t *testing.T) {
	catalog := &fakeServiceCatalog{pages: []objectcatalog.QueryResult{
		{Items: []objectcatalog.Summary{serviceSummary("", "monitoring", "prometheus-operated")}, ContinueToken: "page-2"},
		{Items: []objectcatalog.Summary{
			// Knative's serving.knative.dev Service shares the kind name; it is not a proxy target.
			serviceSummary("serving.knative.dev", "apps", "hello"),
			serviceSummary("", "kube-prometheus-stack", "kube-prometheus-stack-prometheus"),
		}},
	}}
	service := NewMetricHistoryService(MetricHistoryServiceDependencies{
		ServiceCatalog: func(clusterID string) metricServiceCatalog {
			require.Equal(t, "dev:dev-cluster", clusterID)
			return catalog
		},
	})

	candidates, err := service.ListMetricServiceCandidates("dev:dev-cluster")
	require.NoError(t, err)
	require.Equal(t, []MetricServiceCandidate{
		{Namespace: "kube-prometheus-stack", Name: "kube-prometheus-stack-prometheus"},
		{Namespace: "monitoring", Name: "prometheus-operated"},
	}, candidates)
	require.Len(t, catalog.queries, 2, "every page is read")
	require.Equal(t, "page-2", catalog.queries[1].Continue)
	require.Equal(t, []string{"Service"}, catalog.queries[0].Kinds)
	require.Equal(t, []string{"(core)"}, catalog.queries[0].Groups)
}

func TestServiceCandidatesNeedAConnectedCluster(t *testing.T) {
	service := NewMetricHistoryService(MetricHistoryServiceDependencies{
		ServiceCatalog: func(string) metricServiceCatalog { return nil },
	})
	_, err := service.ListMetricServiceCandidates("dev:dev-cluster")
	require.ErrorIs(t, err, errMetricClusterNotConnected)
	_, err = service.ListMetricServiceCandidates(" ")
	require.Error(t, err)
}
