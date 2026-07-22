package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildDeploymentSummaryCarriesCanonicalResourceRef(t *testing.T) {
	object := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{
		Name:      "api",
		Namespace: "team-a",
		UID:       "deployment-uid",
	}}

	row := (&NamespaceWorkloadsBuilder{}).buildDeploymentSummary(
		"cluster-a",
		object,
		nil,
		nil,
	)

	require.Equal(t, deployment.BuildResourceModel("cluster-a", object).Ref, row.Ref)
}

func TestRemainingWorkloadSummariesCarryCanonicalResourceRefs(t *testing.T) {
	builder := &NamespaceWorkloadsBuilder{}
	meta := metav1.ObjectMeta{Name: "worker", Namespace: "team-a", UID: "object-uid"}

	t.Run("StatefulSet", func(t *testing.T) {
		object := &appsv1.StatefulSet{ObjectMeta: meta}
		row := builder.buildStatefulSetSummary("cluster-a", object, nil, nil)
		require.Equal(t, statefulset.BuildResourceModel("cluster-a", object).Ref, row.Ref)
	})

	t.Run("DaemonSet", func(t *testing.T) {
		object := &appsv1.DaemonSet{ObjectMeta: meta}
		row := builder.buildDaemonSetSummary("cluster-a", object, nil, nil)
		require.Equal(t, daemonset.BuildResourceModel("cluster-a", object).Ref, row.Ref)
	})

	t.Run("Job", func(t *testing.T) {
		object := &batchv1.Job{ObjectMeta: meta}
		row := builder.buildJobSummary("cluster-a", object, nil, nil)
		require.Equal(t, job.BuildResourceModel("cluster-a", object).Ref, row.Ref)
	})

	t.Run("CronJob", func(t *testing.T) {
		object := &batchv1.CronJob{ObjectMeta: meta}
		row := builder.buildCronJobSummary("cluster-a", object, nil, nil)
		require.Equal(t, cronjob.BuildResourceModel("cluster-a", object).Ref, row.Ref)
	})

	t.Run("Pod", func(t *testing.T) {
		object := &corev1.Pod{ObjectMeta: meta}
		podRow := pods.BuildStreamSummaryFromRSMap(
			ClusterMeta{ClusterID: "cluster-a"}, object, 0, 0, nil,
		)
		row := buildStandalonePodSummaryFromRows(
			podRow,
			projectPodAggregate(object, PodOwnerSources{}),
			nil,
		)
		require.Equal(t, pods.BuildResourceModel("cluster-a", object).Ref, row.Ref)
	})
}

func TestSortWorkloadSummariesUsesNamespaceTieBreaker(t *testing.T) {
	items := []WorkloadSummary{
		{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "beta", Name: "api"}},
		{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "alpha", Name: "api"}},
		{Ref: resourcemodel.ResourceRef{Kind: "DaemonSet", Namespace: "ops", Name: "agent"}},
		{Ref: resourcemodel.ResourceRef{Kind: "StatefulSet", Namespace: "alpha", Name: "db"}},
	}

	sortWorkloadSummaries(items)

	expected := []WorkloadSummary{
		{Ref: resourcemodel.ResourceRef{Kind: "DaemonSet", Namespace: "ops", Name: "agent"}},
		{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "alpha", Name: "api"}},
		{Ref: resourcemodel.ResourceRef{Kind: "Deployment", Namespace: "beta", Name: "api"}},
		{Ref: resourcemodel.ResourceRef{Kind: "StatefulSet", Namespace: "alpha", Name: "db"}},
	}

	for idx := range expected {
		got := items[idx]
		want := expected[idx]
		if got.Ref.Kind != want.Ref.Kind || got.Ref.Name != want.Ref.Name || got.Ref.Namespace != want.Ref.Namespace {
			t.Fatalf("unexpected order at index %d: got %s/%s in %s, want %s/%s in %s",
				idx, got.Ref.Kind, got.Ref.Name, got.Ref.Namespace, want.Ref.Kind, want.Ref.Name, want.Ref.Namespace)
		}
	}
}

// The envelope-published kind vocabulary narrows to the kinds whose backing
// listers exist: a builder with no listers can produce no rows, so it offers
// no kinds. (The static family vocabulary stays full — conformance pins it.)
func TestNamespaceWorkloadsCapabilitiesNarrowToAvailableSources(t *testing.T) {
	builder := &NamespaceWorkloadsBuilder{}
	capabilities := builder.queryCapabilities()
	if len(capabilities.KindVocabulary) != 0 {
		t.Errorf("expected an empty kind vocabulary with no listers, got %v", capabilities.KindVocabulary)
	}
}
