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

func TestSummaryReportsOnlyArgoCDApplicationSyncAndHealth(t *testing.T) {
	summary := summaryFromObject("cluster-a", argoCDApplicationDescriptor,
		reportedStatusTestObject("argoproj.io", "Application", "1", applicationStatus("OutOfSync", "Degraded")))
	reported, ok := summary.ReportedStatus()
	require.True(t, ok)
	require.Equal(t, map[string]string{ReportedStatusSync: "OutOfSync", ReportedStatusHealth: "Degraded"}, reported.Statuses)
	require.Equal(t, summary.Ref, reported.Ref)
	require.Equal(t, time.Date(2026, time.September, 1, 8, 0, 0, 0, time.UTC).UnixMilli(), reported.CreationTimestamp)

	// An Application Argo CD has not compared yet still reports, as Unknown, so it stays tracked.
	pending, ok := summaryFromObject("cluster-a", argoCDApplicationDescriptor,
		reportedStatusTestObject("argoproj.io", "Application", "1", nil)).ReportedStatus()
	require.True(t, ok)
	require.Equal(t, map[string]string{ReportedStatusSync: "Unknown", ReportedStatusHealth: "Unknown"}, pending.Statuses)

	project := builtinDescriptor("argoproj.io", "v1alpha1", "AppProject", "appprojects", true)
	_, ok = summaryFromObject("cluster-a", project,
		reportedStatusTestObject("argoproj.io", "AppProject", "1", applicationStatus("OutOfSync", "Degraded"))).ReportedStatus()
	require.False(t, ok, "only Applications report sync and health")

	vela := builtinDescriptor("core.oam.dev", "v1beta1", "Application", "applications", true)
	_, ok = summaryFromObject("cluster-a", vela,
		reportedStatusTestObject("core.oam.dev", "Application", "1", applicationStatus("OutOfSync", "Degraded"))).ReportedStatus()
	require.False(t, ok, "an Application from another API group is not an Argo CD Application")
}

func TestReportedStatusSubscriptionPublishesStatusChanges(t *testing.T) {
	service := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	updates, unsubscribe := service.SubscribeReportedStatuses()
	defer unsubscribe()
	require.Zero(t, (<-updates).Revision)

	project := func(resourceVersion, sync, health string) map[string]Summary {
		return map[string]Summary{"app": summaryFromObject("cluster-a", argoCDApplicationDescriptor,
			reportedStatusTestObject("argoproj.io", "Application", resourceVersion, applicationStatus(sync, health)))}
	}
	service.replaceAttentionSubsets(project("1", "OutOfSync", "Healthy"))
	require.Equal(t, uint64(1), (<-updates).Revision)
	statuses := service.ReportedStatuses()
	require.Len(t, statuses, 1)
	require.Equal(t, "OutOfSync", statuses[0].Statuses[ReportedStatusSync])

	service.replaceAttentionSubsets(project("2", "OutOfSync", "Healthy"))
	select {
	case unexpected := <-updates:
		t.Fatalf("resource-version-only update emitted reported-status revision %d", unexpected.Revision)
	default:
	}

	// A synced Application stays published so Attention keeps tracking the object (and its
	// per-object ignores) while it is healthy.
	service.replaceAttentionSubsets(project("3", "Synced", "Healthy"))
	require.Equal(t, uint64(2), (<-updates).Revision)
	statuses = service.ReportedStatuses()
	require.Len(t, statuses, 1)
	require.Equal(t, "Synced", statuses[0].Statuses[ReportedStatusSync])

	// A health change alone is a status change.
	service.replaceAttentionSubsets(project("4", "Synced", "Degraded"))
	require.Equal(t, uint64(3), (<-updates).Revision)
	require.Equal(t, "Degraded", service.ReportedStatuses()[0].Statuses[ReportedStatusHealth])

	service.replaceAttentionSubsets(nil)
	require.Equal(t, uint64(4), (<-updates).Revision)
	require.Empty(t, service.ReportedStatuses())
}
