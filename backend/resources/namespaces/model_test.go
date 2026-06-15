package namespaces

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildNamespaceResourceModelFactsAndStatus(t *testing.T) {
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "apps",
			UID:               types.UID("namespace-uid"),
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)),
			Labels:            map[string]string{"team": "platform"},
		},
		Status: corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}
	opts := resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeRelationshipFacts}

	model := BuildResourceModel("cluster-a", ns, true, true, []string{"quota-a"}, []string{"limits-a"}, opts)
	require.Equal(t, resourcemodel.ResourceRef{
		ClusterID: "cluster-a",
		Group:     "",
		Version:   "v1",
		Kind:      "Namespace",
		Resource:  "namespaces",
		Name:      "apps",
		UID:       "namespace-uid",
	}, model.Ref)
	require.Equal(t, resourcemodel.ResourceSourceKubernetes, model.Source)
	require.Equal(t, resourcemodel.ResourceScopeCluster, model.Scope)
	require.Equal(t, "Active", model.Status.State)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, "status.phase", model.Status.Reason)
	require.Contains(t, model.Status.Signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalPhase, Name: "status.phase", Status: "Active"})
	require.Contains(t, model.Status.Signals, resourcemodel.ResourceStatusSignal{Type: resourcemodel.StatusSignalResourceState, Name: "workloads", Status: workloadStatePresent})

	facts := BuildFacts("cluster-a", ns, true, true, []string{"quota-a"}, []string{"limits-a"}, opts)
	require.Equal(t, "Active", facts.RawPhase)
	require.True(t, facts.HasWorkloads)
	require.True(t, facts.WorkloadsKnown)
	require.Equal(t, workloadStatePresent, facts.WorkloadState)
	require.Equal(t, "ResourceQuota", facts.ResourceQuotas[0].Ref.Kind)
	require.Equal(t, "quota-a", facts.ResourceQuotas[0].Ref.Name)
	require.Equal(t, "apps", facts.ResourceQuotas[0].Ref.Namespace)
	require.Equal(t, "LimitRange", facts.LimitRanges[0].Ref.Kind)
}

func TestBuildNamespaceFactsSummaryOmitsRelationshipFacts(t *testing.T) {
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "apps"},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}

	facts := BuildFacts("cluster-a", ns, false, true, []string{"quota-a"}, []string{"limits-a"}, resourcemodel.ResourceModelBuildOptions{})
	require.Equal(t, workloadStateNone, facts.WorkloadState)
	require.Empty(t, facts.ResourceQuotas)
	require.Empty(t, facts.LimitRanges)
}

func TestBuildNamespaceResourceModelTerminatingPreservesSourcePhase(t *testing.T) {
	deletionTime := metav1.NewTime(time.Date(2026, 1, 3, 12, 0, 0, 0, time.UTC))
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "apps", DeletionTimestamp: &deletionTime, Finalizers: []string{"kubernetes"}},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}

	model := BuildResourceModel("cluster-a", ns, false, false, nil, nil)
	require.Equal(t, "Terminating", model.Status.Label)
	require.Equal(t, "Active", model.Status.State)
	require.Equal(t, "terminating", model.Status.Presentation)
	require.True(t, model.Status.Lifecycle.Deleting)
	require.True(t, model.Status.Lifecycle.FinalizerBlocked)
	require.Contains(t, model.Status.Signals, resourcemodel.ResourceStatusSignal{
		Type:   resourcemodel.StatusSignalDeletion,
		Name:   "metadata.deletionTimestamp",
		Status: deletionTime.Time.Format(time.RFC3339),
	})

	facts := BuildFacts("cluster-a", ns, false, false, nil, nil, resourcemodel.ResourceModelBuildOptions{})
	require.Equal(t, workloadStateUnknown, facts.WorkloadState)
}
