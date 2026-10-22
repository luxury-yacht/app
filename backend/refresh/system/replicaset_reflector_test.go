package system

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

func replicaSetOwnedByDeployment(name, deployment string) *appsv1.ReplicaSet {
	return &appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{
		Namespace: "team-a", Name: name, UID: types.UID("rs-uid-" + name),
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "apps/v1", Kind: "Deployment", Name: deployment, UID: "deployment-uid", Controller: ptr.To(true),
		}},
	}}
}

// cronJobScope is the Pods view of a CronJob in team-a.
func cronJobScope(name string) string {
	return refresh.WorkloadSelector(refresh.ObjectScopeIdentity{
		Namespace: "team-a", GVK: batchv1.SchemeGroupVersion.WithKind("CronJob"), Name: name,
	}).String()
}

// The ReplicaSet reflector feeds the owner index the pod projection reads, so
// a Deployment's Pods view lists a pod created through the API, and the read
// its doorbell triggers shows it.
func TestReplicaSetReflectorPutsPodsInTheirDeploymentView(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "")
	deployment := h.subscribe(t, "pods", workloadScope("Deployment", "web"))

	server.Create(t, replicaSetOwnedByDeployment("web-1", "web"))
	server.Create(t, ownedPod("", replicaSetOwner("web-1")))

	h.awaitRows(t, deployment, "pods", workloadScope("Deployment", "web"), []string{"web-1-abc"})
}

// A re-warm resumes each watch from its spilled resourceVersion and receives
// no ReplicaSet or Job events: both existed at the last list. Pods created
// afterwards must still resolve to their Deployment and CronJob from the
// restored owner indexes.
func TestRewarmWithoutOwnerChangesResolvesNewPodsToTheirControllers(t *testing.T) {
	server := newReflectorAPIServer(t)
	server.Create(t, replicaSetOwnedByDeployment("web-1", "web"))
	server.Create(t, &batchv1.Job{ObjectMeta: metav1.ObjectMeta{
		Namespace: "team-a", Name: "nightly-1", UID: "job-uid",
		OwnerReferences: []metav1.OwnerReference{{APIVersion: "batch/v1", Kind: "CronJob", Name: "nightly", UID: "cronjob-uid", Controller: ptr.To(true)}},
	}})
	before := newReflectorHarness(t, server, "")
	require.Eventually(t, func() bool {
		return len(before.subsystem.IngestManager.AggregateRows(snapshot.ReplicaSetGVR)) == 1 &&
			len(before.subsystem.IngestManager.CatalogRows(snapshot.JobGVR)) == 1
	}, 5*time.Second, 10*time.Millisecond)
	spill := t.TempDir()
	require.NoError(t, before.subsystem.IngestManager.SpillStores(spill))
	before.stop()

	after := newReflectorHarness(t, server, spill)
	deployment := after.subscribe(t, "pods", workloadScope("Deployment", "web"))
	cronJob := after.subscribe(t, "pods", cronJobScope("nightly"))
	server.Create(t, ownedPod("", replicaSetOwner("web-1")))
	server.Create(t, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Namespace: "team-a", Name: "nightly-1-xyz", UID: "job-pod-uid",
		OwnerReferences: []metav1.OwnerReference{{APIVersion: "batch/v1", Kind: "Job", Name: "nightly-1", UID: "job-uid", Controller: ptr.To(true)}},
	}})

	after.awaitRows(t, deployment, "pods", workloadScope("Deployment", "web"), []string{"web-1-abc"})
	after.awaitRows(t, cronJob, "pods", cronJobScope("nightly"), []string{"nightly-1-xyz"})
}

// A re-warm whose spilled resourceVersion has expired relists instead of
// resuming. The relist must reach the owner index: a ReplicaSet created while
// the cluster was Cold resolves a pod created after the relist to its
// Deployment, with no later ReplicaSet event to heal the pod.
func TestRewarmAfterExpiredVersionRelistsTheOwnerIndex(t *testing.T) {
	server := newReflectorAPIServer(t)
	before := newReflectorHarness(t, server, "")
	server.Create(t, replicaSetOwnedByDeployment("web-1", "web"))
	require.Eventually(t, func() bool {
		return len(before.subsystem.IngestManager.AggregateRows(snapshot.ReplicaSetGVR)) == 1
	}, 5*time.Second, 10*time.Millisecond)
	spill := t.TempDir()
	require.NoError(t, before.subsystem.IngestManager.SpillStores(spill))
	before.stop()
	server.WatchGap(t, func() { server.Create(t, replicaSetOwnedByDeployment("api-1", "api")) })

	after := newReflectorHarness(t, server, spill)
	require.Eventually(t, func() bool {
		return len(after.subsystem.IngestManager.AggregateRows(snapshot.ReplicaSetGVR)) == 2
	}, 5*time.Second, 10*time.Millisecond, "the ReplicaSet store must relist")
	api := after.subscribe(t, "pods", workloadScope("Deployment", "api"))
	server.Create(t, ownedPod("", replicaSetOwner("api-1")))

	after.awaitRows(t, api, "pods", workloadScope("Deployment", "api"), []string{"web-1-abc"})
}
