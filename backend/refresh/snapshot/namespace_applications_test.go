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
