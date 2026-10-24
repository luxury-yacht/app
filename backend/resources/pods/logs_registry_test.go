package pods_test

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// A workload scope's containers come from its pods, through the kind registry's
// log targets as production injects them (backend/pod_logs.go).
func TestContainerLogsScopeContainersWorkloadReturnsUniqueContainers(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
	}
	podOne := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "default", Labels: map[string]string{"app": "web"}},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init-a"}},
			Containers:     []corev1.Container{{Name: "app"}, {Name: "sidecar"}},
		},
	}
	podTwo := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-2", Namespace: "default", Labels: map[string]string{"app": "web"}},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "init-a"}, {Name: "sidecar"}},
			Containers:     []corev1.Container{{Name: "app"}, {Name: "other"}},
		},
	}
	client := fake.NewClientset(deployment, podOne, podTwo)

	service := pods.NewContainerLogsService(common.Dependencies{
		KubernetesClient: client,
	}, kindregistry.MustLogTargets())

	containers, err := service.ContainerLogsScopeContainers(context.Background(), "cluster-a|default:apps/v1:deployment:web")
	require.NoError(t, err)
	require.Equal(t, []types.PodContainer{
		{Name: "app"},
		{Name: "init-a", IsInit: true},
		{Name: "other"},
		{Name: "sidecar", IsInit: true},
		{Name: "sidecar"},
	}, containers)
}
