package backend

import (
	"context"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
)

func TestRestartWorkloadRequiresPatchPermission(t *testing.T) {
	client := cgofake.NewClientset(&appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "demo"}},
			},
		},
	})
	denySelfSubjectAccessReviews(client, "no patch deployments")

	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
	})

	err := app.restartWorkload("cluster-a", "default", "apps", "v1", "Deployment", "demo")
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected permission denial, got %v", err)
	}
	for _, action := range client.Actions() {
		if action.Matches("patch", "deployments") {
			t.Fatalf("deployment patch should not run after permission denial: %#v", action)
		}
	}
}

func TestDeleteResourceByGVKRequiresDeletePermission(t *testing.T) {
	client := cgofake.NewClientset()
	denySelfSubjectAccessReviews(client, "no delete pods")
	dynamicClient := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())

	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
		dynamicClient:     dynamicClient,
	})

	err := app.deleteResourceByGVK("cluster-a", "v1", "Pod", "default", "demo")
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected permission denial, got %v", err)
	}
	if actions := dynamicClient.Actions(); len(actions) != 0 {
		t.Fatalf("dynamic client should not be called after permission denial: %#v", actions)
	}
}

func TestTriggerCronJobRequiresJobCreatePermission(t *testing.T) {
	client := cgofake.NewClientset(&batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: "backup", Namespace: "default"},
		Spec: batchv1.CronJobSpec{
			Schedule: "0 * * * *",
			JobTemplate: batchv1.JobTemplateSpec{
				Spec: batchv1.JobSpec{
					Template: corev1.PodTemplateSpec{
						Spec: corev1.PodSpec{
							Containers:    []corev1.Container{{Name: "backup", Image: "busybox"}},
							RestartPolicy: corev1.RestartPolicyNever,
						},
					},
				},
			},
		},
	})
	denySelfSubjectAccessReviews(client, "no create jobs")

	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
	})

	_, err := app.triggerCronJob("cluster-a", "default", "backup")
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected permission denial, got %v", err)
	}
	for _, action := range client.Actions() {
		if action.Matches("create", "jobs") {
			t.Fatalf("job create should not run after permission denial: %#v", action)
		}
	}
}

func TestSuspendCronJobRequiresPatchPermission(t *testing.T) {
	client := cgofake.NewClientset(&batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: "backup", Namespace: "default"},
	})
	denySelfSubjectAccessReviews(client, "no patch cronjobs")

	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta:              ClusterMeta{ID: "cluster-a", Name: "cluster-a"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
	})

	err := app.suspendCronJob("cluster-a", "default", "backup", true)
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected permission denial, got %v", err)
	}
	for _, action := range client.Actions() {
		if action.Matches("patch", "cronjobs") {
			t.Fatalf("cronjob patch should not run after permission denial: %#v", action)
		}
	}
}

func TestDrainPodPermissionFollowsEvictionSupport(t *testing.T) {
	tests := []struct {
		name             string
		seedEviction     bool
		disableEviction  bool
		expectedVerb     string
		expectedResource string
		expectedSub      string
	}{
		{
			name:             "uses eviction create when supported",
			seedEviction:     true,
			expectedVerb:     "create",
			expectedResource: "pods",
			expectedSub:      "eviction",
		},
		{
			name:             "uses delete when eviction unsupported",
			expectedVerb:     "delete",
			expectedResource: "pods",
		},
		{
			name:             "uses delete when eviction disabled",
			seedEviction:     true,
			disableEviction:  true,
			expectedVerb:     "delete",
			expectedResource: "pods",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client := cgofake.NewClientset()
			seedDrainEvictionDiscovery(t, client, tc.seedEviction)
			var attrs *authorizationv1.ResourceAttributes
			client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
				review := action.(cgotesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview)
				copied := *review.Spec.ResourceAttributes
				attrs = &copied
				review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
				return true, review, nil
			})

			app := NewApp()
			deps := common.Dependencies{
				Context:          context.Background(),
				KubernetesClient: client,
				ClusterID:        "cluster-a",
			}
			deps.ResourceResolver = objectcatalog.NewResourceResolver(deps, nil)
			err := app.requireDrainPodPermission(deps, DrainNodeOptions{DisableEviction: tc.disableEviction})
			if err != nil {
				t.Fatalf("requireDrainPodPermission: %v", err)
			}
			if attrs == nil {
				t.Fatal("expected self subject access review")
			}
			if attrs.Verb != tc.expectedVerb || attrs.Resource != tc.expectedResource || attrs.Subresource != tc.expectedSub {
				t.Fatalf("unexpected attrs: verb=%q resource=%q subresource=%q", attrs.Verb, attrs.Resource, attrs.Subresource)
			}
		})
	}
}

func TestCancelDrainNodeJobRequiresNodeMaintenancePermission(t *testing.T) {
	const clusterID = "cluster-cancel-denied"
	const nodeName = "worker-cancel-denied"
	client := cgofake.NewClientset(&corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: nodeName},
	})
	denySelfSubjectAccessReviews(client, "no node maintenance")

	app := NewApp()
	app.Ctx = context.Background()
	registerTestClusterWithClients(app, clusterID, &clusterClients{
		meta:              ClusterMeta{ID: clusterID, Name: clusterID},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            client,
	})

	job := nodemaintenance.GlobalStore().StartDrainForCluster(
		nodeName,
		DrainNodeOptions{},
		clusterID,
		clusterID,
	)
	err := app.CancelDrainNodeJob(clusterID, job.ID)
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected permission denial, got %v", err)
	}

	stored, ok := nodemaintenance.GlobalStore().JobForCluster(job.ID, clusterID)
	if !ok {
		t.Fatal("expected drain job to remain in the store")
	}
	if stored.Status != nodemaintenance.DrainStatusRunning {
		t.Fatalf("expected job to remain running after denied cancel, got %s", stored.Status)
	}
}

func seedDrainEvictionDiscovery(t *testing.T, client *cgofake.Clientset, supported bool) {
	t.Helper()

	discoveryClient, ok := client.Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatalf("expected fake discovery client, got %T", client.Discovery())
	}
	resources := []metav1.APIResource{}
	if supported {
		resources = append(resources, metav1.APIResource{
			Name:    "pods/eviction",
			Kind:    "Eviction",
			Group:   "policy",
			Version: "v1",
		})
	}
	discoveryClient.Resources = []*metav1.APIResourceList{{
		GroupVersion: "v1",
		APIResources: resources,
	}}
}
