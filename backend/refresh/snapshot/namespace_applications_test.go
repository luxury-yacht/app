package snapshot

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type fakeApplicationAggregateSource struct {
	rows map[schema.GroupVersionResource][]interface{}
}

func (f fakeApplicationAggregateSource) AggregateRows(gvr schema.GroupVersionResource) []interface{} {
	return append([]interface{}(nil), f.rows[gvr]...)
}

func (f fakeApplicationAggregateSource) StoreResourceVersion(gvr schema.GroupVersionResource) string {
	if len(f.rows[gvr]) == 0 {
		return ""
	}
	return "9"
}

func TestNamespaceApplicationsQueryFacetsFilterAndKeepStructuralScopeOptions(t *testing.T) {
	items := []NamespaceApplicationSummary{
		{Name: "healthy", Namespace: "team-a", Confidence: resourcemodel.ApplicationConfidenceHigh, Status: "Healthy"},
		{Name: "warning", Namespace: "team-a", Confidence: resourcemodel.ApplicationConfidenceLow, Status: "Needs attention", NeedsAttention: 2},
		{Name: "unknown", Namespace: "team-a", Confidence: resourcemodel.ApplicationConfidenceMedium, Status: "Unknown"},
	}
	page := applyTypedTableQueryViaStore(
		items,
		typedTableQuery{
			Enabled: true,
			Request: ResourceQueryRequest{
				ClusterID: "cluster-a",
				Limit:     50,
				Facets: map[string][]string{
					"statuses":    {"Needs attention"},
					"confidences": {"low"},
					"hasIssues":   {"true"},
				},
			},
		},
		namespaceApplicationsTableQueryAdapter(),
		namespaceApplicationsQuerypageSchema(),
	)

	require.Len(t, page.Rows, 1)
	require.Equal(t, "warning", page.Rows[0].Name)
	require.Equal(t, []string{"Healthy", "Needs attention", "Unknown"}, testFacetOptionValues(page.FacetValues, "statuses"))
	require.Equal(t, []string{"high", "low", "medium"}, testFacetOptionValues(page.FacetValues, "confidences"))
	require.Equal(t, []string{"false", "true"}, testFacetOptionValues(page.FacetValues, "hasIssues"))
	require.True(t, page.FacetsExact)
	require.Equal(t, []ResourceQueryFacetOption{
		{Value: "false", Label: "No issues"},
		{Value: "true", Label: "Has issues"},
	}, page.FacetValues[2].Options)
}

func TestNamespaceApplicationsQueryViaStoreEquivalent(t *testing.T) {
	items := []NamespaceApplicationSummary{
		{Name: "healthy", Namespace: "team-a", Confidence: resourcemodel.ApplicationConfidenceHigh, Status: "Healthy", WorkloadCount: 4},
		{Name: "warning", Namespace: "team-a", Confidence: resourcemodel.ApplicationConfidenceLow, Status: "Needs attention", WorkloadCount: 2, NeedsAttention: 2},
		{Name: "unknown", Namespace: "team-b", Confidence: resourcemodel.ApplicationConfidenceMedium, Status: "Unknown", WorkloadCount: 1},
	}
	selections := []map[string][]string{
		nil,
		{"statuses": {"Healthy"}},
		{"confidences": {"medium"}},
		{"hasIssues": {"true"}},
		{"statuses": {"Needs attention"}, "confidences": {"low"}, "hasIssues": {"true"}},
	}

	for _, sortField := range []string{"name", "namespace", "confidence", "status", "workloadCount", "needsAttention"} {
		for _, direction := range []string{"asc", "desc"} {
			for _, facets := range selections {
				query := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID:     "cluster-a",
						Limit:         2,
						SortField:     sortField,
						SortDirection: direction,
						Facets:        facets,
					},
				}
				live := applyTypedTableQuery(items, query, namespaceApplicationsTableQueryAdapter())
				engine := applyTypedTableQueryViaStore(items, query, namespaceApplicationsTableQueryAdapter(), namespaceApplicationsQuerypageSchema())
				require.Equal(t, live.Rows, engine.Rows, "sort=%s direction=%s facets=%v", sortField, direction, facets)
				require.Equal(t, live.Total, engine.Total, "sort=%s direction=%s facets=%v", sortField, direction, facets)
				require.Equal(t, live.UnfilteredTotal, engine.UnfilteredTotal, "sort=%s direction=%s facets=%v", sortField, direction, facets)
				require.Equal(t, live.FacetValues, engine.FacetValues, "sort=%s direction=%s facets=%v", sortField, direction, facets)
			}
		}
	}
}

func TestNamespaceApplicationsQueryFacetsPublishExactEmptyOptionSets(t *testing.T) {
	page := applyTypedTableQueryViaStore(
		[]NamespaceApplicationSummary{},
		typedTableQuery{Enabled: true, Request: ResourceQueryRequest{ClusterID: "cluster-a", Limit: 50}},
		namespaceApplicationsTableQueryAdapter(),
		namespaceApplicationsQuerypageSchema(),
	)

	require.True(t, page.FacetsExact)
	require.Len(t, page.FacetValues, 3)
	for _, facet := range page.FacetValues {
		require.True(t, facet.Exact)
		require.Empty(t, facet.Options)
	}
}

func TestNamespaceApplicationsBuilderGroupsEvidenceAndPreservesNavigationIdentity(t *testing.T) {
	helmCandidate := resourcemodel.ApplicationCandidate{
		Name:       "payments",
		Evidence:   resourcemodel.ApplicationEvidenceHelm,
		Confidence: resourcemodel.ApplicationConfidenceMedium,
	}
	labelCandidate := resourcemodel.ApplicationCandidate{
		Name:       "observability",
		Evidence:   resourcemodel.ApplicationEvidenceLabel,
		Confidence: resourcemodel.ApplicationConfidenceLow,
	}
	ownerRoot := resourcemodel.NewResourceRef("cluster-a", "batch", "v1", "CronJob", "cronjobs", "team-a", "nightly", "cron-uid")
	ownerCandidate := resourcemodel.ApplicationCandidate{
		Name:       "nightly",
		Evidence:   resourcemodel.ApplicationEvidenceOwner,
		Confidence: resourcemodel.ApplicationConfidenceMedium,
		Root:       &ownerRoot,
	}
	source := fakeApplicationAggregateSource{rows: map[schema.GroupVersionResource][]interface{}{
		DeploymentGVR: {
			applicationMemberAggregate{
				Ref:          resourcemodel.NewResourceRef("cluster-a", "apps", "v1", "Deployment", "deployments", "team-a", "payments-api", "deploy-uid"),
				Candidate:    helmCandidate,
				Presentation: "ready",
			},
			applicationMemberAggregate{
				Ref:          resourcemodel.NewResourceRef("cluster-a", "apps", "v1", "Deployment", "deployments", "team-a", "collector", "collector-uid"),
				Candidate:    labelCandidate,
				Presentation: "warning",
			},
			applicationMemberAggregate{
				Ref:          resourcemodel.NewResourceRef("cluster-a", "apps", "v1", "Deployment", "deployments", "team-b", "other", "other-uid"),
				Candidate:    labelCandidate,
				Presentation: "ready",
			},
		},
		JobGVR: {
			applicationMemberAggregate{
				Ref:          resourcemodel.NewResourceRef("cluster-a", "batch", "v1", "Job", "jobs", "team-a", "nightly-123", "job-uid"),
				Candidate:    ownerCandidate,
				Presentation: "error",
			},
		},
		SecretGVR: {
			resourcemodel.HelmReleaseStorageCandidate{Namespace: "team-a", Name: "payments", Revision: 2, Status: "deployed"},
		},
	}}
	builder := &NamespaceApplicationsBuilder{aggregates: source, permissions: allNamespaceApplicationsPermissions()}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "cluster-a|namespace:team-a?sort=name&direction=asc&limit=50")
	require.NoError(t, err)
	payload := snap.Payload.(NamespaceApplicationsSnapshot)
	require.Len(t, payload.Rows, 3)
	require.Equal(t, 0, payload.UngroupedWorkloads)

	payments := payload.Rows[2]
	require.Equal(t, "payments", payments.Name)
	require.Equal(t, resourcemodel.ApplicationConfidenceHigh, payments.Confidence)
	require.Equal(t, []resourcemodel.ApplicationEvidence{resourcemodel.ApplicationEvidenceHelm}, payments.Evidence)
	require.Equal(t, 1, payments.WorkloadCount)
	require.NotNil(t, payments.Root)
	require.Equal(t, "cluster-a", payments.Root.ClusterID)
	require.Equal(t, "helm.sh", payments.Root.Group)
	require.Equal(t, "v3", payments.Root.Version)
	require.Equal(t, "HelmRelease", payments.Root.Kind)
	require.Equal(t, "team-a", payments.Root.Namespace)
	require.Equal(t, "payments", payments.Root.Name)

	observability := payload.Rows[1]
	require.Equal(t, resourcemodel.ApplicationConfidenceLow, observability.Confidence)
	require.Nil(t, observability.Root)
	require.Equal(t, "Needs attention", observability.Status)
	require.Equal(t, "warning", observability.StatusPresentation)

	nightly := payload.Rows[0]
	require.Equal(t, resourcemodel.ApplicationConfidenceMedium, nightly.Confidence)
	require.NotNil(t, nightly.Root)
	require.Equal(t, "CronJob", nightly.Root.Kind)
	require.Equal(t, "error", nightly.StatusPresentation)

	for _, row := range payload.Rows {
		require.Equal(t, "team-a", row.Namespace)
		require.Equal(t, "cluster-a", row.ClusterID)
	}
}

func TestNamespaceApplicationsBuilderReportsUngroupedAndInactiveHelmStorage(t *testing.T) {
	source := fakeApplicationAggregateSource{rows: map[schema.GroupVersionResource][]interface{}{
		DeploymentGVR: {
			applicationMemberAggregate{Ref: resourcemodel.NewResourceRef("cluster-a", "apps", "v1", "Deployment", "deployments", "team-a", "plain", "plain-uid"), Presentation: "ready"},
		},
		SecretGVR: {
			resourcemodel.HelmReleaseStorageCandidate{Namespace: "team-a", Name: "old", Revision: 3, Status: "deployed"},
			resourcemodel.HelmReleaseStorageCandidate{Namespace: "team-a", Name: "old", Revision: 4, Status: "uninstalled"},
		},
	}}
	builder := &NamespaceApplicationsBuilder{aggregates: source, permissions: allNamespaceApplicationsPermissions()}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "cluster-a|namespace:team-a?limit=50")
	require.NoError(t, err)
	payload := snap.Payload.(NamespaceApplicationsSnapshot)
	require.Empty(t, payload.Rows)
	require.Equal(t, 1, payload.UngroupedWorkloads)
}

func TestNamespaceApplicationsBuilderOmitsDeniedSourcesAndReportsPartial(t *testing.T) {
	source := fakeApplicationAggregateSource{rows: map[schema.GroupVersionResource][]interface{}{
		DeploymentGVR: {
			applicationMemberAggregate{
				Ref: resourcemodel.NewResourceRef("cluster-a", "apps", "v1", "Deployment", "deployments", "team-a", "api", "api-uid"),
				Candidate: resourcemodel.ApplicationCandidate{
					Name: "payments", Evidence: resourcemodel.ApplicationEvidenceLabel, Confidence: resourcemodel.ApplicationConfidenceLow,
				},
			},
		},
	}}
	builder := &NamespaceApplicationsBuilder{
		aggregates: source,
		permissions: NamespaceApplicationsPermissions{
			IncludePods: true,
		},
	}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"})

	snap, err := builder.Build(ctx, "cluster-a|namespace:team-a?limit=50")
	require.NoError(t, err)
	payload := snap.Payload.(NamespaceApplicationsSnapshot)
	require.Empty(t, payload.Rows)
	require.Equal(t, ResourceQueryPartial, payload.Completeness)
	require.NotEmpty(t, payload.Issues)
	require.False(t, payload.FacetsExact)
	require.Len(t, payload.FacetValues, 3)
	for _, facet := range payload.FacetValues {
		require.False(t, facet.Exact, "facet %s must disclose permission-degraded options", facet.Key)
	}
}

func allNamespaceApplicationsPermissions() NamespaceApplicationsPermissions {
	return NamespaceApplicationsPermissions{
		IncludePods:         true,
		IncludeDeployments:  true,
		IncludeStatefulSets: true,
		IncludeDaemonSets:   true,
		IncludeJobs:         true,
		IncludeCronJobs:     true,
		IncludeConfigMaps:   true,
		IncludeSecrets:      true,
	}
}
