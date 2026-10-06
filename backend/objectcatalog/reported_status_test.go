package objectcatalog

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

var argoCDApplicationDescriptor = builtinDescriptor("argoproj.io", "v1alpha1", "Application", "applications", true)

func reportedStatusTestObject(group, kind, resourceVersion string, status map[string]any) *unstructured.Unstructured {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": group + "/v1alpha1",
		"kind":       kind,
		"metadata": map[string]any{
			"name": "storefront", "namespace": "argocd", "uid": "app-uid", "resourceVersion": resourceVersion,
			"creationTimestamp": "2026-09-01T08:00:00Z",
		},
	}}
	if status != nil {
		object.Object["status"] = status
	}
	return object
}

func applicationStatus(sync, health string) map[string]any {
	return map[string]any{"sync": map[string]any{"status": sync}, "health": map[string]any{"status": health}}
}

func TestSummaryReportsArgoCDApplicationSyncHealthOperationAndConditions(t *testing.T) {
	status := applicationStatus("OutOfSync", "Degraded")
	status["operationState"] = map[string]any{"phase": "Failed", "message": "one or more objects failed to apply"}
	// Application conditions carry no status: each one listed is active.
	status["conditions"] = []any{
		map[string]any{"type": "SyncError", "message": "auto-sync failed"},
		map[string]any{"type": "ComparisonError", "message": "repository not accessible"},
	}
	summary := summaryFromObject("cluster-a", argoCDApplicationDescriptor,
		reportedStatusTestObject("argoproj.io", "Application", "1", status))
	reported, ok := summary.ReportedStatus()
	require.True(t, ok)
	require.Equal(t, map[string][]string{
		ReportedStatusSync:       {"OutOfSync"},
		ReportedStatusHealth:     {"Degraded"},
		ReportedStatusOperation:  {"Failed"},
		ReportedStatusConditions: {"ComparisonError", "SyncError"},
	}, reported.Statuses)
	require.Equal(t, summary.Ref, reported.Ref)
	require.Equal(t, time.Date(2026, time.September, 1, 8, 0, 0, 0, time.UTC).UnixMilli(), reported.CreationTimestamp)

	// An Application Argo CD has not compared yet still reports, as Unknown, so it stays tracked.
	pending, ok := summaryFromObject("cluster-a", argoCDApplicationDescriptor,
		reportedStatusTestObject("argoproj.io", "Application", "1", nil)).ReportedStatus()
	require.True(t, ok)
	require.Equal(t, map[string][]string{ReportedStatusSync: {"Unknown"}, ReportedStatusHealth: {"Unknown"}}, pending.Statuses)

	project := builtinDescriptor("argoproj.io", "v1alpha1", "AppProject", "appprojects", true)
	_, ok = summaryFromObject("cluster-a", project,
		reportedStatusTestObject("argoproj.io", "AppProject", "1", applicationStatus("OutOfSync", "Degraded"))).ReportedStatus()
	require.False(t, ok, "AppProjects report no status")

	vela := builtinDescriptor("core.oam.dev", "v1beta1", "Application", "applications", true)
	_, ok = summaryFromObject("cluster-a", vela,
		reportedStatusTestObject("core.oam.dev", "Application", "1", applicationStatus("OutOfSync", "Degraded"))).ReportedStatus()
	require.False(t, ok, "an Application from another API group is not an Argo CD Application")
}

func TestSummaryReportsArgoCDApplicationSetTrueConditions(t *testing.T) {
	desc := builtinDescriptor("argoproj.io", "v1alpha1", "ApplicationSet", "applicationsets", true)
	status := map[string]any{"conditions": []any{
		map[string]any{"type": "ErrorOccurred", "status": "True", "message": "failed to list repositories"},
		map[string]any{"type": "ResourcesUpToDate", "status": "False"},
	}}
	reported, ok := summaryFromObject("cluster-a", desc,
		reportedStatusTestObject("argoproj.io", "ApplicationSet", "1", status)).ReportedStatus()
	require.True(t, ok)
	require.Equal(t, map[string][]string{
		ReportedStatusHealth:     {"Degraded"},
		ReportedStatusConditions: {"ErrorOccurred"},
	}, reported.Statuses, "only conditions whose status is True are active")

	// A healthy ApplicationSet still reports, so Attention keeps tracking it.
	healthy, ok := summaryFromObject("cluster-a", desc, reportedStatusTestObject("argoproj.io", "ApplicationSet", "1", nil)).ReportedStatus()
	require.True(t, ok)
	require.Equal(t, map[string][]string{ReportedStatusHealth: {"Unknown"}}, healthy.Statuses)
}

func TestReportedStatusSubscriptionPublishesStatusChanges(t *testing.T) {
	service := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	updates, unsubscribe := service.SubscribeReportedStatuses()
	defer unsubscribe()

	project := func(resourceVersion, sync, health string) map[string]Summary {
		return map[string]Summary{"app": summaryFromObject("cluster-a", argoCDApplicationDescriptor,
			reportedStatusTestObject("argoproj.io", "Application", resourceVersion, applicationStatus(sync, health)))}
	}
	service.publishSyncedAttentionSubsets(project("1", "OutOfSync", "Healthy"))
	require.Equal(t, uint64(1), (<-updates).Revision)
	statuses := service.ReportedStatuses()
	require.Len(t, statuses, 1)
	require.Equal(t, []string{"OutOfSync"}, statuses[0].Statuses[ReportedStatusSync])

	service.publishSyncedAttentionSubsets(project("2", "OutOfSync", "Healthy"))
	select {
	case unexpected := <-updates:
		t.Fatalf("resource-version-only update emitted reported-status revision %d", unexpected.Revision)
	default:
	}

	// A synced Application stays published so Attention keeps tracking the object (and its
	// per-object ignores) while it is healthy.
	service.publishSyncedAttentionSubsets(project("3", "Synced", "Healthy"))
	require.Equal(t, uint64(2), (<-updates).Revision)
	statuses = service.ReportedStatuses()
	require.Len(t, statuses, 1)
	require.Equal(t, []string{"Synced"}, statuses[0].Statuses[ReportedStatusSync])

	// A health change alone is a status change.
	service.publishSyncedAttentionSubsets(project("4", "Synced", "Degraded"))
	require.Equal(t, uint64(3), (<-updates).Revision)
	require.Equal(t, []string{"Degraded"}, service.ReportedStatuses()[0].Statuses[ReportedStatusHealth])

	service.publishSyncedAttentionSubsets(nil)
	require.Equal(t, uint64(4), (<-updates).Revision)
	require.Empty(t, service.ReportedStatuses())
}

func TestSummaryReportsKarpenterNodePoolLimitWarnings(t *testing.T) {
	desc := builtinDescriptor("karpenter.sh", "v1", "NodePool", "nodepools", false)
	pool := func(cpu, memory string) *unstructured.Unstructured {
		return &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "karpenter.sh/v1", "kind": "NodePool",
			"metadata": map[string]any{"name": "general", "uid": "pool-uid", "creationTimestamp": "2026-09-01T08:00:00Z"},
			"spec":     map[string]any{"limits": map[string]any{"cpu": "10", "memory": "100Gi"}},
			"status":   map[string]any{"resources": map[string]any{"cpu": cpu, "memory": memory}},
		}}
	}

	reported, ok := summaryFromObject("cluster-a", desc, pool("9", "10Gi")).ReportedStatus()
	require.True(t, ok)
	require.Equal(t, map[string][]string{ReportedStatusLimits: {"cpu"}}, reported.Statuses)

	// A NodePool within its limits still reports, so Attention keeps tracking it.
	within, ok := summaryFromObject("cluster-a", desc, pool("1", "10Gi")).ReportedStatus()
	require.True(t, ok)
	require.Empty(t, within.Statuses)

	claim := builtinDescriptor("karpenter.sh", "v1", "NodeClaim", "nodeclaims", false)
	object := pool("9", "10Gi")
	object.SetKind("NodeClaim")
	_, ok = summaryFromObject("cluster-a", claim, object).ReportedStatus()
	require.False(t, ok, "only NodePools report limit usage")
}

func requireNoSubsetUpdate(t *testing.T, updates <-chan SubsetUpdate) {
	t.Helper()
	select {
	case update := <-updates:
		t.Fatalf("subset published revision %d before the first full catalog sync", update.Revision)
	default:
	}
}

// Before the first full sync the catalog has not listed everything, so an empty or partial
// subset would read to Attention as objects having been deleted.
func TestAttentionSubsetsStaySilentUntilTheFirstFullSync(t *testing.T) {
	service := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	statuses, unsubscribeStatuses := service.SubscribeReportedStatuses()
	defer unsubscribeStatuses()
	blockers, unsubscribeBlockers := service.SubscribeFinalizerBlockers()
	defer unsubscribeBlockers()
	app := summaryFromObject("cluster-a", argoCDApplicationDescriptor,
		reportedStatusTestObject("argoproj.io", "Application", "1", applicationStatus("OutOfSync", "Healthy")))

	// Rows replayed or watched before the first full sync are a partial view.
	service.replaceAttentionSubsets(map[string]Summary{"app": app})
	service.updateAttentionSubsets([]catalogChange{{next: &app}})
	requireNoSubsetUpdate(t, statuses)
	requireNoSubsetUpdate(t, blockers)

	service.publishSyncedAttentionSubsets(map[string]Summary{"app": app})
	require.Equal(t, uint64(1), (<-statuses).Revision)
	require.Equal(t, uint64(1), (<-blockers).Revision, "an empty subset is published once the catalog has synced")
	require.Len(t, service.ReportedStatuses(), 1)

	// Once synced, later subscribers get the current revision at once, and changes publish.
	late, unsubscribeLate := service.SubscribeReportedStatuses()
	defer unsubscribeLate()
	require.Equal(t, uint64(1), (<-late).Revision)
	service.replaceAttentionSubsets(nil)
	require.Equal(t, uint64(2), (<-statuses).Revision)
}
