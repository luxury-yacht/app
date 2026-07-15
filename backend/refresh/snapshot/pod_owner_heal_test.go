/*
 * backend/refresh/snapshot/pod_owner_heal_test.go
 *
 * The pod owner heal must reproduce, on an already-projected bundle, EXACTLY the
 * bundle a fresh projection with a synced ReplicaSet lister would build — no
 * drift between resolvePodOwner/workloadKindForPod and the heal's rewrite. The
 * equivalence test is the load-bearing one: it projects the same pod with an
 * empty lister (the connect-race state), heals it, and requires byte-equality
 * with the synced-lister projection.
 */

package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/testsupport"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func healTestReplicaSet() *appsv1.ReplicaSet {
	return &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "team-a",
			Name:      "web-7d9c8b6f5",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "Deployment", Name: "web", Controller: ptrBool(true), APIVersion: "apps/v1"},
			},
		},
	}
}

func healTestPod() *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "team-a",
			Name:              "web-7d9c8b6f5-abcde",
			UID:               "uid-1",
			CreationTimestamp: metav1.Unix(1700000000, 0),
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
	}
}

func projectPodBundle(t *testing.T, rsObjects ...*appsv1.ReplicaSet) ingest.Bundle {
	t.Helper()
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	project := NewPodIngestProjector(meta, PodOwnerSources{ReplicaSets: testsupport.NewReplicaSetLister(t, rsObjects...)})
	projected, err := project(healTestPod())
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	return projected.(ingest.Bundle)
}

func TestHealPodBundleReplicaSetOwnerMatchesFreshProjection(t *testing.T) {
	rs := healTestReplicaSet()

	// The connect-race state: pod projected while the RS lister was empty.
	raced := projectPodBundle(t)
	if got := raced.Table.(PodSummary).OwnerKind; got != "ReplicaSet" {
		t.Fatalf("raced projection owner = %q, want unresolved ReplicaSet", got)
	}

	healed, changed := HealPodBundleReplicaSetOwner(raced, rs.Namespace, rs.Name, "web")
	if !changed {
		t.Fatal("heal declined a raced bundle")
	}

	want := projectPodBundle(t, rs)
	if !reflect.DeepEqual(healed, want) {
		t.Fatalf("healed bundle diverges from fresh synced-lister projection:\nhealed: %#v\nwant:   %#v", healed, want)
	}
}

func TestHealPodBundleReplicaSetOwnerDeclinesNonMatches(t *testing.T) {
	rs := healTestReplicaSet()
	raced := projectPodBundle(t)

	// Different ReplicaSet name: not this pod's owner.
	if _, changed := HealPodBundleReplicaSetOwner(raced, rs.Namespace, "other-rs", "web"); changed {
		t.Fatal("heal accepted a bundle owned by a different ReplicaSet")
	}
	// Different namespace: same-named RS elsewhere must not match.
	if _, changed := HealPodBundleReplicaSetOwner(raced, "team-b", rs.Name, "web"); changed {
		t.Fatal("heal accepted a bundle from a different namespace")
	}
	// Already resolved: healing twice is a no-op.
	resolved := projectPodBundle(t, rs)
	if _, changed := HealPodBundleReplicaSetOwner(resolved, rs.Namespace, rs.Name, "web"); changed {
		t.Fatal("heal accepted an already-resolved bundle")
	}
	// Not a pod bundle at all.
	if _, changed := HealPodBundleReplicaSetOwner(ingest.Bundle{Table: "not-a-pod"}, rs.Namespace, rs.Name, "web"); changed {
		t.Fatal("heal accepted a non-pod bundle")
	}
}

func TestPodOwnerHealIndexValuesCoverBothOwnerKeys(t *testing.T) {
	values := PodOwnerHealIndexValues("team-a", "web-7d9c8b6f5", "web")
	want := map[string]bool{
		// The suffix-collapse OwnerKey the projector normally writes.
		WorkloadOwnerKey("Deployment", "team-a", "web"): true,
		// The fallback OwnerKey when the RS name has no collapsible suffix.
		WorkloadOwnerKey("ReplicaSet", "team-a", "web-7d9c8b6f5"): true,
	}
	if len(values) != len(want) {
		t.Fatalf("index values = %v, want the 2 owner keys %v", values, want)
	}
	for _, v := range values {
		if !want[v] {
			t.Fatalf("unexpected index value %q (want one of %v)", v, want)
		}
	}
}
