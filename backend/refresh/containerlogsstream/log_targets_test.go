package containerlogsstream

import (
	"context"
	"sort"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func teamPod(name string, labels map[string]string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: name, Labels: labels},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
}

func fetchedPodNames(t *testing.T, client *fake.Clientset, scope string) []string {
	t.Helper()
	service := pods.NewContainerLogsService(common.Dependencies{KubernetesClient: client, Logger: applog.Noop}, testLogTargets)
	response, err := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: scope})
	require.NoError(t, err)
	seen := map[string]bool{}
	for _, entry := range response.Entries {
		seen[entry.Pod] = true
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func streamedPodNames(t *testing.T, client *fake.Clientset, scope string) []string {
	t.Helper()
	options, err := parseRequest(Request{Scope: scope}, testLogTargets)
	require.NoError(t, err)
	resolution, err := NewStreamer(client, testLogTargets, applog.Noop, nil).resolve(context.Background(), options)
	require.NoError(t, err)
	names := make([]string, 0, len(resolution.Pods))
	for _, pod := range resolution.Pods {
		names = append(names, pod.Name)
	}
	sort.Strings(names)
	return names
}

// Fetch keeps a scope's kind as written, and the stream's request parser
// lowercases it (parseRequest); both read through one target table, so the same
// canonical scope reaches the same pods on both paths.
func TestFetchAndStreamResolveTheSameScopeThroughOneTargetTable(t *testing.T) {
	selector := &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}
	cronJobOwner := []metav1.OwnerReference{{Kind: "CronJob", Name: "nightly"}}
	client := fake.NewClientset(
		&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web"}, Spec: appsv1.DeploymentSpec{Selector: selector}},
		teamPod("web-1", map[string]string{"app": "web"}),
		teamPod("other-1", map[string]string{"app": "other"}),
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "nightly-1", OwnerReferences: cronJobOwner}},
		teamPod("nightly-1-a", map[string]string{"job-name": "nightly-1"}),
	)

	for scope, want := range map[string][]string{
		"cluster-a|team-a:apps/v1:Deployment:web":   {"web-1"},
		"cluster-a|team-a:batch/v1:CronJob:nightly": {"nightly-1-a"},
	} {
		t.Run(scope, func(t *testing.T) {
			require.Equal(t, want, fetchedPodNames(t, client, scope))
			require.Equal(t, want, streamedPodNames(t, client, scope))
		})
	}
}

// A kind without a log target is rejected the same way on both paths.
func TestFetchAndStreamRejectAScopeWithoutALogTarget(t *testing.T) {
	const scope = "cluster-a|team-a:/v1:Service:api"
	service := pods.NewContainerLogsService(common.Dependencies{KubernetesClient: fake.NewClientset()}, testLogTargets)

	_, fetchErr := service.FetchContainerLogs(context.Background(), types.ContainerLogsFetchRequest{Scope: scope})
	_, streamErr := parseRequest(Request{Scope: scope}, testLogTargets)

	require.Error(t, fetchErr)
	require.Error(t, streamErr)
	require.ErrorContains(t, fetchErr, streamErr.Error())
}
