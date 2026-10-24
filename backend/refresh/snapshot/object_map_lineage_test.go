package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
)

// lineageFixture is one workload chain down to its storage:
// Deployment → ReplicaSet → Pod → PVC → PV → StorageClass, with the Deployment's
// pod template and the Pod both using ConfigMap app-config.
func lineageFixture() []runtime.Object {
	deploy := deploymentFixture("default", "web", "deploy-uid", "", "app-config")
	deploy.Spec.Template.Labels = map[string]string{"app": "web"}
	return []runtime.Object{
		deploy,
		replicaSetFixture("default", "web-rs", "rs-uid", "web", "deploy-uid"),
		podFixture("default", "web-pod", "pod-uid", "rs-uid", map[string]string{"app": "web"}),
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "default", UID: types.UID("pvc-uid")},
			Spec:       corev1.PersistentVolumeClaimSpec{VolumeName: "pv-data"},
		},
		&corev1.PersistentVolume{
			ObjectMeta: metav1.ObjectMeta{Name: "pv-data", UID: types.UID("pv-uid")},
			Spec:       corev1.PersistentVolumeSpec{StorageClassName: "fast"},
		},
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "fast", UID: types.UID("sc-uid")}},
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "app-config", Namespace: "default", UID: types.UID("cm-uid")}},
	}
}

func buildLineageMap(t *testing.T, objects []runtime.Object, scope string) ObjectMapSnapshotPayload {
	t.Helper()
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objects...))
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	snap, err := builder.Build(ctx, scope)
	require.NoError(t, err)
	return snap.Payload.(ObjectMapSnapshotPayload)
}

// A map follows a same-direction chain to its end; no depth cut-off hides the
// StorageClass five links from the Deployment.
func TestObjectMapHasNoDepthLimit(t *testing.T) {
	payload := buildLineageMap(t, lineageFixture(), "default:apps/v1:Deployment:web")

	assertEdge(t, payload, "PersistentVolume", "pv-data", "StorageClass", "fast", "storage-class")
	require.Equal(t, 5, nodeByKindName(t, payload, "StorageClass", "fast").Depth)
	require.False(t, payload.Truncated)
}

// Links toward the seed are followed at any distance, whatever their type: a
// PersistentVolume's map shows the Pods that mount its claim and their owners.
func TestObjectMapFollowsLinksTowardTheSeedAtAnyDistance(t *testing.T) {
	payload := buildLineageMap(t, lineageFixture(), "__cluster__:/v1:PersistentVolume:pv-data")

	assertEdge(t, payload, "PersistentVolumeClaim", "data", "PersistentVolume", "pv-data", "volume-binding")
	assertEdge(t, payload, "Pod", "web-pod", "PersistentVolumeClaim", "data", "mounts")
	assertEdge(t, payload, "ReplicaSet", "web-rs", "Pod", "web-pod", "owner")
	assertEdge(t, payload, "Deployment", "web", "ReplicaSet", "web-rs", "owner")
	// Leaving the chain to follow the Pod's other dependencies would be a turn.
	assertMissingNode(t, payload, "ConfigMap", "app-config")
}

// Every link between two objects on a map is drawn, including ones no path
// from the seed walks: a Pod's map shows its Deployment's template using the
// same ConfigMap as the Pod.
func TestObjectMapDrawsEveryLinkBetweenItsObjects(t *testing.T) {
	payload := buildLineageMap(t, lineageFixture(), "default:/v1:Pod:web-pod")

	assertEdge(t, payload, "Pod", "web-pod", "ConfigMap", "app-config", "uses")
	assertEdge(t, payload, "Deployment", "web", "ConfigMap", "app-config", "uses")
}

// When the node cap is reached, nearer objects win in either direction: the
// HPA and ReplicaSet one link from the Deployment are kept before its Pods two
// links away.
func TestObjectMapKeepsNearestObjectsUnderTheCap(t *testing.T) {
	deploy := deploymentFixture("default", "web", "deploy-uid", "", "app-config")
	deploy.Spec.Template.Labels = map[string]string{"app": "web"}
	deploy.Spec.Template.Spec.Volumes = nil
	objects := []runtime.Object{
		deploy,
		replicaSetFixture("default", "web-rs", "rs-uid", "web", "deploy-uid"),
		podFixture("default", "web-a", "pod-a-uid", "rs-uid", map[string]string{"app": "web"}),
		podFixture("default", "web-b", "pod-b-uid", "rs-uid", map[string]string{"app": "web"}),
		&autoscalingv2.HorizontalPodAutoscaler{
			ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: types.UID("hpa-uid")},
			Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
				ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web"},
			},
		},
	}
	payload := buildLineageMap(t, objects, "default:apps/v1:Deployment:web?maxNodes=3")

	require.True(t, payload.Truncated)
	assertNode(t, payload, "ReplicaSet", "web-rs")
	assertNode(t, payload, "HorizontalPodAutoscaler", "web")
	assertMissingNode(t, payload, "Pod", "web-a")
	assertMissingNode(t, payload, "Pod", "web-b")
}

// A namespace map holds the namespace's objects plus the cluster-scoped objects
// the one rule reaches from them. A bound PVC reaches its StorageClass through
// its PV, and a RoleBinding its ClusterRole. A ClusterRoleBinding that binds the
// namespace's ServiceAccount is reached backward, so its ClusterRole (forward
// from the binding) would be a turn, and so would the shared StorageClass's
// other PersistentVolumes.
func TestObjectMapNamespaceMapUsesTheOneRule(t *testing.T) {
	objects := []runtime.Object{
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: "team-a", UID: types.UID("sa-uid")}},
		&rbacv1.RoleBinding{
			ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a", UID: types.UID("rb-uid")},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "view"},
			Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder"}},
		},
		&rbacv1.ClusterRoleBinding{
			ObjectMeta: metav1.ObjectMeta{Name: "builder-admin", UID: types.UID("crb-uid")},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "admin"},
			Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder", Namespace: "team-a"}},
		},
		&rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "view", UID: types.UID("cr-view-uid")}},
		&rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "admin", UID: types.UID("cr-admin-uid")}},
		&corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "team-a", UID: types.UID("pvc-uid")},
			Spec:       corev1.PersistentVolumeClaimSpec{VolumeName: "pv-data"},
		},
		&corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "pv-data", UID: types.UID("pv-uid")}, Spec: corev1.PersistentVolumeSpec{StorageClassName: "fast"}},
		&corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "pv-other", UID: types.UID("pv-other-uid")}, Spec: corev1.PersistentVolumeSpec{StorageClassName: "fast"}},
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "fast", UID: types.UID("sc-uid")}},
	}
	payload := buildLineageMap(t, objects, "namespace:team-a?maxNodes=100")

	assertEdge(t, payload, "PersistentVolume", "pv-data", "StorageClass", "fast", "storage-class")
	assertEdge(t, payload, "RoleBinding", "readers", "ClusterRole", "view", "grants")
	assertEdge(t, payload, "ClusterRoleBinding", "builder-admin", "ServiceAccount", "builder", "binds")
	assertMissingNode(t, payload, "ClusterRole", "admin")
	assertMissingNode(t, payload, "PersistentVolume", "pv-other")
}
