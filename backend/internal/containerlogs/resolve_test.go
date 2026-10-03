package containerlogs

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

func logTarget(group, kind, name string) refresh.ObjectScopeIdentity {
	return refresh.ObjectScopeIdentity{
		Namespace: "default",
		GVK:       schema.GroupVersionKind{Group: group, Version: "v1", Kind: kind},
		Name:      name,
	}
}

func labeledPod(name string, labels map[string]string) *corev1.Pod {
	return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: name, Labels: labels}}
}

func podNames(pods []*corev1.Pod) []string {
	names := make([]string, 0, len(pods))
	for _, pod := range pods {
		names = append(names, pod.Name)
	}
	return names
}

// listedPodSelectors returns the label selectors of every pod list the client
// received. The fake clientset filters List by labels only, so asserting the
// requested selector is what proves the production query.
func listedPodSelectors(client *fake.Clientset) []string {
	var selectors []string
	for _, action := range client.Actions() {
		if list, ok := action.(k8stesting.ListAction); ok && action.GetResource().Resource == "pods" {
			selectors = append(selectors, list.GetListRestrictions().Labels.String())
		}
	}
	return selectors
}

func TestParseTargetScopeRequiresNamespacedSupportedObject(t *testing.T) {
	for _, test := range []struct {
		name    string
		scope   string
		message string
	}{
		{name: "missing", scope: "  ", message: "container logs scope is required"},
		{name: "cluster scoped", scope: "cluster-a|:apps/v1:Deployment:api", message: "log scope must reference a namespaced object"},
		{name: "unsupported kind", scope: "cluster-a|team-a:/v1:Service:api", message: "unsupported workload type"},
		{name: "wrong group for kind", scope: "cluster-a|team-a:batch/v1:Deployment:api", message: "not supported"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseTargetScope(test.scope)
			require.ErrorContains(t, err, test.message)
		})
	}

	identity, err := ParseTargetScope("cluster-a|team-a:apps/v1:Deployment:api")
	require.NoError(t, err)
	require.Equal(t, "team-a", identity.Namespace)
	require.Equal(t, schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, identity.GVK)
	require.Equal(t, "api", identity.Name)
}

// A single pod is read with a plain GET, so previous logs keep working for
// users who may read pods but not list or watch them. Live sessions watch it
// by name so a recreated pod or a new debug container is followed.
func TestResolvePodUsesGetAndWatchesByName(t *testing.T) {
	client := fake.NewClientset(labeledPod("api-0", nil))

	resolution, err := Resolve(context.Background(), client, logTarget("", "Pod", "api-0"), ScopeSelection{})
	require.NoError(t, err)
	require.Equal(t, []string{"api-0"}, podNames(resolution.Pods))
	require.Len(t, client.Actions(), 1)
	require.Equal(t, "get", client.Actions()[0].GetVerb())
	require.NotNil(t, resolution.Watch)
	require.Equal(t, "default", resolution.Watch.Namespace)
	require.Equal(t, "metadata.name=api-0", resolution.Watch.FieldSelector)
	owns, err := resolution.Watch.Owns(context.Background(), labeledPod("api-1", nil))
	require.NoError(t, err)
	require.False(t, owns, "another pod in the namespace is not the target")

	client.ClearActions()
	resolution, err = Resolve(context.Background(), client, logTarget("", "Pod", "api-0"), ParseScopeSelection([]string{"pod:other"}))
	require.NoError(t, err)
	require.Empty(t, resolution.Pods)
	require.Empty(t, client.Actions(), "a deselected pod must not be read")
}

func TestResolveWorkloadsListPodsByTheirSelector(t *testing.T) {
	selector := &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}}
	objects := []runtime.Object{
		&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"}, Spec: appsv1.DeploymentSpec{Selector: selector}},
		&appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"}, Spec: appsv1.ReplicaSetSpec{Selector: selector}},
		&appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"}, Spec: appsv1.DaemonSetSpec{Selector: selector}},
		&appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"}, Spec: appsv1.StatefulSetSpec{Selector: selector}},
		labeledPod("web-1", map[string]string{"app": "web"}),
		labeledPod("other-1", map[string]string{"app": "other"}),
	}

	for _, kind := range []string{"Deployment", "ReplicaSet", "DaemonSet", "StatefulSet"} {
		t.Run(kind, func(t *testing.T) {
			client := fake.NewClientset(objects...)

			resolution, err := Resolve(context.Background(), client, logTarget("apps", kind, "web"), ScopeSelection{})
			require.NoError(t, err)
			require.Equal(t, []string{"web-1"}, podNames(resolution.Pods))
			require.Equal(t, []string{"app=web"}, listedPodSelectors(client))
			require.NotNil(t, resolution.Watch)
			require.Equal(t, "default", resolution.Watch.Namespace)
			require.Equal(t, "app=web", resolution.Watch.LabelSelector)
		})
	}
}

func TestResolveJobListsPodsByJobName(t *testing.T) {
	client := fake.NewClientset(
		labeledPod("migrate-abc", map[string]string{"job-name": "migrate"}),
		labeledPod("unrelated", map[string]string{"job-name": "other"}),
	)

	resolution, err := Resolve(context.Background(), client, logTarget("batch", "Job", "migrate"), ScopeSelection{})
	require.NoError(t, err)
	require.Equal(t, []string{"migrate-abc"}, podNames(resolution.Pods))
	require.Equal(t, []string{"job-name=migrate"}, listedPodSelectors(client))
	require.Equal(t, "job-name=migrate", resolution.Watch.LabelSelector)
}

func TestResolveCronJobBatchesOwnedJobsAndWatchesOwnership(t *testing.T) {
	ownedBy := func(cronJob string) []metav1.OwnerReference {
		return []metav1.OwnerReference{{Kind: "CronJob", Name: cronJob}}
	}
	client := fake.NewClientset(
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "nightly-1", OwnerReferences: ownedBy("nightly")}},
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "nightly-2", OwnerReferences: ownedBy("nightly")}},
		&batchv1.Job{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "hourly-1", OwnerReferences: ownedBy("hourly")}},
		labeledPod("nightly-1-a", map[string]string{"job-name": "nightly-1"}),
		labeledPod("nightly-2-a", map[string]string{"job-name": "nightly-2"}),
		labeledPod("hourly-1-a", map[string]string{"job-name": "hourly-1"}),
	)

	resolution, err := Resolve(context.Background(), client, logTarget("batch", "CronJob", "nightly"), ScopeSelection{})
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"nightly-1-a", "nightly-2-a"}, podNames(resolution.Pods))
	require.Len(t, listedPodSelectors(client), 1, "owned jobs' pods are listed in one call")

	// Future jobs get new names, so the watch selects every job pod in the
	// namespace and attributes each one through its job's owner.
	watch := resolution.Watch
	require.NotNil(t, watch)
	require.Equal(t, "job-name", watch.LabelSelector)
	require.NoError(t, client.Tracker().Add(&batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "nightly-3", OwnerReferences: ownedBy("nightly")},
	}))
	for _, test := range []struct {
		pod  *corev1.Pod
		owns bool
	}{
		{pod: labeledPod("nightly-3-a", map[string]string{"job-name": "nightly-3"}), owns: true},
		{pod: labeledPod("hourly-1-a", map[string]string{"job-name": "hourly-1"}), owns: false},
		{pod: labeledPod("web-1", map[string]string{"app": "web"}), owns: false},
	} {
		owns, err := watch.Owns(context.Background(), test.pod)
		require.NoError(t, err)
		require.Equal(t, test.owns, owns, test.pod.Name)
	}
}

// A failed job lookup must not permanently hide that job's pods; only a job
// that no longer exists is remembered as not owned.
func TestCronJobOwnershipRetriesAfterATransientLookupFailure(t *testing.T) {
	client := fake.NewClientset(&batchv1.Job{ObjectMeta: metav1.ObjectMeta{
		Namespace: "default", Name: "nightly-9",
		OwnerReferences: []metav1.OwnerReference{{Kind: "CronJob", Name: "nightly"}},
	}})
	resolution, err := Resolve(context.Background(), client, logTarget("batch", "CronJob", "nightly"), ScopeSelection{})
	require.NoError(t, err)
	failures := 1
	client.PrependReactor("get", "jobs", func(k8stesting.Action) (bool, runtime.Object, error) {
		if failures > 0 {
			failures--
			return true, nil, errors.New("apiserver unavailable")
		}
		return false, nil, nil
	})
	pod := labeledPod("nightly-9-a", map[string]string{"job-name": "nightly-9"})

	_, err = resolution.Watch.Owns(context.Background(), pod)
	require.Error(t, err)
	owns, err := resolution.Watch.Owns(context.Background(), pod)
	require.NoError(t, err)
	require.True(t, owns)
}

func TestResolveAppliesPodSelectionToWorkloads(t *testing.T) {
	client := fake.NewClientset(
		labeledPod("migrate-a", map[string]string{"job-name": "migrate"}),
		labeledPod("migrate-b", map[string]string{"job-name": "migrate"}),
	)

	resolution, err := Resolve(context.Background(), client, logTarget("batch", "Job", "migrate"), ParseScopeSelection([]string{"pod:migrate-b"}))
	require.NoError(t, err)
	require.Equal(t, []string{"migrate-b"}, podNames(resolution.Pods))
}

func TestResolveReturnsListFailures(t *testing.T) {
	for _, test := range []struct {
		name     string
		resource string
		target   refresh.ObjectScopeIdentity
	}{
		{name: "workload pods", resource: "pods", target: logTarget("batch", "Job", "migrate")},
		{name: "cronjob jobs", resource: "jobs", target: logTarget("batch", "CronJob", "nightly")},
		{name: "cronjob pods", resource: "pods", target: logTarget("batch", "CronJob", "nightly")},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := fake.NewClientset(&batchv1.Job{ObjectMeta: metav1.ObjectMeta{
				Namespace: "default", Name: "nightly-1",
				OwnerReferences: []metav1.OwnerReference{{Kind: "CronJob", Name: "nightly"}},
			}})
			client.PrependReactor("list", test.resource, func(k8stesting.Action) (bool, runtime.Object, error) {
				return true, nil, errors.New("list failed")
			})

			_, err := Resolve(context.Background(), client, test.target, ScopeSelection{})
			require.ErrorContains(t, err, "list failed")
		})
	}
}
