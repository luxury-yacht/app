package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/testsupport"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestNewPodIngestProjectorBundleMatchesLivePaths proves the four-half bundle the
// pod ingest projector builds is byte-equivalent, half by half, to what each live
// consumer path builds from the typed pod:
//
//   - Table     == pods.BuildStreamSummary with no-data metrics (the maintained-store
//     handler's projection);
//   - Aggregate == projectPodAggregate with the SAME rsLister (the 3 domains' read);
//   - Catalog   == objectcatalog.SummaryProjector for pods (the catalog's projection);
//   - ObjectMap == objectmapnode.NewNodeProjector from the pod descriptor (the
//     object-map's projection).
func TestNewPodIngestProjectorBundleMatchesLivePaths(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}

	rsWithDeploy := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "web-7d9c8b6f5",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "Deployment", Name: "web", Controller: ptrBool(true), APIVersion: "apps/v1"},
			},
		},
	}
	rsLister := testsupport.NewReplicaSetLister(t, rsWithDeploy)

	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Namespace:         "team-a",
				Name:              "web-7d9c8b6f5-abcde",
				UID:               "uid-1",
				CreationTimestamp: metav1.Now(),
				OwnerReferences: []metav1.OwnerReference{
					{Kind: "ReplicaSet", Name: "web-7d9c8b6f5", Controller: ptrBool(true), APIVersion: "apps/v1"},
				},
			},
			Spec: corev1.PodSpec{
				NodeName: "node-1",
				Containers: []corev1.Container{
					{Name: "app", Ports: []corev1.ContainerPort{{ContainerPort: 8080}}},
				},
			},
			Status: corev1.PodStatus{Phase: corev1.PodRunning},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Namespace: "batch", Name: "standalone", UID: "uid-2"},
			Spec:       corev1.PodSpec{NodeName: "node-2", Containers: []corev1.Container{{Name: "c"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodPending},
		},
	}

	project := NewPodIngestProjector(meta, PodOwnerSources{ReplicaSets: rsLister})

	streamMeta := meta // ClusterMeta is a type alias of streamrows.ClusterMeta
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, podres.Identity)
	nodeProject := objectmapnode.NewNodeProjector(podres.ObjectMapNode.Status, podres.ObjectMapNode.ActionFacts, podres.ObjectMapEdges)

	for _, pod := range pods {
		raw, err := project(pod)
		if err != nil {
			t.Fatalf("projector returned error for %s/%s: %v", pod.Namespace, pod.Name, err)
		}
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			t.Fatalf("projector returned %T, want ingest.Bundle", raw)
		}

		wantTable := podSummaryWithoutMetrics(podres.BuildStreamSummary(streamMeta, pod, 0, 0, rsLister, nil))
		if gotTable, ok := bundle.Table.(streamrows.PodSummary); !ok || gotTable != wantTable {
			t.Fatalf("Table half mismatch for %s/%s:\n got=%#v\nwant=%#v", pod.Namespace, pod.Name, bundle.Table, wantTable)
		}

		wantAgg := projectPodAggregate(pod, PodOwnerSources{ReplicaSets: rsLister})
		if gotAgg, ok := bundle.Aggregate.(streamrows.PodAggregate); !ok || gotAgg != wantAgg {
			t.Fatalf("Aggregate half mismatch for %s/%s:\n got=%#v\nwant=%#v", pod.Namespace, pod.Name, bundle.Aggregate, wantAgg)
		}
		if wantIndexes := podAggregateBundleIndexes(wantAgg); !reflect.DeepEqual(bundle.Indexes, wantIndexes) {
			t.Fatalf("Indexes mismatch for %s/%s:\n got=%#v\nwant=%#v", pod.Namespace, pod.Name, bundle.Indexes, wantIndexes)
		}

		wantCatalog, ok := catalogProject(pod).(objectcatalog.Summary)
		if !ok {
			t.Fatalf("catalogProject returned %T, want objectcatalog.Summary", catalogProject(pod))
		}
		gotCatalog, ok := bundle.Catalog.(objectcatalog.Summary)
		if !ok {
			t.Fatalf("Catalog half is %T, want objectcatalog.Summary", bundle.Catalog)
		}
		// Summary carries an *ActionFacts pointer, so compare with DeepEqual (which
		// follows the pointer) rather than ==, whose pointer field would otherwise
		// differ by allocation, not content.
		if !reflect.DeepEqual(gotCatalog, wantCatalog) {
			t.Fatalf("Catalog half mismatch for %s/%s:\n got=%#v\nwant=%#v", pod.Namespace, pod.Name, gotCatalog, wantCatalog)
		}

		wantNode := nodeProject(meta.ClusterID, pod)
		gotNode, ok := bundle.ObjectMap.(objectmapnode.Node)
		if !ok {
			t.Fatalf("ObjectMap half is %T, want objectmapnode.Node", bundle.ObjectMap)
		}
		if gotNode.Namespace != wantNode.Namespace || gotNode.Name != wantNode.Name || gotNode.UID != wantNode.UID ||
			gotNode.CreationTimestamp != wantNode.CreationTimestamp {
			t.Fatalf("ObjectMap node metadata mismatch for %s/%s:\n got=%#v\nwant=%#v", pod.Namespace, pod.Name, gotNode, wantNode)
		}
	}
}

// TestNewPodIngestProjectorRejectsNonPod proves a non-Pod object yields the typed
// guard error so the ProjectingStore logs-once and skips it, never panicking.
func TestNewPodIngestProjectorRejectsNonPod(t *testing.T) {
	project := NewPodIngestProjector(ClusterMeta{ClusterID: "c-1"}, PodOwnerSources{})
	if _, err := project(&corev1.ConfigMap{}); err == nil {
		t.Fatal("expected error for non-Pod object, got nil")
	}
}
