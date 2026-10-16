package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
)

func selectorTestTemplate(app string) corev1.PodTemplateSpec {
	return corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": app}}}
}

// selectorTestMeta keeps UIDs unique across kinds; map node ids are UID-based.
func selectorTestMeta(kind, namespace, name string) metav1.ObjectMeta {
	return metav1.ObjectMeta{Namespace: namespace, Name: name, UID: types.UID(kind + "/" + namespace + "/" + name)}
}

// One workload of every pod-template kind whose template carries app=web, one
// workload with other labels, and a matching workload in another namespace. No
// selector may link to any of them.
func selectorTestWorkloads() []runtime.Object {
	return []runtime.Object{
		&appsv1.Deployment{ObjectMeta: selectorTestMeta("Deployment", "default", "web"), Spec: appsv1.DeploymentSpec{Template: selectorTestTemplate("web")}},
		&appsv1.StatefulSet{ObjectMeta: selectorTestMeta("StatefulSet", "default", "web-db"), Spec: appsv1.StatefulSetSpec{Template: selectorTestTemplate("web")}},
		&appsv1.DaemonSet{ObjectMeta: selectorTestMeta("DaemonSet", "default", "web-agent"), Spec: appsv1.DaemonSetSpec{Template: selectorTestTemplate("web")}},
		&appsv1.ReplicaSet{ObjectMeta: selectorTestMeta("ReplicaSet", "default", "web-rs"), Spec: appsv1.ReplicaSetSpec{Template: selectorTestTemplate("web")}},
		&batchv1.Job{ObjectMeta: selectorTestMeta("Job", "default", "web-job"), Spec: batchv1.JobSpec{Template: selectorTestTemplate("web")}},
		&batchv1.CronJob{ObjectMeta: selectorTestMeta("CronJob", "default", "web-cron"), Spec: batchv1.CronJobSpec{
			JobTemplate: batchv1.JobTemplateSpec{Spec: batchv1.JobSpec{Template: selectorTestTemplate("web")}},
		}},
		&appsv1.Deployment{ObjectMeta: selectorTestMeta("Deployment", "default", "other"), Spec: appsv1.DeploymentSpec{Template: selectorTestTemplate("other")}},
		&appsv1.Deployment{ObjectMeta: selectorTestMeta("Deployment", "elsewhere", "web"), Spec: appsv1.DeploymentSpec{Template: selectorTestTemplate("web")}},
	}
}

var selectorTestWebWorkloads = [][2]string{
	{"Deployment", "web"}, {"StatefulSet", "web-db"}, {"DaemonSet", "web-agent"},
	{"ReplicaSet", "web-rs"}, {"Job", "web-job"}, {"CronJob", "web-cron"},
}

// Kubernetes applies Service, PDB, and NetworkPolicy selectors to Pods, never
// to workloads. A Service reaches its Pods through the EndpointSlices the
// EndpointSlice controller keeps for it; PDBs and NetworkPolicies select Pods
// directly. The map draws exactly those relationships.
func TestObjectMapSelectorsRelateToPodsOnly(t *testing.T) {
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name: "web-slice", Namespace: "default", UID: types.UID("EndpointSlice/default/web-slice"),
			Labels: map[string]string{discoveryv1.LabelServiceName: "web"},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.0.0.1"},
			TargetRef: &corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: "default", Name: "web-pod", UID: types.UID("Pod/default/web-pod")},
		}},
	}
	pod := podFixture("default", "web-pod", "Pod/default/web-pod", "", map[string]string{"app": "web"})
	objects := append(selectorTestWorkloads(),
		pod,
		slice,
		&corev1.Service{ObjectMeta: selectorTestMeta("Service", "default", "web"), Spec: corev1.ServiceSpec{Selector: map[string]string{"app": "web"}}},
		&corev1.Service{ObjectMeta: selectorTestMeta("Service", "default", "external"), Spec: corev1.ServiceSpec{}},
		&policyv1.PodDisruptionBudget{ObjectMeta: selectorTestMeta("PodDisruptionBudget", "default", "web"), Spec: policyv1.PodDisruptionBudgetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		}},
		&networkingv1.NetworkPolicy{ObjectMeta: selectorTestMeta("NetworkPolicy", "default", "all"), Spec: networkingv1.NetworkPolicySpec{}},
	)
	builder := newObjectMapTestBuilder(t, fake.NewSimpleClientset(objects...))
	ctx := WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"})
	build := func(t *testing.T, scope string) ObjectMapSnapshotPayload {
		t.Helper()
		snap, err := builder.Build(ctx, scope)
		require.NoError(t, err)
		return snap.Payload.(ObjectMapSnapshotPayload)
	}
	assertNoWorkloads := func(t *testing.T, payload ObjectMapSnapshotPayload) {
		t.Helper()
		for _, workload := range append(selectorTestWebWorkloads, [2]string{"Deployment", "other"}) {
			assertMissingNode(t, payload, workload[0], workload[1])
		}
	}

	t.Run("Service routes through its EndpointSlice", func(t *testing.T) {
		payload := build(t, "default:/v1:Service:web")
		assertEdge(t, payload, "Service", "web", "EndpointSlice", "web-slice", "endpoint")
		assertEdge(t, payload, "EndpointSlice", "web-slice", "Pod", "web-pod", "endpoint")
		assertMissingEdge(t, payload, "Service", "web", "Pod", "web-pod", "selector")
		assertNoWorkloads(t, payload)
	})

	t.Run("PodDisruptionBudget selects Pods", func(t *testing.T) {
		payload := build(t, "default:policy/v1:PodDisruptionBudget:web")
		assertEdge(t, payload, "PodDisruptionBudget", "web", "Pod", "web-pod", "selector")
		assertNoWorkloads(t, payload)
	})

	t.Run("NetworkPolicy selects Pods", func(t *testing.T) {
		payload := build(t, "default:networking.k8s.io/v1:NetworkPolicy:all")
		assertEdge(t, payload, "NetworkPolicy", "all", "Pod", "web-pod", "selector")
		assertNoWorkloads(t, payload)
	})

	t.Run("a Service without a selector or slices relates to nothing", func(t *testing.T) {
		payload := build(t, "default:/v1:Service:external")
		require.Len(t, payload.Nodes, 1)
	})
}
